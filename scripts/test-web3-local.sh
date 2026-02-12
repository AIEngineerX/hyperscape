#!/usr/bin/env bash
# test-web3-local
#
# Deterministic local on-chain validation flow:
# 1) Ensure Anvil is running (or start managed Anvil with persistent state)
# 2) Deploy/redeploy contracts
# 3) Seed items + shops
# 4) Run smoke checks
# 5) Run full on-chain E2E + anti-cheat suite

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

ANVIL_RPC_URL="${ANVIL_RPC_URL:-http://127.0.0.1:8545}"
ANVIL_STATE_PATH="${ANVIL_STATE_PATH:-$PROJECT_DIR/.anvil/state.json}"
FORCE_REDEPLOY="${FORCE_REDEPLOY:-true}"
SKIP_SEED="${SKIP_SEED:-false}"
SKIP_SMOKE="${SKIP_SMOKE:-false}"
SKIP_E2E="${SKIP_E2E:-false}"
KEEP_ANVIL="${KEEP_ANVIL:-false}"
DEFAULT_ANVIL_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

ANVIL_PID=""
MANAGED_ANVIL="false"

info() {
  echo -e "${CYAN}[web3:test] $1${NC}"
}

warn() {
  echo -e "${YELLOW}[web3:test] $1${NC}"
}

fail() {
  echo -e "${RED}[web3:test] $1${NC}"
  exit 1
}

cleanup() {
  if [ "$MANAGED_ANVIL" = "true" ] && [ -n "${ANVIL_PID:-}" ] && [ "$KEEP_ANVIL" != "true" ]; then
    echo -e "\n${YELLOW}[web3:test] Shutting down managed Anvil...${NC}"
    kill "$ANVIL_PID" 2>/dev/null || true
    wait 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

read_world_address() {
  local latest_file="$PROJECT_DIR/packages/contracts/deploys/31337/latest.json"
  if [ ! -f "$latest_file" ]; then
    echo ""
    return
  fi

  node -e "const fs=require('fs'); const p=process.argv[1]; const j=JSON.parse(fs.readFileSync(p,'utf8')); process.stdout.write(j.worldAddress||'')" "$latest_file" 2>/dev/null || true
}

world_code() {
  local address="$1"
  if [ -z "$address" ]; then
    echo "0x"
    return
  fi
  curl -s -X POST "$ANVIL_RPC_URL" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getCode\",\"params\":[\"$address\",\"latest\"],\"id\":1}" \
    | node -e "let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{try{const j=JSON.parse(s); process.stdout.write(j.result||'0x')}catch{process.stdout.write('0x')}})"
}

ensure_contract_deps() {
  if [ ! -d "$PROJECT_DIR/node_modules/@latticexyz" ]; then
    warn "MUD dependencies missing, installing contracts workspace deps..."
    bun install --cwd "$PROJECT_DIR/packages/contracts"
  fi
}

require_cmd bun
require_cmd node
require_cmd anvil
require_cmd curl

mkdir -p "$(dirname "$ANVIL_STATE_PATH")"

export ANVIL_RPC_URL
export CHAIN="anvil"
export PRIVATE_KEY="${PRIVATE_KEY:-$DEFAULT_ANVIL_PRIVATE_KEY}"
export OPERATOR_PRIVATE_KEY="${OPERATOR_PRIVATE_KEY:-$PRIVATE_KEY}"

info "Checking for existing Anvil at $ANVIL_RPC_URL..."
if "$SCRIPT_DIR/wait-for-anvil.sh" 2 >/dev/null 2>&1; then
  warn "Detected running Anvil; reusing external node."
else
  info "Starting managed Anvil (state: $ANVIL_STATE_PATH)..."
  anvil --silent --chain-id 31337 --state "$ANVIL_STATE_PATH" &
  ANVIL_PID=$!
  MANAGED_ANVIL="true"
  "$SCRIPT_DIR/wait-for-anvil.sh" 25 || fail "Anvil failed to start"
fi

ensure_contract_deps

WORLD_ADDRESS="$(read_world_address)"
CURRENT_CODE="$(world_code "$WORLD_ADDRESS")"
DEPLOY_NEEDED="false"

if [ "$FORCE_REDEPLOY" = "true" ]; then
  DEPLOY_NEEDED="true"
elif [ -z "$WORLD_ADDRESS" ] || [ "$WORLD_ADDRESS" = "0x0" ] || [ "$CURRENT_CODE" = "0x" ]; then
  DEPLOY_NEEDED="true"
fi

if [ "$DEPLOY_NEEDED" = "true" ]; then
  info "Deploying contracts to Anvil..."
  (cd "$PROJECT_DIR" && bun run contracts:deploy:local)
  WORLD_ADDRESS="$(read_world_address)"
  [ -n "$WORLD_ADDRESS" ] || fail "Failed to read world address from deploy output"

  if [ "$SKIP_SEED" != "true" ]; then
    info "Seeding item registry..."
    (cd "$PROJECT_DIR" && WORLD_ADDRESS="$WORLD_ADDRESS" bun run web3:seed:items)
    info "Seeding shops..."
    (cd "$PROJECT_DIR" && WORLD_ADDRESS="$WORLD_ADDRESS" bun run web3:seed:shops)
  else
    warn "Skipping seed step (SKIP_SEED=true)"
  fi
else
  info "Reusing deployed world: $WORLD_ADDRESS"
fi

export WORLD_ADDRESS
export MODE="web3"

if [ "$SKIP_SMOKE" != "true" ]; then
  info "Running on-chain smoke checks..."
  (cd "$PROJECT_DIR" && WORLD_ADDRESS="$WORLD_ADDRESS" bun run web3:test:onchain)
else
  warn "Skipping smoke checks (SKIP_SMOKE=true)"
fi

if [ "$SKIP_E2E" != "true" ]; then
  info "Running on-chain E2E + anti-cheat suite..."
  (cd "$PROJECT_DIR" && WORLD_ADDRESS="$WORLD_ADDRESS" bun run web3:test:e2e)
else
  warn "Skipping E2E suite (SKIP_E2E=true)"
fi

echo -e "${GREEN}[web3:test] PASS${NC}"
echo -e "${GREEN}  RPC:   $ANVIL_RPC_URL${NC}"
echo -e "${GREEN}  World: $WORLD_ADDRESS${NC}"
