#!/bin/bash
# dev:web3 - Start Hyperscape in Web3 mode against local Anvil
#
# Sequence:
# 1. Start Anvil (background)
# 2. Wait for Anvil to be ready (poll RPC)
# 3. Deploy MUD contracts
# 4. Start game server in Web3 mode + client (background, concurrent)
#
# Usage: bun run dev:web3

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

cleanup() {
    echo -e "\n${YELLOW}[dev:web3] Shutting down...${NC}"
    kill $ANVIL_PID 2>/dev/null || true
    kill $SERVER_PID 2>/dev/null || true
    kill $CLIENT_PID 2>/dev/null || true
    wait 2>/dev/null
    echo -e "${GREEN}[dev:web3] Done.${NC}"
}
trap cleanup EXIT INT TERM

# Step 1: Start Anvil
echo -e "${YELLOW}[dev:web3] Starting Anvil...${NC}"
anvil --silent &
ANVIL_PID=$!

# Step 2: Wait for Anvil
echo -e "${CYAN}[dev:web3] Waiting for Anvil...${NC}"
"$SCRIPT_DIR/wait-for-anvil.sh" 15
if [ $? -ne 0 ]; then
    echo -e "${RED}[dev:web3] Anvil failed to start${NC}"
    exit 1
fi

# Step 3: Deploy contracts
echo -e "${CYAN}[dev:web3] Deploying MUD contracts...${NC}"
cd "$PROJECT_DIR/packages/contracts"
npx mud deploy 2>&1 | tail -5

# Extract world address from deploy output
WORLD_ADDRESS=$(npx mud deploy 2>&1 | grep -i "world.*deployed\|worldAddress" | grep -oE '0x[a-fA-F0-9]{40}' | head -1)
if [ -z "$WORLD_ADDRESS" ]; then
    echo -e "${YELLOW}[dev:web3] Could not auto-detect World address from deploy output${NC}"
    echo -e "${YELLOW}[dev:web3] Set WORLD_ADDRESS manually if needed${NC}"
fi

cd "$PROJECT_DIR"

# Step 4: Start server + client concurrently
echo -e "${GREEN}[dev:web3] Starting server (Web3 mode) and client...${NC}"
export MODE=web3
export CHAIN=anvil
export WORLD_ADDRESS="${WORLD_ADDRESS:-0x0}"

# Start server
cd "$PROJECT_DIR"
bun run dev:server &
SERVER_PID=$!

# Start client
bun run dev:client &
CLIENT_PID=$!

echo -e "${GREEN}[dev:web3] ✅ Running on Anvil (Web3 mode)${NC}"
echo -e "${GREEN}   Anvil:   http://127.0.0.1:8545${NC}"
echo -e "${GREEN}   World:   ${WORLD_ADDRESS:-not detected}${NC}"
echo -e "${GREEN}   Press Ctrl+C to stop${NC}"

# Wait for any child to exit
wait
