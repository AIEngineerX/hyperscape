#!/bin/bash
# Hyperscape CI/CD Deploy for Vast.ai
# Pulls latest, builds, and starts the full duel stack under pm2
set -e

export PATH="/root/.bun/bin:$PATH"
cd /root/hyperscape

LOG_DIR="/root/hyperscape/logs"
mkdir -p "$LOG_DIR"

echo "[deploy] Starting Hyperscape CI/CD update on Vast.ai..."

# ── Pull latest code ──────────────────────────────────────────
echo "[deploy] Pulling latest code..."
git fetch origin
git reset --hard origin/hackathon
git pull origin hackathon

# ── Install system dependencies (needed for native modules) ───
echo "[deploy] Installing system build dependencies..."
apt-get update && apt-get install -y build-essential python3 socat xvfb || true

# ── Install dependencies ──────────────────────────────────────
echo "[deploy] Installing dependencies..."
bun install

# ── Build core packages ──────────────────────────────────────
echo "[deploy] Building core dependencies..."
cd packages/physx-js-webidl && bun run build && cd ../..
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
