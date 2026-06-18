#!/usr/bin/env bash
# release.sh — tag and push a new Deckyfin release.
# Usage:
#   ./release.sh          → auto-bumps patch (v0.1.0 → v0.1.1)
#   ./release.sh minor    → bumps minor  (v0.1.0 → v0.2.0)
#   ./release.sh major    → bumps major  (v0.1.0 → v1.0.0)
#   ./release.sh v1.2.3   → exact version

set -euo pipefail

BUMP="${1:-patch}"

# ── guards ──────────────────────────────────────────────────────────────────
if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: uncommitted changes — commit or stash them first" >&2
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" != "main" ]]; then
  echo "error: must be on main (currently on '$BRANCH')" >&2
  exit 1
fi

# ── compute next version ─────────────────────────────────────────────────────
LATEST="$(git tag --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1)"
LATEST="${LATEST:-v0.0.0}"

# Strip leading 'v'
VERSION="${LATEST#v}"
MAJOR="${VERSION%%.*}"; REST="${VERSION#*.}"
MINOR="${REST%%.*}"; PATCH="${REST#*.}"

case "$BUMP" in
  patch)   NEXT="v${MAJOR}.${MINOR}.$((PATCH + 1))" ;;
  minor)   NEXT="v${MAJOR}.$((MINOR + 1)).0" ;;
  major)   NEXT="v$((MAJOR + 1)).0.0" ;;
  v*.*.*)  NEXT="$BUMP" ;;
  *)
    echo "error: unknown bump type '$BUMP' — use patch, minor, major, or vX.Y.Z" >&2
    exit 1
    ;;
esac

# ── confirm ──────────────────────────────────────────────────────────────────
echo "Latest tag : ${LATEST}"
echo "New tag    : ${NEXT}"
echo ""
read -rp "Proceed? [y/N] " CONFIRM
[[ "$CONFIRM" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }

# ── handle an existing tag with the same name ────────────────────────────────
if git rev-parse "$NEXT" &>/dev/null; then
  echo ""
  echo "Tag $NEXT already exists."
  read -rp "Delete and re-create it? [y/N] " RETAG
  if [[ "$RETAG" =~ ^[Yy]$ ]]; then
    git tag -d "$NEXT"
    git push origin ":refs/tags/$NEXT" || true   # ignore if not on remote yet
  else
    echo "Aborted."
    exit 0
  fi
fi

# ── push main, then tag ───────────────────────────────────────────────────────
echo ""
echo "Pushing main…"
git push origin main

echo "Tagging $NEXT and pushing…"
git tag "$NEXT"
git push origin "$NEXT"

echo ""
echo "Done — release workflow triggered for $NEXT."
echo "Watch it at: https://github.com/$(git remote get-url origin | sed 's|.*github.com[:/]\(.*\)\.git|\1|')/actions"
