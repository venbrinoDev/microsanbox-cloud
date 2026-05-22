#!/bin/bash
set -euo pipefail

SSHD_SRC="$(cd "$(dirname "$0")/../apps/inject-sshd" && pwd)"
OUT_DIR="$(cd "$(dirname "$0")/../data/ssh" && pwd)"

mkdir -p "$OUT_DIR"

echo "Building inject-sshd for linux/amd64..."
cd "$SSHD_SRC"
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o "$OUT_DIR/inject-sshd.linux-amd64" .
echo "Done: $OUT_DIR/inject-sshd.linux-amd64 ($(wc -c < "$OUT_DIR/inject-sshd.linux-amd64") bytes)"

echo "Building inject-sshd for linux/arm64..."
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o "$OUT_DIR/inject-sshd.linux-arm64" .
echo "Done: $OUT_DIR/inject-sshd.linux-arm64 ($(wc -c < "$OUT_DIR/inject-sshd.linux-arm64") bytes)"

echo "inject-sshd builds complete."
