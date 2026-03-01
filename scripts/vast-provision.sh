#!/bin/bash
# Vast.ai GPU Instance Provisioner
# Automatically finds and rents a GPU instance with display driver support
# CRITICAL: gpu_display_active=true is REQUIRED for WebGPU streaming
#
# Usage:
#   ./vast-provision.sh              # Interactive mode
#   ./vast-provision.sh --auto       # Non-interactive, auto-select best offer
#   ./vast-provision.sh --search     # Just search, don't provision
#
# Environment:
#   VAST_API_KEY  - Required. Your Vast.ai API key

set -e

# ── Configuration ────────────────────────────────────────────────────────────
# Minimum requirements for WebGPU streaming
# CRITICAL: gpu_display_active=true is non-negotiable for WebGPU
MIN_GPU_RAM=20          # GB - RTX 4090 has 24GB
MIN_RELIABILITY=0.95    # 95% uptime
MAX_PRICE_PER_HOUR=2.0  # USD per hour
PREFERRED_GPUS="RTX_4090,RTX_3090,RTX_A6000,A100"
DISK_SPACE=120          # GB minimum (increased for builds)

# ── Colors for output ────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ── Check vastai CLI ─────────────────────────────────────────────────────────
if ! command -v vastai &> /dev/null; then
    log_error "vastai CLI not found. Install with: pip install vastai"
    exit 1
fi

# Check if logged in
if ! vastai show user &> /dev/null; then
    log_error "Not logged into Vast.ai. Run: vastai set api-key YOUR_API_KEY"
    exit 1
fi

log_info "Vast.ai CLI ready"

# ── Search for instances with display support ────────────────────────────────
log_info "═══════════════════════════════════════════════════════════════════"
log_info "Searching for GPU instances with DISPLAY DRIVER support..."
log_info "Filter: gpu_display_active=true (REQUIRED for WebGPU)"
log_info "═══════════════════════════════════════════════════════════════════"

# Build search query
# CRITICAL: gpu_display_active=true ensures the GPU has display driver support
SEARCH_QUERY="gpu_display_active=true reliability>=${MIN_RELIABILITY} gpu_ram>=${MIN_GPU_RAM} disk_space>=${DISK_SPACE} dph<=${MAX_PRICE_PER_HOUR}"

log_info "Search query: $SEARCH_QUERY"

# Search and get results as JSON
SEARCH_RESULTS=$(vastai search offers "$SEARCH_QUERY" --raw 2>/dev/null || echo "[]")

# Count results
RESULT_COUNT=$(echo "$SEARCH_RESULTS" | jq 'length' 2>/dev/null || echo "0")

if [ "$RESULT_COUNT" = "0" ]; then
    log_warn "No instances found with gpu_display_active=true"
    log_info "Trying broader search without display filter for comparison..."

    BROAD_RESULTS=$(vastai search offers "reliability>=${MIN_RELIABILITY} gpu_ram>=${MIN_GPU_RAM}" --raw 2>/dev/null || echo "[]")
    BROAD_COUNT=$(echo "$BROAD_RESULTS" | jq 'length' 2>/dev/null || echo "0")

    log_info "Found $BROAD_COUNT instances WITHOUT display filter"
    log_error "Unfortunately, none have gpu_display_active=true"
    log_error "WebGPU streaming REQUIRES display driver support."
    log_info ""
    log_info "Options:"
    log_info "  1. Try again later - availability changes frequently"
    log_info "  2. Increase MAX_PRICE_PER_HOUR in this script"
    log_info "  3. Use a VM-based instance instead of Docker container"
    log_info "  4. Contact Vast.ai support about display-capable instances"
    exit 1
fi

log_success "Found $RESULT_COUNT instances with display driver support!"

# Show top 5 options
log_info ""
log_info "Top 5 available instances:"
log_info "─────────────────────────────────────────────────────────────────"
echo "$SEARCH_RESULTS" | jq -r '.[0:5] | .[] | "ID: \(.id) | GPU: \(.gpu_name) | RAM: \(.gpu_ram)GB | \(.dph_total|tostring|.[0:5])$/hr | Reliability: \(.reliability|tostring|.[0:4]) | Display: \(.gpu_display_active)"'
log_info "─────────────────────────────────────────────────────────────────"

# Get the best offer (first one, sorted by value)
BEST_OFFER=$(echo "$SEARCH_RESULTS" | jq '.[0]')
OFFER_ID=$(echo "$BEST_OFFER" | jq -r '.id')
GPU_NAME=$(echo "$BEST_OFFER" | jq -r '.gpu_name')
GPU_RAM=$(echo "$BEST_OFFER" | jq -r '.gpu_ram')
PRICE=$(echo "$BEST_OFFER" | jq -r '.dph_total')
RELIABILITY=$(echo "$BEST_OFFER" | jq -r '.reliability')
DISPLAY_ACTIVE=$(echo "$BEST_OFFER" | jq -r '.gpu_display_active')

log_info ""
log_info "Best offer selected:"
log_info "  Offer ID: $OFFER_ID"
log_info "  GPU: $GPU_NAME ($GPU_RAM GB)"
log_info "  Price: \$$PRICE/hour"
log_info "  Reliability: $RELIABILITY"
log_info "  Display Active: $DISPLAY_ACTIVE"

# Confirm display support
if [ "$DISPLAY_ACTIVE" != "true" ]; then
    log_error "Selected offer does not have display support!"
    exit 1
fi

# ── Rent the instance ────────────────────────────────────────────────────────
log_info ""
log_info "═══════════════════════════════════════════════════════════════════"
log_info "Renting instance $OFFER_ID..."
log_info "═══════════════════════════════════════════════════════════════════"

# Use Ubuntu 22.04 with CUDA for best compatibility
IMAGE="nvidia/cuda:12.2.0-devel-ubuntu22.04"
DISK_GB=100

# Create the instance
# --ssh flag ensures SSH access is enabled
CREATE_RESULT=$(vastai create instance $OFFER_ID \
    --image "$IMAGE" \
    --disk $DISK_GB \
    --ssh \
    --raw 2>&1)

if echo "$CREATE_RESULT" | grep -q "error\|Error\|ERROR"; then
    log_error "Failed to create instance: $CREATE_RESULT"
    exit 1
fi

# Extract instance ID from result
INSTANCE_ID=$(echo "$CREATE_RESULT" | jq -r '.new_contract' 2>/dev/null || echo "$CREATE_RESULT" | grep -oP '\d+' | head -1)

if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" = "null" ]; then
    log_error "Could not get instance ID from: $CREATE_RESULT"
    exit 1
fi

log_success "Instance created! ID: $INSTANCE_ID"

# ── Wait for instance to be ready ────────────────────────────────────────────
log_info ""
log_info "Waiting for instance to be ready..."

MAX_WAIT=300  # 5 minutes
WAITED=0
READY=false

while [ $WAITED -lt $MAX_WAIT ]; do
    INSTANCE_INFO=$(vastai show instance $INSTANCE_ID --raw 2>/dev/null || echo "{}")
    STATUS=$(echo "$INSTANCE_INFO" | jq -r '.actual_status' 2>/dev/null || echo "unknown")

    log_info "Status: $STATUS (waited ${WAITED}s)"

    if [ "$STATUS" = "running" ]; then
        READY=true
        break
    fi

    sleep 10
    WAITED=$((WAITED + 10))
done

if [ "$READY" != "true" ]; then
    log_error "Instance did not become ready within ${MAX_WAIT}s"
    log_info "You may need to check manually: vastai show instance $INSTANCE_ID"
    exit 1
fi

log_success "Instance is running!"

# ── Get SSH connection details ───────────────────────────────────────────────
log_info ""
log_info "Getting SSH connection details..."

INSTANCE_INFO=$(vastai show instance $INSTANCE_ID --raw)
SSH_HOST=$(echo "$INSTANCE_INFO" | jq -r '.ssh_host')
SSH_PORT=$(echo "$INSTANCE_INFO" | jq -r '.ssh_port')
PUBLIC_IP=$(echo "$INSTANCE_INFO" | jq -r '.public_ipaddr')

log_info ""
log_info "═══════════════════════════════════════════════════════════════════"
log_success "Instance provisioned successfully!"
log_info "═══════════════════════════════════════════════════════════════════"
log_info ""
log_info "Instance Details:"
log_info "  Instance ID: $INSTANCE_ID"
log_info "  GPU: $GPU_NAME ($GPU_RAM GB)"
log_info "  Display Driver: ENABLED ✓"
log_info "  SSH Host: $SSH_HOST"
log_info "  SSH Port: $SSH_PORT"
log_info "  Public IP: $PUBLIC_IP"
log_info ""
log_info "SSH Connection:"
log_info "  ssh -p $SSH_PORT root@$SSH_HOST"
log_info ""
log_info "Update GitHub Secrets:"
log_info "  VAST_HOST=$SSH_HOST"
log_info "  VAST_PORT=$SSH_PORT"
log_info ""

# ── Save connection info ─────────────────────────────────────────────────────
CONFIG_FILE="/tmp/vast-instance-config.env"
cat > "$CONFIG_FILE" << EOF
# Vast.ai Instance Configuration
# Generated: $(date -Iseconds)
VAST_INSTANCE_ID=$INSTANCE_ID
VAST_HOST=$SSH_HOST
VAST_PORT=$SSH_PORT
VAST_PUBLIC_IP=$PUBLIC_IP
VAST_GPU=$GPU_NAME
VAST_GPU_RAM=$GPU_RAM
VAST_DISPLAY_ACTIVE=true
EOF

log_info "Configuration saved to: $CONFIG_FILE"
log_info ""
log_info "To update GitHub secrets automatically, run:"
log_info "  gh secret set VAST_HOST --body '$SSH_HOST'"
log_info "  gh secret set VAST_PORT --body '$SSH_PORT'"
log_info ""
log_info "Then trigger deployment:"
log_info "  gh workflow run deploy-vast.yml"
log_info ""
log_info "═══════════════════════════════════════════════════════════════════"
