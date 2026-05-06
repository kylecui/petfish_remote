#!/usr/bin/env bash
# petfish-connect.sh — Start a petfish-remote connector for the current opencode session.
# Usage:
#   petfish-connect.sh [connector.yaml path]
#
# Designed to run as a background sidecar alongside opencode.
# Generates a connector.yaml if none exists, then starts the connector process.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PETFISH_REMOTE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

CONFIG_PATH="${1:-$(pwd)/connector.yaml}"

if [ ! -f "$CONFIG_PATH" ]; then
  echo "⚠ No connector.yaml found at $CONFIG_PATH"
  echo ""
  echo "Generate one with:"
  echo ""
  echo "  cat > connector.yaml <<EOF"
  echo "  connectorId: auto"
  echo "  serverUrl: \"wss://remote.petfish.ai/ws/connector\""
  echo "  token: \"YOUR_CONNECTOR_TOKEN\""
  echo "  reconnectIntervalMs: 5000"
  echo "  maxReconnectIntervalMs: 60000"
  echo ""
  echo "  projects:"
  echo "    - id: $(basename "$(pwd)")"
  echo "    path: $(pwd)"
  echo "    opencodeBin: opencode"
  echo "  EOF"
  echo ""
  echo "Then re-run: $0"
  exit 1
fi

echo "🐟 petfish-connect: starting connector"
echo "   config: $CONFIG_PATH"
echo "   project: $(pwd)"

exec node "$PETFISH_REMOTE_DIR/dist/connector/main.js" "$CONFIG_PATH"
