#!/bin/bash
# SessionStart hook for Claude Code on the web: installs Graft, builds its graph
# and installs project dependencies. Graft needs no daemon: Claude launches
# `graft mcp` itself (see .mcp.json), so installing and building is enough.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# Graft (global CLI). Skipped when already present, so re-runs are cheap.
if ! command -v graft >/dev/null 2>&1; then
  npm install -g @nanonets/graft
fi
graft --version

# Graph is git-ignored; build if missing or stale.
if [ ! -d graft ] || ! graft check >/dev/null 2>&1; then
  graft build
fi

# Project dependencies (npm install, not ci, so the cached container is reused).
npm install
[ -f server/package.json ] && npm install --prefix server
