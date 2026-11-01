#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0
# Installs a pinned Typst release. Usage: install-typst.sh <version> [sha256-of-archive]
set -euo pipefail

VERSION="${1:?typst version required}"
EXPECTED_SHA="${2:-}"

if command -v typst >/dev/null 2>&1 && typst --version | grep -q "typst ${VERSION}"; then
  echo "typst ${VERSION} already installed"
  exit 0
fi

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) TARGET="x86_64-unknown-linux-musl" ;;
  Linux-aarch64) TARGET="aarch64-unknown-linux-musl" ;;
  Darwin-arm64) TARGET="aarch64-apple-darwin" ;;
  Darwin-x86_64) TARGET="x86_64-apple-darwin" ;;
  *) echo "::error::Unsupported platform $(uname -s)-$(uname -m)"; exit 1 ;;
esac

WORK="${RUNNER_TEMP:-$(mktemp -d)}/typst-${VERSION}"
BIN="${WORK}/bin"
mkdir -p "${BIN}"
ARCHIVE="${WORK}/typst.tar.xz"

curl --fail --silent --show-error --location \
  "https://github.com/typst/typst/releases/download/v${VERSION}/typst-${TARGET}.tar.xz" \
  --output "${ARCHIVE}"

if [ -n "${EXPECTED_SHA}" ]; then
  ACTUAL="$(sha256sum "${ARCHIVE}" 2>/dev/null | cut -d' ' -f1 || shasum -a 256 "${ARCHIVE}" | cut -d' ' -f1)"
  if [ "${ACTUAL}" != "${EXPECTED_SHA}" ]; then
    echo "::error::Typst archive checksum mismatch (expected ${EXPECTED_SHA}, got ${ACTUAL})"
    exit 1
  fi
fi

tar -xJf "${ARCHIVE}" -C "${WORK}"
cp "${WORK}/typst-${TARGET}/typst" "${BIN}/typst"
chmod +x "${BIN}/typst"

if [ -n "${GITHUB_PATH:-}" ]; then echo "${BIN}" >> "${GITHUB_PATH}"; fi
export PATH="${BIN}:${PATH}"
typst --version
