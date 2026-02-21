#!/usr/bin/env bash
# test-arena-multipliers-local
#
# Cross-chain local validation runner for arena points + multiplier logic.
# Runs:
# - Server unit simulations (multiplier/referral/abuse scenarios)
# - EVM localchain contract tests
# - Solana localnet Anchor tests
# - Optional betting app localnet E2E (UI + interfaces)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

RUN_SERVER_TESTS="${RUN_SERVER_TESTS:-true}"
RUN_EVM_TESTS="${RUN_EVM_TESTS:-true}"
RUN_SOLANA_TESTS="${RUN_SOLANA_TESTS:-true}"
RUN_APP_E2E="${RUN_APP_E2E:-false}"

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() {
  echo -e "${CYAN}[arena:test] $1${NC}"
}

warn() {
  echo -e "${YELLOW}[arena:test] $1${NC}"
}

if [ "$RUN_SERVER_TESTS" = "true" ]; then
  info "Running server arena simulation + referral tests..."
  (
    cd "$PROJECT_DIR"
    bun run --cwd packages/server test \
      tests/unit/arena/ArenaService.referrals.test.ts \
      tests/unit/arena/ArenaService.simulation.test.ts
  )
else
  warn "Skipping server tests (RUN_SERVER_TESTS=false)"
fi

if [ "$RUN_EVM_TESTS" = "true" ]; then
  info "Running EVM localchain contract tests..."
  (
    cd "$PROJECT_DIR"
    bun run --cwd packages/evm-contracts test
  )
else
  warn "Skipping EVM tests (RUN_EVM_TESTS=false)"
fi

if [ "$RUN_SOLANA_TESTS" = "true" ]; then
  info "Running Solana localnet Anchor tests..."
  (
    cd "$PROJECT_DIR"
    bun run --cwd packages/gold-betting-demo anchor:build
    cd packages/gold-betting-demo/anchor

    lsof -tiTCP:8899 -sTCP:LISTEN | xargs -r kill || true

    LEDGER_DIR="$(mktemp -d /tmp/hyperscape-sol-ledger.XXXXXX)"
    solana-test-validator \
      --reset \
      --quiet \
      --ledger "$LEDGER_DIR" \
      --bpf-program "A6utqr1N4KP3Tst2tMCqfJR4mhCRNw4M2uN3Nb6nPBcS" "target/deploy/fight_oracle.so" \
      --bpf-program "7pxwReoFYABrSN7rnqusAxniKvrdv3zWDLoVamX5NN3W" "target/deploy/gold_binary_market.so" \
      >/tmp/hyperscape-sol-test.log 2>&1 &
    VALIDATOR_PID=$!

    cleanup_validator() {
      if [ -n "${VALIDATOR_PID:-}" ] && kill -0 "$VALIDATOR_PID" >/dev/null 2>&1; then
        kill "$VALIDATOR_PID" >/dev/null 2>&1 || true
        wait "$VALIDATOR_PID" >/dev/null 2>&1 || true
      fi
    }
    trap cleanup_validator EXIT INT TERM

    READY=0
    for _ in {1..90}; do
      if curl -s -X POST "http://127.0.0.1:8899" \
        -H "content-type: application/json" \
        -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | rg -q '"result":"ok"'; then
        READY=1
        break
      fi
      sleep 1
    done
    if [ "$READY" != "1" ]; then
      echo "[arena:test] Solana local validator did not become ready"
      tail -n 120 /tmp/hyperscape-sol-test.log || true
      exit 1
    fi

    ANCHOR_PROVIDER_URL="http://127.0.0.1:8899" \
    ANCHOR_WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}" \
      bunx ts-mocha -p ./tsconfig.json -t 1000000 tests/gold-betting-demo.ts
  )
else
  warn "Skipping Solana tests (RUN_SOLANA_TESTS=false)"
fi

if [ "$RUN_APP_E2E" = "true" ]; then
  info "Running betting app localnet E2E (Playwright + local validator)..."
  (
    cd "$PROJECT_DIR"
    bun run --cwd packages/gold-betting-demo test:e2e:local
  )
else
  warn "Skipping app E2E (RUN_APP_E2E=false)"
fi

echo -e "${GREEN}[arena:test] PASS${NC}"
