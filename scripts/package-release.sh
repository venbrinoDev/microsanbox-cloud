#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-}"
OUTDIR="${2:-artifacts}"

if [[ -z "$VERSION" ]]; then
  echo "usage: $0 <version> [outdir]" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG_DIR_NAME="microsandbox-cloud-${VERSION}"
STAGE_DIR="$(mktemp -d)"
TARGET_DIR="${STAGE_DIR}/${PKG_DIR_NAME}"

mkdir -p "${TARGET_DIR}" "${ROOT_DIR}/${OUTDIR}"

cp -R \
  "${ROOT_DIR}/apps/cloud-api/dist" \
  "${TARGET_DIR}/dist"
cp \
  "${ROOT_DIR}/apps/cloud-api/package.json" \
  "${ROOT_DIR}/apps/cloud-api/package-lock.json" \
  "${ROOT_DIR}/README.md" \
  "${ROOT_DIR}/LICENSE" \
  "${TARGET_DIR}/"

ARCHIVE_PATH="${ROOT_DIR}/${OUTDIR}/${PKG_DIR_NAME}.tar.gz"
CHECKSUM_PATH="${ARCHIVE_PATH}.sha256"

tar -C "${STAGE_DIR}" -czf "${ARCHIVE_PATH}" "${PKG_DIR_NAME}"
(
  cd "${ROOT_DIR}/${OUTDIR}"
  shasum -a 256 "$(basename "${ARCHIVE_PATH}")" > "$(basename "${CHECKSUM_PATH}")"
)

echo "Created ${ARCHIVE_PATH}"
echo "Created ${CHECKSUM_PATH}"
