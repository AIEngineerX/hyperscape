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
# The git reset may have removed the .env file, so we copy from /tmp
# where the CI/CD workflow wrote the secrets before calling this script
mkdir -p /root/hyperscape/packages/server
if [ -f "/tmp/hyperscape-secrets.env" ]; then
    echo "[deploy] Copying secrets from /tmp/hyperscape-secrets.env to packages/server/.env..."
    cp /tmp/hyperscape-secrets.env /root/hyperscape/packages/server/.env
    echo "[deploy] .env contents (keys only):"
    cut -d= -f1 /root/hyperscape/packages/server/.env
else
    echo "[deploy] WARNING: /tmp/hyperscape-secrets.env not found!"
    echo "[deploy] Trying to recreate from environment variables..."
    {
        [ -n "$DATABASE_URL" ] && echo "DATABASE_URL=$DATABASE_URL"
        [ -n "$TWITCH_STREAM_KEY" ] && echo "TWITCH_STREAM_KEY=$TWITCH_STREAM_KEY"
        [ -n "$X_STREAM_KEY" ] && echo "X_STREAM_KEY=$X_STREAM_KEY"
        [ -n "$X_RTMP_URL" ] && echo "X_RTMP_URL=$X_RTMP_URL"
        [ -n "$KICK_STREAM_KEY" ] && echo "KICK_STREAM_KEY=$KICK_STREAM_KEY"
        [ -n "$KICK_RTMP_URL" ] && echo "KICK_RTMP_URL=$KICK_RTMP_URL"
        [ -n "$SOLANA_DEPLOYER_PRIVATE_KEY" ] && echo "SOLANA_DEPLOYER_PRIVATE_KEY=$SOLANA_DEPLOYER_PRIVATE_KEY"
        # Always disable YouTube
        echo "YOUTUBE_STREAM_KEY="
    } > /root/hyperscape/packages/server/.env
fi
echo "[deploy] Environment variables configured"

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
    pulseaudio \
    pulseaudio-utils \
    mesa-vulkan-drivers \
    vulkan-tools \
    libvulkan1 \
    || true
git lfs install || true

# ── Check GPU and Vulkan support ──────────────────────────────
echo "[deploy] Checking GPU status..."
nvidia-smi || echo "[deploy] WARNING: nvidia-smi not available"

# Force NVIDIA-only Vulkan ICD to avoid conflicts with Mesa ICDs
export VK_ICD_FILENAMES="/usr/share/vulkan/icd.d/nvidia_icd.json"

echo "[deploy] Checking Vulkan support (NVIDIA-only)..."
vulkaninfo --summary 2>/dev/null || echo "[deploy] WARNING: Vulkan may not be available"

# ── Setup Xorg for NVIDIA headless rendering (instead of Xvfb) ──
# Xvfb is a SOFTWARE framebuffer that cannot access the GPU.
# For WebGPU to work, we need Xorg configured for NVIDIA headless rendering.
echo "[deploy] Setting up Xorg for NVIDIA headless GPU rendering..."

# Kill any existing Xvfb or Xorg instances
pkill -9 Xvfb 2>/dev/null || true
pkill -9 Xorg 2>/dev/null || true
sleep 2

# Install Xorg if not present
apt-get install -y xserver-xorg-core xserver-xorg-video-nvidia-* 2>/dev/null || true

# Create NVIDIA headless Xorg config
mkdir -p /etc/X11
cat > /etc/X11/xorg-nvidia-headless.conf << 'XORGEOF'
# NVIDIA Headless Xorg Configuration for WebGPU Streaming
# This config allows GPU-accelerated rendering without a physical display

Section "ServerLayout"
    Identifier     "Layout0"
    Screen      0  "Screen0"
EndSection

Section "Device"
    Identifier     "Device0"
    Driver         "nvidia"
    VendorName     "NVIDIA Corporation"
    Option         "AllowEmptyInitialConfiguration" "True"
    Option         "UseDisplayDevice" "None"
EndSection

Section "Screen"
    Identifier     "Screen0"
    Device         "Device0"
    DefaultDepth    24
    SubSection     "Display"
        Depth       24
        Modes      "1920x1080" "1280x720"
    EndSubSection
EndSection
XORGEOF

# Start Xorg on display :99 with NVIDIA headless config
echo "[deploy] Starting Xorg on :99 with NVIDIA GPU..."
Xorg :99 -config /etc/X11/xorg-nvidia-headless.conf -noreset -logfile /var/log/Xorg.99.log &
XORG_PID=$!
sleep 5

# Verify Xorg started
if kill -0 $XORG_PID 2>/dev/null; then
    echo "[deploy] Xorg :99 started successfully (PID: $XORG_PID)"
    export DISPLAY=:99

    # Verify GPU is accessible through Xorg
    if glxinfo 2>/dev/null | grep -q "NVIDIA"; then
        echo "[deploy] GPU rendering confirmed via Xorg"
    else
        echo "[deploy] WARNING: glxinfo doesn't show NVIDIA - checking X anyway"
    fi
else
    echo "[deploy] WARNING: Xorg failed to start, falling back to Xvfb"
    # Fallback to Xvfb (software rendering - WebGPU won't work)
    Xvfb :99 -screen 0 1920x1080x24 &
    export DISPLAY=:99
    sleep 3
fi

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

# ── Setup PulseAudio for audio capture ────────────────────────
echo "[deploy] Setting up PulseAudio for audio streaming..."

# Kill any existing PulseAudio
pulseaudio --kill 2>/dev/null || true
pkill -9 pulseaudio 2>/dev/null || true
sleep 2

# Setup XDG runtime directory for user-mode PulseAudio
export XDG_RUNTIME_DIR=/tmp/pulse-runtime
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

# Create PulseAudio config directory
mkdir -p /root/.config/pulse

# Create a minimal PulseAudio config that loads the null sink automatically
cat > /root/.config/pulse/default.pa << 'PULSEEOF'
.fail
load-module module-null-sink sink_name=chrome_audio sink_properties=device.description="ChromeAudio"
set-default-sink chrome_audio
load-module module-native-protocol-unix auth-anonymous=1
PULSEEOF

# Start PulseAudio in user mode (more reliable than system mode)
pulseaudio --start --exit-idle-time=-1 --daemonize=yes 2>&1 || true
sleep 3

# Verify PulseAudio is running and has the sink
if pulseaudio --check 2>/dev/null; then
    echo "[deploy] PulseAudio is running in user mode"
    pactl list short sinks 2>/dev/null || true
    # Double-check the chrome_audio sink exists
    if pactl list short sinks 2>/dev/null | grep -q chrome_audio; then
        echo "[deploy] chrome_audio sink is available"
    else
        echo "[deploy] Creating chrome_audio sink manually..."
        pactl load-module module-null-sink sink_name=chrome_audio sink_properties=device.description="ChromeAudio" 2>/dev/null || true
        pactl set-default-sink chrome_audio 2>/dev/null || true
    fi
else
    echo "[deploy] WARNING: PulseAudio failed to start - trying fallback..."
    # Fallback: try starting without config
    pulseaudio -D --exit-idle-time=-1 2>&1 || true
    sleep 2
    pactl load-module module-null-sink sink_name=chrome_audio 2>/dev/null || true
    pactl set-default-sink chrome_audio 2>/dev/null || true
fi

# Export PULSE_SERVER for child processes
export PULSE_SERVER="unix:$XDG_RUNTIME_DIR/pulse/native"
echo "[deploy] PULSE_SERVER=$PULSE_SERVER"

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
    echo "[deploy] SOLANA_DEPLOYER_PRIVATE_KEY is ${SOLANA_DEPLOYER_PRIVATE_KEY:+configured}${SOLANA_DEPLOYER_PRIVATE_KEY:-NOT SET}"
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

# Warmup database connection pool to avoid cold start issues
echo "[deploy] Warming up database connection..."
for i in 1 2 3; do
    if bun -e "
        const { Pool } = require('pg');
        const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
        pool.query('SELECT 1').then(() => { console.log('DB warmup successful'); pool.end(); process.exit(0); }).catch(e => { console.error('DB warmup failed:', e.message); pool.end(); process.exit(1); });
    " 2>/dev/null; then
        echo "[deploy] Database connection verified"
        break
    else
        echo "[deploy] Database warmup attempt $i failed, retrying..."
        sleep 3
    fi
done
cd ../..

# ── Tear down existing processes ──────────────────────────────
echo "[deploy] Tearing down existing processes..."
# Kill PM2 daemon completely so it picks up new environment on restart
# This is critical - pm2 delete only removes processes, not the daemon's cached env
bunx pm2 kill 2>/dev/null || true
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
unset TWITCH_STREAM_KEY X_STREAM_KEY X_RTMP_URL KICK_STREAM_KEY KICK_RTMP_URL 2>/dev/null || true
# Explicitly disable YouTube (we only stream to Twitch, Kick, X)
unset YOUTUBE_STREAM_KEY YOUTUBE_RTMP_STREAM_KEY YOUTUBE_STREAM_URL YOUTUBE_RTMP_URL 2>/dev/null || true
export YOUTUBE_STREAM_KEY=""

# Re-source .env to get the correct stream keys
if [ -f "/root/hyperscape/packages/server/.env" ]; then
    set -a
    source /root/hyperscape/packages/server/.env
    set +a
fi

# Force disable YouTube even if it was in .env
unset YOUTUBE_STREAM_KEY YOUTUBE_RTMP_STREAM_KEY 2>/dev/null || true
export YOUTUBE_STREAM_KEY=""

# Log which keys are configured (masked for security)
echo "[deploy] TWITCH_STREAM_KEY: ${TWITCH_STREAM_KEY:+***configured***}${TWITCH_STREAM_KEY:-NOT SET}"
echo "[deploy] X_STREAM_KEY: ${X_STREAM_KEY:+***configured***}${X_STREAM_KEY:-NOT SET}"
echo "[deploy] X_RTMP_URL: ${X_RTMP_URL:+***configured***}${X_RTMP_URL:-NOT SET}"
echo "[deploy] KICK_STREAM_KEY: ${KICK_STREAM_KEY:+***configured***}${KICK_STREAM_KEY:-NOT SET}"
echo "[deploy] KICK_RTMP_URL: ${KICK_RTMP_URL:+***configured***}${KICK_RTMP_URL:-NOT SET}"
echo "[deploy] YOUTUBE_STREAM_KEY: DISABLED"

# ── Ensure GPU environment is set for PM2 ─────────────────────
# These must be exported so ecosystem.config.cjs and child processes can access them
export DISPLAY="${DISPLAY:-:99}"
export VK_ICD_FILENAMES="/usr/share/vulkan/icd.d/nvidia_icd.json"
# Use Xorg (started above) instead of Xvfb - critical for WebGPU/GPU rendering
export DUEL_CAPTURE_USE_XVFB="false"
echo "[deploy] GPU environment: DISPLAY=$DISPLAY, VK_ICD_FILENAMES=$VK_ICD_FILENAMES, DUEL_CAPTURE_USE_XVFB=$DUEL_CAPTURE_USE_XVFB"

# Verify display is accessible
if xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
    echo "[deploy] Display $DISPLAY is accessible"
else
    echo "[deploy] WARNING: Display $DISPLAY is not accessible"
fi

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
