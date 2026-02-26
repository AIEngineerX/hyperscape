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

# ── Restore environment variables after git reset ──────────────
# The git reset may have removed the .env file, so we recreate it
# from environment variables passed via SSH
mkdir -p /root/hyperscape/packages/server
echo "[deploy] Restoring environment variables to packages/server/.env..."
{
    [ -n "$DATABASE_URL" ] && echo "DATABASE_URL=$DATABASE_URL"
    [ -n "$TWITCH_STREAM_KEY" ] && echo "TWITCH_STREAM_KEY=$TWITCH_STREAM_KEY"
    [ -n "$X_STREAM_KEY" ] && echo "X_STREAM_KEY=$X_STREAM_KEY"
    [ -n "$X_RTMP_URL" ] && echo "X_RTMP_URL=$X_RTMP_URL"
} > /root/hyperscape/packages/server/.env
echo "[deploy] Environment variables configured in .env"

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

# ── Load database configuration ────────────────────────────────
# Source .env file to get DATABASE_URL for drizzle-kit and PM2
if [ -f "/root/hyperscape/packages/server/.env" ]; then
    echo "[deploy] Loading database configuration from packages/server/.env..."
    set -a
    source /root/hyperscape/packages/server/.env
    set +a
    echo "[deploy] DATABASE_URL is ${DATABASE_URL:+configured}${DATABASE_URL:-NOT SET}"
else
    echo "[deploy] WARNING: No packages/server/.env file found"
fi

# Warn if DATABASE_URL is still not set
if [ -z "$DATABASE_URL" ]; then
    echo "[deploy] WARNING: DATABASE_URL is not set!"
    echo "[deploy] The server will fail to start without a database connection."
    echo "[deploy] Create /root/hyperscape/packages/server/.env with DATABASE_URL=..."
fi

# ── Setup Solana keypair ─────────────────────────────────────
# The keeper bot and Anchor tools expect a keypair at ~/.config/solana/id.json
# We derive it from SOLANA_DEPLOYER_PRIVATE_KEY environment variable
echo "[deploy] Setting up Solana keypair..."
if [ -n "$SOLANA_DEPLOYER_PRIVATE_KEY" ]; then
    bun run scripts/decode-key.ts && echo "[deploy] Solana keypair configured at ~/.config/solana/id.json" || echo "[deploy] WARNING: Failed to setup Solana keypair"
else
    echo "[deploy] WARNING: SOLANA_DEPLOYER_PRIVATE_KEY not set - skipping keypair setup"
    echo "[deploy] Set this env var to enable Solana/Anchor functionality"
fi

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

# ── Export stream keys before PM2 start ─────────────────────
# These MUST be exported so ecosystem.config.cjs picks them up
# Clear any old/stale stream keys from the environment first
echo "[deploy] Configuring stream keys..."
unset TWITCH_STREAM_KEY X_STREAM_KEY X_RTMP_URL 2>/dev/null || true

# Re-source .env to get the correct stream keys
if [ -f "/root/hyperscape/packages/server/.env" ]; then
    set -a
    source /root/hyperscape/packages/server/.env
    set +a
fi

# Log which keys are configured (masked for security)
echo "[deploy] TWITCH_STREAM_KEY: ${TWITCH_STREAM_KEY:+***configured***}${TWITCH_STREAM_KEY:-NOT SET}"
echo "[deploy] X_STREAM_KEY: ${X_STREAM_KEY:+***configured***}${X_STREAM_KEY:-NOT SET}"
echo "[deploy] X_RTMP_URL: ${X_RTMP_URL:+***configured***}${X_RTMP_URL:-NOT SET}"

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

# ── Diagnostic: Check streaming status ────────────────────────
echo ""
echo "[deploy] ═══ STREAMING DIAGNOSTICS ═══"

# Wait for streaming to initialize (RTMP bridge takes time to start)
echo "[deploy] Waiting 30s for streaming to initialize..."
sleep 30

echo "[deploy] Checking streaming API..."
STREAMING_STATE=$(curl -s "http://localhost:5555/api/streaming/state" --max-time 10 2>/dev/null || echo '{"error": "curl failed"}')
echo "[deploy] Streaming state: $STREAMING_STATE"

echo ""
echo "[deploy] Checking if game client is running on port 3333..."
CLIENT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3333" --max-time 5 2>/dev/null || echo "000")
echo "[deploy] Game client status: $CLIENT_STATUS"

echo ""
echo "[deploy] Checking RTMP status file..."
cat /root/hyperscape/packages/server/public/live/rtmp-status.json 2>/dev/null || echo "[deploy] No RTMP status file found"

echo ""
echo "[deploy] Checking for FFmpeg processes..."
ps aux | grep -i ffmpeg | grep -v grep || echo "[deploy] No FFmpeg processes running"

echo ""
echo "[deploy] Checking for running stream processes..."
ps aux | grep -E "stream-to-rtmp|rtmp-bridge" | grep -v grep || echo "[deploy] No stream processes found"

echo ""
echo "[deploy] Recent PM2 logs (last 200 lines, filtered for streaming):"
bunx pm2 logs hyperscape-duel --nostream --lines 200 2>/dev/null | grep -iE "rtmp|ffmpeg|stream|capture|destination|twitch|kick|frame|fps|bitrate|error" | tail -100 || echo "[deploy] Could not get filtered PM2 logs"

echo ""
echo "[deploy] Full recent PM2 error logs:"
bunx pm2 logs hyperscape-duel --nostream --lines 50 --err 2>/dev/null || echo "[deploy] Could not get PM2 error logs"

echo ""
echo "[deploy] ═══ END DIAGNOSTICS ═══"
