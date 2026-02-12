#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="$(cd "$APP_DIR/.." && pwd)"
ANCHOR_DIR="$DEMO_DIR/anchor"
LEDGER_DIR="$ANCHOR_DIR/.e2e-ledger"
VALIDATOR_LOG="$APP_DIR/.e2e-validator.log"
APP_LOG="$APP_DIR/.e2e-app.log"
PROGRAM_ORACLE_ID="EW9GwxawnPEHA4eFgqd2oq9t55gSG4ReNqPRyG6Ui6PF"
PROGRAM_MARKET_ID="23YJWaC8AhEufH8eYdPMAouyWEgJ5MQWyvz3z8akTtR6"
APP_PORT="${E2E_APP_PORT:-4181}"
RPC_URL="http://127.0.0.1:8899"

VALIDATOR_PID=""
APP_PID=""

cleanup() {
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" >/dev/null 2>&1; then
    kill "$APP_PID" >/dev/null 2>&1 || true
    wait "$APP_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$VALIDATOR_PID" ]] && kill -0 "$VALIDATOR_PID" >/dev/null 2>&1; then
    kill "$VALIDATOR_PID" >/dev/null 2>&1 || true
    wait "$VALIDATOR_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

wait_for_rpc() {
  for _ in {1..90}; do
    if curl -s -X POST "$RPC_URL" \
      -H "content-type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | rg -q '"result":"ok"'; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_app() {
  local url="$1"
  for _ in {1..90}; do
    if curl -s -o /dev/null -w "%{http_code}" "$url" | rg -q "200"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

kill_listeners() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN || true)"
  if [[ -n "$pids" ]]; then
    echo "[e2e] clearing existing listeners on :$port"
    for pid in $pids; do
      kill "$pid" >/dev/null 2>&1 || true
    done
    sleep 1
  fi
}

kill_listeners "$APP_PORT"
kill_listeners 8899

echo "[e2e] building anchor programs"
bun run --cwd "$ANCHOR_DIR" build >/tmp/gold-betting-demo-e2e-build.log 2>&1

echo "[e2e] starting local validator"
rm -rf "$LEDGER_DIR"
solana-test-validator \
  --reset \
  --quiet \
  --ledger "$LEDGER_DIR" \
  --bpf-program "$PROGRAM_ORACLE_ID" "$ANCHOR_DIR/target/deploy/fight_oracle.so" \
  --bpf-program "$PROGRAM_MARKET_ID" "$ANCHOR_DIR/target/deploy/gold_binary_market.so" \
  >"$VALIDATOR_LOG" 2>&1 &
VALIDATOR_PID="$!"

if ! wait_for_rpc; then
  echo "[e2e] validator did not become ready"
  tail -n 80 "$VALIDATOR_LOG" || true
  exit 1
fi

echo "[e2e] seeding localnet state + writing .env.e2e"
bun run "$APP_DIR/tests/e2e/setup-localnet.ts"

echo "[e2e] starting app on :$APP_PORT"
bun run --cwd "$APP_DIR" dev --mode e2e --port "$APP_PORT" >"$APP_LOG" 2>&1 &
APP_PID="$!"

if ! wait_for_app "http://127.0.0.1:$APP_PORT/"; then
  echo "[e2e] app did not become ready"
  tail -n 80 "$APP_LOG" || true
  exit 1
fi

echo "[e2e] running playwright tests"
E2E_BASE_URL="http://127.0.0.1:$APP_PORT" \
  bunx playwright test --config "$APP_DIR/tests/e2e/playwright.config.ts" "$@"
