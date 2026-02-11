#!/bin/bash
# Wait for Anvil to be ready by polling the RPC endpoint.
# Usage: ./scripts/wait-for-anvil.sh [timeout_seconds]
#
# Returns 0 when Anvil responds, 1 on timeout.

TIMEOUT=${1:-30}
RPC_URL=${ANVIL_RPC_URL:-http://127.0.0.1:8545}
ELAPSED=0

echo "[wait-for-anvil] Waiting for Anvil at $RPC_URL (timeout: ${TIMEOUT}s)..."

while [ $ELAPSED -lt $TIMEOUT ]; do
    # Send eth_blockNumber RPC call
    RESPONSE=$(curl -s -X POST "$RPC_URL" \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
        2>/dev/null)

    if echo "$RESPONSE" | grep -q '"result"'; then
        echo "[wait-for-anvil] Anvil is ready (${ELAPSED}s)"
        exit 0
    fi

    sleep 1
    ELAPSED=$((ELAPSED + 1))
done

echo "[wait-for-anvil] TIMEOUT after ${TIMEOUT}s"
exit 1
