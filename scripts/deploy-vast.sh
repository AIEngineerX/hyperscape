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

echo "Running complete compilation..."
# Skip the Tauri app which requires Rust (this is just the server)
bun run turbo run build --filter=!@hyperscape/app

echo "Pumping the database state..."
cd packages/server
bunx drizzle-kit push --force
cd ../..

echo "Tearing down existing duels..."
pkill -f "duel" || true
pkill -f "stream-to-rtmp" || true

echo "Starting new duel instance in background..."
cd /root/hyperscape
nohup bun run duel > /root/hyperscape/duel.log 2>&1 &

echo "CI/CD update complete!"
