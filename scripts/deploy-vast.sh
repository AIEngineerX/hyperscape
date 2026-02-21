#!/bin/bash
set -e

echo "Starting Hyperscape CI/CD update on Vast.ai environment..."
export PATH="/root/.bun/bin:$PATH"
cd /root/hyperscape

echo "Pulling latest code..."
git fetch origin
git reset --hard origin/hackathon
git pull origin hackathon

echo "Installing node dependencies..."
bun install

echo "Building core dependencies..."
cd packages/physx-js-webidl && bun run build && cd ../..
cd packages/shared && bun run build && cd ../..

echo "Pumping the database state..."
cd packages/server
bunx drizzle-kit push --force
cd ../..

echo "Tearing down existing processes..."
pkill -f "bun.*build/index.js" || true
pkill -f "bun.*dev-final" || true
pkill -f "bun.*dev.mjs" || true
pkill -f "stream-to-rtmp" || true
sleep 2

echo "Starting server in background..."
cd /root/hyperscape
nohup bun run dev > /root/hyperscape/server.log 2>&1 &

echo "CI/CD update complete! Server PID: $!"
