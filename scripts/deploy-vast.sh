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

# ── Pull latest code ──────────────────────────────────────────
echo "[deploy] Pulling latest code..."
git fetch origin
git reset --hard origin/main
git pull origin main

# ── Install system dependencies (needed for native modules) ───
echo "[deploy] Installing system build dependencies..."
apt-get update && apt-get install -y build-essential python3 socat xvfb git-lfs ffmpeg wget gnupg || true
git lfs install || true

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

# ── Install Playwright system deps for RTMP streaming ─────────
export PATH="/root/.bun/bin:$PATH"
bunx playwright install-deps chromium || true

# ── Install dependencies ──────────────────────────────────────
echo "[deploy] Installing dependencies..."
export CI=true
bun install

# ── Tear down existing processes FIRST (to release DB connections) ──
echo "[deploy] Tearing down existing processes..."
# Stop pm2-managed processes first
bunx pm2 kill 2>/dev/null || true
bunx pm2 delete all 2>/dev/null || true
# Kill ALL bun/node processes to release database connections
pkill -9 -f "bun" || true
pkill -9 -f "node" || true
pkill -f "watchdog.sh" || true
pkill -f "stream-to-rtmp" || true
pkill -f "turbo.*dev" || true
pkill -f "chromium" || true
pkill -f "chrome" || true

# Wait for database connections to be released by Neon pooler
echo "[deploy] Waiting 30s for database connections to clear..."
sleep 30

# ── Build core packages ──────────────────────────────────────
echo "[deploy] Building core dependencies..."
cd packages/physx-js-webidl && bun run build && cd ../..
cd packages/decimation && bun run build && cd ../..
cd packages/impostors && bun run build && cd ../..
cd packages/procgen && bun run build && cd ../..
cd packages/asset-forge && bun run build:services && cd ../..
cd packages/shared && bun run build && cd ../..

# ── Database migration (after connections cleared) ────────────
echo "[deploy] Pushing database schema..."
cd packages/server
bunx drizzle-kit push --force
cd ../..

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

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  ✓ Hyperscape deployed successfully!"
echo "  ✓ Duel stack managed by pm2 (auto-restart on crash)"
echo ""
echo "  Useful commands:"
echo "    bun run duel:prod:logs     # tail live logs"
echo "    bun run duel:prod:status   # process status"
echo "    bun run duel:prod:restart  # restart stack"
echo "    bun run duel:prod:stop     # stop stack"
echo "════════════════════════════════════════════════════════════"
