#!/bin/bash
set -e

echo "Installing prerequisites..."
apt-get update && apt-get install -y curl git jq unzip

echo "Installing Bun..."
curl -fsSL https://bun.sh/install | bash
export PATH="/root/.bun/bin:$PATH"

echo "Installing git-lfs..."
apt-get install -y git-lfs
git lfs install

echo "Installing Docker..."
# It might already have docker.
if ! command -v docker &> /dev/null; then
    apt-get install -y docker.io docker-compose
    systemctl start docker || true
    systemctl enable docker || true
fi

echo "Cloning Repository..."
cd /root
if [ ! -d "hyperscape" ]; then
    git clone https://github.com/HyperscapeAI/hyperscape.git
fi
cd hyperscape

echo "Setting up environment files..."
cp packages/client/.env.example packages/client/.env
cp packages/server/.env.example packages/server/.env

echo "Installing project dependencies..."
bun install

echo "Building project..."
bun run build

echo "Starting CDN..."
bun run cdn:up || echo "CDN may have failed to start (Docker error?)"

echo "Starting game server in background to test..."
# We use nohup to start it, wait for 10 seconds and test if it's listening
nohup bun run dev > dev.log 2>&1 &
sleep 15

if grep -q "Vite ready" dev.log || grep -q "Server listening" dev.log || [ -n "$(lsof -ti:3333)" ]; then
    echo "VERIFICATION SUCCESS: Development server is running."
else
    echo "VERIFICATION FAILED: Development server did not start."
    cat dev.log
    exit 1
fi
