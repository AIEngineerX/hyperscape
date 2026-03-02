#!/usr/bin/env bash
# test-betting-e2e-full
#
# Full betting-chain ground-truth runner.
# Runs, in strict order:
#   1) Foundry/Anvil preflight (+ managed Anvil health)
#   2) EVM localhost deploy on Anvil via Forge (direct contract path)
#   3) Deep betting security pass (EVM + Solana contract tests + 100-wallet sims + report verification)
#   4) Betting app local Playwright E2E (interface + on-chain tx assertions)
#   5) Live duel stack boot + verifier (duel loop, bots, betting app, keeper, MM)
#
# Every step writes logs under test-results/betting-full/<timestamp>/.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_DIR="${BETTING_FULL_LOG_DIR:-$PROJECT_DIR/test-results/betting-full/$RUN_ID}"

EVM_RPC_URL="${BETTING_FULL_EVM_RPC_URL:-http://127.0.0.1:8545}"
EVM_RPC_HOST="${EVM_RPC_URL##*://}"
EVM_RPC_HOST="${EVM_RPC_HOST%%/*}"
EVM_RPC_PORT="${EVM_RPC_HOST##*:}"
EVM_RPC_PORT="${EVM_RPC_PORT:-8545}"
ANVIL_DEFAULT_DEPLOYER_PK="${ANVIL_DEFAULT_DEPLOYER_PK:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
ANVIL_DEFAULT_ACCOUNT_0="${ANVIL_DEFAULT_ACCOUNT_0:-0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266}"
ANVIL_DEFAULT_ACCOUNT_1="${ANVIL_DEFAULT_ACCOUNT_1:-0x70997970C51812dc3A010C7d01b50e0d17dc79C8}"

DUEL_VERIFY_TIMEOUT_MS="${DUEL_VERIFY_TIMEOUT_MS:-300000}"
DUEL_VERIFY_FIGHT_TIMEOUT_MS="${DUEL_VERIFY_FIGHT_TIMEOUT_MS:-150000}"
DUEL_VERIFY_RTMP_TIMEOUT_MS="${DUEL_VERIFY_RTMP_TIMEOUT_MS:-120000}"

RUN_EVM_DEPLOY="${RUN_EVM_DEPLOY:-true}"
RUN_DEEP_PASS="${RUN_DEEP_PASS:-true}"
RUN_APP_E2E="${RUN_APP_E2E:-true}"
RUN_DUEL_STACK="${RUN_DUEL_STACK:-true}"

ANVIL_PID=""
MANAGED_ANVIL="false"
DUEL_PID=""
STEP_INDEX=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

mkdir -p "$LOG_DIR"

info() {
  echo -e "${CYAN}[betting:full] $1${NC}"
}

warn() {
  echo -e "${YELLOW}[betting:full] $1${NC}"
}

fail() {
  echo -e "${RED}[betting:full] $1${NC}"
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

slugify() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-'
}

wait_for_anvil_rpc() {
  for _ in {1..60}; do
    if curl -s -X POST "$EVM_RPC_URL" \
      -H "content-type: application/json" \
      -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
      | rg -q '"result"'; then
      return 0
    fi
    sleep 1
  done
  return 1
}

free_solana_test_ports() {
  # Anchor can leave local validators behind after interrupted runs.
  pkill -f "solana-test-validator" >/dev/null 2>&1 || true

  for port in 8899 8900 9900; do
    for _ in {1..8}; do
      local pids
      pids="$(lsof -tiTCP:${port} -sTCP:LISTEN || true)"
      if [[ -z "$pids" ]]; then
        break
      fi
      for pid in $pids; do
        kill "$pid" >/dev/null 2>&1 || true
      done
      sleep 1
    done

    local stubborn
    stubborn="$(lsof -tiTCP:${port} -sTCP:LISTEN || true)"
    if [[ -n "$stubborn" ]]; then
      warn "Force-killing stubborn listeners on port ${port}: ${stubborn}"
      for pid in $stubborn; do
        kill -9 "$pid" >/dev/null 2>&1 || true
      done
    fi
  done
}

run_step() {
  local step_name="$1"
  shift

  STEP_INDEX=$((STEP_INDEX + 1))
  local slug
  slug="$(slugify "$step_name")"
  local logfile
  logfile="$(printf "%s/%02d-%s.log" "$LOG_DIR" "$STEP_INDEX" "$slug")"

  info "STEP ${STEP_INDEX}: ${step_name}"
  info "log: ${logfile}"
  (
    set -o pipefail
    "$@" 2>&1 | tee "$logfile"
  )
}

start_managed_anvil_if_needed() {
  if wait_for_anvil_rpc; then
    warn "Anvil already running at ${EVM_RPC_URL}; reusing existing node"
    return 0
  fi

  local anvil_log="${LOG_DIR}/anvil.log"
  info "Starting managed Anvil at ${EVM_RPC_URL}"
  anvil \
    --silent \
    --host 127.0.0.1 \
    --port "$EVM_RPC_PORT" \
    --chain-id 31337 \
    >"$anvil_log" 2>&1 &
  ANVIL_PID="$!"
  MANAGED_ANVIL="true"

  if ! wait_for_anvil_rpc; then
    tail -n 120 "$anvil_log" || true
    fail "Managed Anvil failed to become ready at ${EVM_RPC_URL}"
  fi
}

stop_duel_stack() {
  if [[ -n "$DUEL_PID" ]] && kill -0 "$DUEL_PID" >/dev/null 2>&1; then
    info "Stopping duel stack (pid $DUEL_PID)"
    kill -INT "$DUEL_PID" >/dev/null 2>&1 || true
    for _ in {1..20}; do
      if ! kill -0 "$DUEL_PID" >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done
    if kill -0 "$DUEL_PID" >/dev/null 2>&1; then
      kill -TERM "$DUEL_PID" >/dev/null 2>&1 || true
    fi
    wait "$DUEL_PID" >/dev/null 2>&1 || true
  fi
}

cleanup() {
  stop_duel_stack
  free_solana_test_ports

  if [[ "$MANAGED_ANVIL" = "true" ]] && [[ -n "$ANVIL_PID" ]] && kill -0 "$ANVIL_PID" >/dev/null 2>&1; then
    info "Stopping managed Anvil (pid $ANVIL_PID)"
    kill "$ANVIL_PID" >/dev/null 2>&1 || true
    wait "$ANVIL_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

info "Run ID: ${RUN_ID}"
info "Logs: ${LOG_DIR}"

run_step "preflight-tools" bash -lc "
  set -euo pipefail
  command -v bun >/dev/null
  command -v node >/dev/null
  command -v curl >/dev/null
  command -v jq >/dev/null
  command -v rg >/dev/null
  command -v forge >/dev/null
  command -v anvil >/dev/null
  command -v anchor >/dev/null
  command -v solana-test-validator >/dev/null
  forge --version
  anvil --version
  anchor --version
  solana-test-validator --version
"

start_managed_anvil_if_needed
run_step "anvil-health" bash -lc "
  set -euo pipefail
  curl -s -X POST '$EVM_RPC_URL' \
    -H 'content-type: application/json' \
    -d '{\"jsonrpc\":\"2.0\",\"method\":\"eth_chainId\",\"params\":[],\"id\":1}' \
    | jq .
"

if [[ "$RUN_EVM_DEPLOY" = "true" ]]; then
  run_step "evm-anvil-forge-deploy" bash -lc "
    set -euo pipefail
    cd '$PROJECT_DIR/packages/evm-contracts'
    DEPLOYER_PK=\"\${ANVIL_DEPLOYER_PRIVATE_KEY:-$ANVIL_DEFAULT_DEPLOYER_PK}\"
    TREASURY=\"\${TREASURY_ADDRESS:-$ANVIL_DEFAULT_ACCOUNT_0}\"
    MARKET_MAKER=\"\${MARKET_MAKER_ADDRESS:-$ANVIL_DEFAULT_ACCOUNT_1}\"
    ORACLE_P0_WEI=\"\${SKILL_ORACLE_P0_WEI:-100000000000000000000}\"
    SKEW_SCALE_WEI=\"\${AGENT_PERP_SKEW_SCALE_WEI:-1000000000000000000000000}\"

    deploy_and_parse() {
      local contract_ref=\"\$1\"
      shift
      local output
      output=\$(forge create \
        --broadcast \
        --rpc-url '$EVM_RPC_URL' \
        --private-key \"\$DEPLOYER_PK\" \
        \"\$contract_ref\" \
        --constructor-args \"\$@\") || return 1
      printf '%s\n' \"\$output\" >&2

      local deployed_to tx_hash deployer
      deployed_to=\$(printf '%s\n' \"\$output\" | rg 'Deployed to:' | awk '{print \$3}')
      tx_hash=\$(printf '%s\n' \"\$output\" | rg 'Transaction hash:' | awk '{print \$3}')
      deployer=\$(printf '%s\n' \"\$output\" | rg 'Deployer:' | awk '{print \$2}')

      jq -n \
        --arg contract \"\$contract_ref\" \
        --arg deployer \"\$deployer\" \
        --arg deployedTo \"\$deployed_to\" \
        --arg txHash \"\$tx_hash\" \
        '{
          contract: \$contract,
          deployer: \$deployer,
          deployedTo: \$deployedTo,
          transactionHash: \$txHash
        }'
    }

    GOLD_CLOB_JSON=\$(deploy_and_parse contracts/GoldClob.sol:GoldClob \"\$TREASURY\" \"\$MARKET_MAKER\")
    MOCK_ERC20_JSON=\$(deploy_and_parse contracts/MockERC20.sol:MockERC20 \"Mock USDC\" \"mUSDC\")
    SKILL_ORACLE_JSON=\$(deploy_and_parse contracts/perps/SkillOracle.sol:SkillOracle \"\$ORACLE_P0_WEI\")

    SKILL_ORACLE_ADDR=\$(printf '%s' \"\$SKILL_ORACLE_JSON\" | jq -r '.deployedTo')
    MOCK_ERC20_ADDR=\$(printf '%s' \"\$MOCK_ERC20_JSON\" | jq -r '.deployedTo')
    AGENT_ENGINE_JSON=\$(deploy_and_parse contracts/perps/AgentPerpEngine.sol:AgentPerpEngine \"\$SKILL_ORACLE_ADDR\" \"\$MOCK_ERC20_ADDR\" \"\$SKEW_SCALE_WEI\")

    jq -n \
      --arg rpcUrl '$EVM_RPC_URL' \
      --arg treasury \"\$TREASURY\" \
      --arg marketMaker \"\$MARKET_MAKER\" \
      --argjson goldClob \"\$GOLD_CLOB_JSON\" \
      --argjson mockErc20 \"\$MOCK_ERC20_JSON\" \
      --argjson skillOracle \"\$SKILL_ORACLE_JSON\" \
      --argjson agentPerpEngine \"\$AGENT_ENGINE_JSON\" \
      '{
        rpcUrl: \$rpcUrl,
        treasury: \$treasury,
        marketMaker: \$marketMaker,
        goldClob: \$goldClob,
        mockErc20: \$mockErc20,
        skillOracle: \$skillOracle,
        agentPerpEngine: \$agentPerpEngine
      }' > '$LOG_DIR/evm-forge-deployments.json'

    cat '$LOG_DIR/evm-forge-deployments.json'
  "
else
  warn "Skipping EVM Anvil deploy (RUN_EVM_DEPLOY=false)"
fi

if [[ "$RUN_DEEP_PASS" = "true" ]]; then
  run_step "evm-contract-tests-forge" bash -lc "
    set -euo pipefail
    cd '$PROJECT_DIR/packages/evm-contracts'
    forge test -vv
  "

  run_step "evm-contract-tests-hardhat" bash -lc "
    set -euo pipefail
    cd '$PROJECT_DIR/packages/evm-contracts'
    env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
      -u http_proxy -u https_proxy -u all_proxy \
      NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost \
      node ./node_modules/hardhat/internal/cli/bootstrap.js test
  "

  free_solana_test_ports
  run_step "solana-contract-tests-anchor" bash -lc "
    set -euo pipefail
    cd '$PROJECT_DIR/packages/gold-betting-demo/anchor'
    bun run test
  "
  free_solana_test_ports

  run_step "evm-100-wallet-simulation" bash -lc "
    set -euo pipefail
    cd '$PROJECT_DIR/packages/evm-contracts'
    node ./node_modules/hardhat/internal/cli/bootstrap.js run scripts/simulate-localnet.ts
  "

  free_solana_test_ports
  run_step "solana-100-wallet-simulation" bash -lc "
    set -euo pipefail
    cd '$PROJECT_DIR/packages/gold-betting-demo/anchor'
    bun run simulate:localnet
  "
  free_solana_test_ports

  run_step "betting-simulation-report-verification" bash -lc "
    set -euo pipefail
    cd '$PROJECT_DIR'
    bun run betting:verify:reports
  "
else
  warn "Skipping deep betting pass (RUN_DEEP_PASS=false)"
fi

if [[ "$RUN_APP_E2E" = "true" ]]; then
  run_step "betting-app-e2e-local" bash -lc "
    set -euo pipefail
    cd '$PROJECT_DIR/packages/gold-betting-demo/app'
    bun run test:e2e:local
  "
else
  warn "Skipping betting app E2E (RUN_APP_E2E=false)"
fi

if [[ "$RUN_DUEL_STACK" = "true" ]]; then
  info "Starting duel stack in background for live verification"
  (
    cd "$PROJECT_DIR"
    bun run duel --fresh --with-mm
  ) >"${LOG_DIR}/duel-stack.log" 2>&1 &
  DUEL_PID="$!"
  info "duel stack pid: ${DUEL_PID}"
  info "duel stack log: ${LOG_DIR}/duel-stack.log"

  run_step "duel-stack-verify" bash -lc "
    set -euo pipefail
    cd '$PROJECT_DIR'
    bun run duel:verify \
      --timeout-ms '$DUEL_VERIFY_TIMEOUT_MS' \
      --fight-timeout-ms '$DUEL_VERIFY_FIGHT_TIMEOUT_MS' \
      --rtmp-timeout-ms '$DUEL_VERIFY_RTMP_TIMEOUT_MS'
  "
else
  warn "Skipping duel stack verify (RUN_DUEL_STACK=false)"
fi

info "All configured steps completed"
echo -e "${GREEN}[betting:full] PASS${NC}"
echo -e "${GREEN}[betting:full] logs: ${LOG_DIR}${NC}"
