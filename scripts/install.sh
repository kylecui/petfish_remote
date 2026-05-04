#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v node &> /dev/null; then
  echo "Error: Node.js is required (>=20)" >&2
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "Error: Node.js >= 20 required, got v$NODE_VERSION" >&2
  exit 1
fi

echo "Installing dependencies..."
npm install

echo "Building..."
npm run build

echo "Setting up runtime directory..."
mkdir -p .runtime/attachments .runtime/logs

echo "Done. Copy .env.example to .env and configure your bot token."
echo "Then run: npm run dev"
