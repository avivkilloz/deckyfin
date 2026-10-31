#!/usr/bin/env bash
# Package the built plugin into deckyfin.zip (+ version.json).
# Usage: scripts/package-plugin.sh <version> <channel: stable|main>
# Requires: npm run build already done; jq; python3.
set -euo pipefail
trap 'rm -rf package' EXIT

cd "$(dirname "$0")/.."

VERSION="${1:?version required}"
CHANNEL="${2:?channel required}"
case "$CHANNEL" in stable|main) ;; *) echo "channel must be stable|main" >&2; exit 1 ;; esac
[[ -d dist ]] || { echo "dist/ missing — run npm run build first" >&2; exit 1; }

COMMIT="$(git rev-parse HEAD)"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

rm -rf package deckyfin.zip version.json
mkdir -p package/deckyfin/src
cp main.py package.json LICENSE package/deckyfin/
jq --arg v "$VERSION" --arg c "$CHANNEL" --arg s "$COMMIT" --arg t "$BUILT_AT" \
  '.version = $v | .deckyfin_build = {channel: $c, commit: $s, built_at: $t}' \
  plugin.json > package/deckyfin/plugin.json
cp -r dist py_modules package/deckyfin/
cp -r src/assets package/deckyfin/src/
find package/deckyfin -name "__pycache__" -type d -prune -exec rm -rf {} +

(cd package && python3 -m zipfile -c ../deckyfin.zip deckyfin/)
jq -n --arg v "$VERSION" --arg c "$CHANNEL" --arg s "$COMMIT" --arg t "$BUILT_AT" \
  '{version: $v, channel: $c, commit: $s, built_at: $t}' > version.json
rm -rf package
echo "Packaged deckyfin.zip ($VERSION, $CHANNEL, ${COMMIT:0:7})"
