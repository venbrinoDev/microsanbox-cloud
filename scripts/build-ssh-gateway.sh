#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GATEWAY_SRC="${ROOT_DIR}/apps/ssh-gateway"
OUT_DIR="${ROOT_DIR}/data/ssh"

mkdir -p "$OUT_DIR"

echo "Building ssh-gateway for host platform..."
cd "$GATEWAY_SRC"
go build -o "$OUT_DIR/ssh-gateway" .
echo "Done: $OUT_DIR/ssh-gateway ($(wc -c < "$OUT_DIR/ssh-gateway") bytes)"
