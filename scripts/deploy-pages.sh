#!/usr/bin/env bash
#
# Publish the current working tree to GitHub Pages without going through CI.
#
#   scripts/deploy-pages.sh            # build, then publish
#   scripts/deploy-pages.sh --dry-run  # build and show what would ship
#
# Why this exists: the GitHub Actions workflow is manual (workflow_dispatch),
# so it only runs when someone asks. This script covers the other case —
# publish a local experiment immediately, including uncommitted changes.
#
# It publishes to an orphan gh-pages branch via a throwaway worktree, so the
# source branch is never touched and the working copy is never disturbed.

set -euo pipefail

DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then DRY_RUN=1; fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Building"
npm run build

if [ ! -f dist/index.html ]; then
  echo "error: dist/index.html missing after build" >&2
  exit 1
fi

echo "==> Built site:"
find dist -type f | sed 's/^/    /'

if [ "$DRY_RUN" = "1" ]; then
  echo
  echo "Dry run - nothing published."
  exit 0
fi

echo
echo "==> Publishing to gh-pages branch"
TMPDIR="$(mktemp -d)"
cleanup() {
  git worktree remove --force "$TMPDIR" >/dev/null 2>&1 || true
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

git fetch origin gh-pages --depth=1 2>/dev/null || true
git worktree add --detach "$TMPDIR" HEAD >/dev/null

cd "$TMPDIR"
git rm -rf . >/dev/null 2>&1 || true
cp -R "$REPO_ROOT/dist/." .
git add -A
git -c user.name="github-actions[bot]" \
    -c user.email="github-actions[bot]@users.noreply.github.com" \
    commit -q -m "deploy: $(date -u +%Y-%m-%dT%H:%M:%SZ)" --allow-empty

git push --force origin HEAD:gh-pages
echo
echo "Published."
