#!/bin/bash
set -euo pipefail

GATEWAY_SRC="$(cd "$(dirname "$0")/../apps/ssh-gateway" && pwd)"
OUT_DIR="$(cd "$(dirname "$0")/../data/ssh" && pwd)"

mkdir -p "$OUT_DIR"

echo "Building ssh-gateway for host platform..."
cd "$GATEWAY_SRC"
go build -o "$OUT_DIR/ssh-gateway" .
echo "Done: $OUT_DIR/ssh-gateway ($(wc -c < "$OUT_DIR/ssh-gateway") bytes)"
