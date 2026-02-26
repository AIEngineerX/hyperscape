#!/bin/bash
# Hyperscape CI/CD Deploy for Vast.ai
# Pulls latest, builds, and starts the full duel stack under pm2
set -e

export PATH="/root/.bun/bin:$PATH"
cd /root/hyperscape

# ── Ensure DNS resolution works (some Vast containers use internal-only DNS) ─
echo -e "nameserver 8.8.8.8\nnameserver 8.8.4.4" > /etc/resolv.conf

LOG_DIR="/root/hyperscape/logs"
mkdir -p "$LOG_DIR"

echo "[deploy] Starting Hyperscape CI/CD update on Vast.ai..."
echo "[deploy] Timestamp: $(date -Iseconds)"

# ── Pull latest code ──────────────────────────────────────────
echo "[deploy] Pulling latest code from main branch..."
git fetch origin
git reset --hard origin/main
git pull origin main

# ── Install system dependencies (needed for native modules) ───
echo "[deploy] Installing system build dependencies..."
apt-get update && apt-get install -y \
    build-essential \
    python3 \
    socat \
    xvfb \
    git-lfs \
    ffmpeg \
    wget \
    gnupg \
    curl \
    jq \
    mesa-vulkan-drivers \
    vulkan-tools \
    libvulkan1 \
    || true
git lfs install || true

# ── Check GPU and Vulkan support ──────────────────────────────
echo "[deploy] Checking GPU status..."
nvidia-smi || echo "[deploy] WARNING: nvidia-smi not available"

echo "[deploy] Checking Vulkan support..."
vulkaninfo --summary 2>/dev/null || echo "[deploy] WARNING: Vulkan may not be available"

# ── Install Chrome Dev channel (has WebGPU enabled by default) ─
echo "[deploy] Installing Chrome Dev channel for WebGPU support..."
if ! command -v google-chrome-unstable &> /dev/null; then
    wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add - || true
    echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list
    apt-get update && apt-get install -y google-chrome-unstable || true
    echo "[deploy] Chrome Dev installed: $(google-chrome-unstable --version 2>/dev/null || echo 'install failed')"
else
    echo "[deploy] Chrome Dev already installed: $(google-chrome-unstable --version)"
fi

# ── Install Playwright and deps ───────────────────────────────
export PATH="/root/.bun/bin:$PATH"
echo "[deploy] Installing Playwright dependencies..."
bunx playwright install chromium || true
bunx playwright install-deps chromium || true

# ── Install dependencies ──────────────────────────────────────
echo "[deploy] Installing dependencies..."
export CI=true
bun install

# ── Build core packages ──────────────────────────────────────
echo "[deploy] Building core dependencies..."
cd packages/physx-js-webidl && bun run build && cd ../..
cd packages/decimation && bun run build && cd ../..
cd packages/impostors && bun run build && cd ../..
cd packages/procgen && bun run build && cd ../..
cd packages/asset-forge && bun run build:services && cd ../..
cd packages/shared && bun run build && cd ../..

# ── Database migration ────────────────────────────────────────
echo "[deploy] Pushing database schema..."
cd packages/server
bunx drizzle-kit push --force
cd ../..

# ── Tear down existing processes ──────────────────────────────
echo "[deploy] Tearing down existing processes..."
# Stop pm2-managed processes first
bunx pm2 delete ecosystem.config.cjs 2>/dev/null || true
# Also clean up any legacy processes from the old watchdog
pkill -f "watchdog.sh" || true
pkill -f "bun.*build/index" || true
pkill -f "bun.*dev.mjs" || true
pkill -f "bun.*dev-final" || true
pkill -f "stream-to-rtmp" || true
pkill -f "turbo.*dev" || true
pkill -f "bun.*duel-stack" || true
sleep 3

# ── Start socat port proxies ─────────────────────────────────
echo "[deploy] Starting port proxies..."
pkill -f "socat.*TCP-LISTEN:35143" || true
pkill -f "socat.*TCP-LISTEN:35079" || true
pkill -f "socat.*TCP-LISTEN:35144" || true
sleep 1
# Game server: internal 5555 -> external 35143
nohup socat TCP-LISTEN:35143,reuseaddr,fork TCP:127.0.0.1:5555 > /dev/null 2>&1 &
# WebSocket: internal 5555 -> external 35079
nohup socat TCP-LISTEN:35079,reuseaddr,fork TCP:127.0.0.1:5555 > /dev/null 2>&1 &
# CDN: internal 8080 -> external 35144
nohup socat TCP-LISTEN:35144,reuseaddr,fork TCP:127.0.0.1:8080 > /dev/null 2>&1 &
echo "[deploy] Port proxies running"

# ── Start duel stack via pm2 ─────────────────────────────────
echo "[deploy] Starting Hyperscape duel stack via pm2..."
bunx pm2 start ecosystem.config.cjs

# ── Configure pm2 to survive reboots ─────────────────────────
echo "[deploy] Saving pm2 process list for reboot survival..."
bunx pm2 save

# ── Wait for server to be healthy ─────────────────────────────
echo "[deploy] Waiting for server to be healthy..."
MAX_WAIT=120
WAITED=0
HEALTHY=false

while [ $WAITED -lt $MAX_WAIT ]; do
    # Check internal health endpoint
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:5555/health" --max-time 5 2>/dev/null || echo "000")

    if [ "$HTTP_STATUS" = "200" ]; then
        HEALTHY=true
        echo "[deploy] Server is healthy! (status: $HTTP_STATUS)"
        break
    fi

    echo "[deploy] Server not ready yet (status: $HTTP_STATUS), waiting... ($WAITED/$MAX_WAIT seconds)"
    sleep 5
    WAITED=$((WAITED + 5))
done

if [ "$HEALTHY" = "false" ]; then
    echo "[deploy] WARNING: Server did not become healthy within ${MAX_WAIT}s"
    echo "[deploy] Check logs with: bunx pm2 logs hyperscape-duel"
fi

# ── Show pm2 status ───────────────────────────────────────────
echo ""
echo "[deploy] Current pm2 status:"
bunx pm2 status

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  ✓ Hyperscape deployed successfully!"
echo "  ✓ Duel stack managed by pm2 (auto-restart on crash)"
echo "  ✓ Deploy timestamp: $(date -Iseconds)"
if [ "$HEALTHY" = "true" ]; then
    echo "  ✓ Server health check: PASSED"
else
    echo "  ⚠ Server health check: PENDING (may still be starting)"
fi
echo ""
echo "  Port mappings:"
echo "    Internal 5555 -> External 35143 (HTTP)"
echo "    Internal 5555 -> External 35079 (WebSocket)"
echo "    Internal 8080 -> External 35144 (CDN)"
echo ""
echo "  Useful commands:"
echo "    bun run duel:prod:logs     # tail live logs"
echo "    bun run duel:prod:status   # process status"
echo "    bun run duel:prod:restart  # restart stack"
echo "    bun run duel:prod:stop     # stop stack"
echo "════════════════════════════════════════════════════════════"
