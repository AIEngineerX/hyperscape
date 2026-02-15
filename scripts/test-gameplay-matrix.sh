#!/usr/bin/env bash
# test-gameplay-matrix
#
# Deterministic end-to-end gameplay validation across web2 + web3 paths.
# This script runs real-world/system tests (no mocks) for:
# - Terrain/building navigation (walk into house)
# - Two-player trading
# - Pickup/equip and inventory movement
# - Mob kill + loot
# - PvP death + corpse gear transfer
# - Duel result recording
# - On-chain anti-cheat/unauthorized write protection
# - Headed login -> character select/create -> in-game entry (web2 + web3)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

ANVIL_RPC_URL="${ANVIL_RPC_URL:-http://127.0.0.1:8545}"
CLIENT_PROJECT="${CLIENT_PROJECT:-chromium}"
CLIENT_FLOW_SPEC="${CLIENT_FLOW_SPEC:-tests/e2e/full-flow.spec.ts}"
CLIENT_FLOW_GREP="${CLIENT_FLOW_GREP:-logs in, reaches character select, and enters the world}"
RUN_WEB2="${RUN_WEB2:-true}"
RUN_WEB3="${RUN_WEB3:-true}"
RUN_CLIENT_WEB2="${RUN_CLIENT_WEB2:-true}"
RUN_CLIENT_WEB3="${RUN_CLIENT_WEB3:-true}"
FORCE_REDEPLOY="${FORCE_REDEPLOY:-true}"

info() {
  echo -e "${CYAN}[gameplay:matrix] $1${NC}"
}

warn() {
  echo -e "${YELLOW}[gameplay:matrix] $1${NC}"
}

fail() {
  echo -e "${RED}[gameplay:matrix] $1${NC}"
  exit 1
}

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

run_web2_server_scenarios() {
  info "Running web2 gameplay system suite (terrain/building, trade, inventory, combat sessions)..."
  bun --cwd "$PROJECT_DIR/packages/server" vitest run \
    tests/integration/building-navigation.integration.test.ts \
    tests/integration/trade/trade.integration.test.ts \
    tests/integration/inventory-move.integration.test.ts \
    tests/unit/systems/ServerNetwork/InteractionSessionManager.combat.test.ts
}

run_client_full_flow() {
  local mode="$1"
  info "Running headed client flow in ${mode} mode (${CLIENT_FLOW_SPEC})..."

  local -a client_args
  client_args=(playwright test "$CLIENT_FLOW_SPEC" --project="$CLIENT_PROJECT" --reporter=list)
  if [ -n "$CLIENT_FLOW_GREP" ]; then
    client_args+=(--grep "$CLIENT_FLOW_GREP")
  fi

  if [ "$mode" = "web2" ]; then
    bun --cwd "$PROJECT_DIR/packages/client" "${client_args[@]}"
    return
  fi

  local world_address
  world_address="$(read_world_address)"
  [ -n "$world_address" ] || fail "WORLD_ADDRESS not found after web3 deployment"

  MODE=web3 \
  CHAIN=anvil \
  ANVIL_RPC_URL="$ANVIL_RPC_URL" \
  WORLD_ADDRESS="$world_address" \
  bun --cwd "$PROJECT_DIR/packages/client" "${client_args[@]}"
}

run_web3_onchain_and_client() {
  local anvil_was_running="false"
  if "$SCRIPT_DIR/wait-for-anvil.sh" 2 >/dev/null 2>&1; then
    anvil_was_running="true"
    info "Reusing existing Anvil at $ANVIL_RPC_URL"
  else
    info "No running Anvil detected - web3 suite will start managed Anvil"
  fi

  info "Running web3 deploy/seed + on-chain smoke/e2e + anti-cheat suite..."
  (
    cd "$PROJECT_DIR"
    ANVIL_RPC_URL="$ANVIL_RPC_URL" \
    KEEP_ANVIL=true \
    FORCE_REDEPLOY="$FORCE_REDEPLOY" \
    SKIP_SMOKE=false \
    SKIP_E2E=false \
    bash scripts/test-web3-local.sh
  )

  if [ "$RUN_CLIENT_WEB3" = "true" ]; then
    run_client_full_flow "web3"
  fi

  if [ "$anvil_was_running" = "false" ]; then
    info "Stopping managed Anvil started for web3 suite..."
    pkill -f "anvil.*--chain-id 31337" >/dev/null 2>&1 || true
  fi
}

require_cmd bun
require_cmd node
require_cmd bash

info "Scenario matrix:"
echo "  - Terrain -> building entry pathing"
echo "  - Two-player trading"
echo "  - Pickup/equip and inventory movement"
echo "  - Mob kill + loot"
echo "  - PvP death + corpse gear transfer"
echo "  - Duel result recording"
echo "  - On-chain anti-cheat checks"
echo "  - Headed login -> character -> world entry (web2/web3)"

if [ "$RUN_WEB2" = "true" ]; then
  run_web2_server_scenarios
  if [ "$RUN_CLIENT_WEB2" = "true" ]; then
    run_client_full_flow "web2"
  fi
else
  warn "Skipping web2 suite (RUN_WEB2=false)"
fi

if [ "$RUN_WEB3" = "true" ]; then
  run_web3_onchain_and_client
else
  warn "Skipping web3 suite (RUN_WEB3=false)"
fi

echo -e "${GREEN}[gameplay:matrix] PASS${NC}"
