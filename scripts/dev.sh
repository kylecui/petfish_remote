#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

mkdir -p .runtime/attachments .runtime/logs

exec npx tsx watch src/main.ts
