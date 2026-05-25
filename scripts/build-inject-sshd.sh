#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SSHD_SRC="${ROOT_DIR}/apps/inject-sshd"
OUT_DIR="${ROOT_DIR}/data/ssh"

mkdir -p "$OUT_DIR"

echo "Building inject-sshd for linux/amd64..."
cd "$SSHD_SRC"
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o "$OUT_DIR/inject-sshd.linux-amd64" .
echo "Done: $OUT_DIR/inject-sshd.linux-amd64 ($(wc -c < "$OUT_DIR/inject-sshd.linux-amd64") bytes)"

echo "Building inject-sshd for linux/arm64..."
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o "$OUT_DIR/inject-sshd.linux-arm64" .
echo "Done: $OUT_DIR/inject-sshd.linux-arm64 ($(wc -c < "$OUT_DIR/inject-sshd.linux-arm64") bytes)"

echo "inject-sshd builds complete."
