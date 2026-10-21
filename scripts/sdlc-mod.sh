#!/usr/bin/env bash
# Compatibility wrapper: the SDLC pipeline now comes from the ai-sdlc-helper package. This script keeps the old
# `scripts/sdlc-mod.sh <subcommand>` interface, which the sdlc-monitor pane (.claude/plugins/sdlc-monitor) still calls,
# and maps each subcommand to `ai-sdlc-helper`:
#   run <slug>                         -> start <slug> [--from $FROM]
#   stop <slug>                        -> stop <slug>
#   restart <slug> [--yes]             -> restart <slug> [--from $FROM] [--yes]
#   discard <slug> [--yes] [--stop]    -> discard <slug> [--yes] [--stop]
#   status [--json]                    -> status [--json]
#   changes <slug> [--json] | changes --all [<slug>...]   -> changes ... (same arguments)
#   watch <slug> [--once]              -> watch <slug> --follow $WATCH_INTERVAL (default 3); --once: watch <slug> (one frame)
#   permit <slug> allow|always|deny [n|all]  -> permit <slug> <choice> <n|all> (default all)
#   model ...                          -> model ... (same arguments)
#   backlog [status] [--json]          -> backlog ... (same arguments)
# The commands run in the checkout holding this script (the main working tree when the pane calls it), as before;
# watch runs in the current folder, so it also finds a pipeline started by hand there. The environment passes through:
# SDLC_MAX_PARALLEL, SDLC_BASE, SDLC_WT_BASE, SDLC_PLUGIN_DIRS and SDLC_ALLOW_MERGED are read by ai-sdlc-helper itself.
# AI_SDLC_HELPER names another command to run instead of ai-sdlc-helper (tests use it).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOL="${AI_SDLC_HELPER:-ai-sdlc-helper}"

usage() {
  echo "Usage: $0 run <slug> | stop <slug> | restart <slug> [--yes] | discard <slug> [--yes] [--stop] | status [--json] | changes <slug> [--json] | changes --all [<slug>...] | watch <slug> [--once] | permit <slug> allow|always|deny [n|all] | model ... | backlog [status] [--json]" >&2
  exit 2
}

if ! command -v "$TOOL" >/dev/null 2>&1; then
  cat >&2 <<'EOF'
ERROR: ai-sdlc-helper is not on PATH. The SDLC pipeline comes from the ai-sdlc-helper package; install it with
  npm pack github:imaimai86/ai-sdlc-helper && npm i -g ./ai-sdlc-helper-*.tgz
or from the tarball attached to a GitHub release (npm i -g <tarball URL>); once it is on npm: npm i -g ai-sdlc-helper.
Then check the project with: ai-sdlc-helper doctor
EOF
  exit 127
fi

from=()
if [ -n "${FROM:-}" ]; then from=(--from "$FROM"); fi

sub="${1:-}"
[ -n "$sub" ] || usage
shift

case "$sub" in
  run)     [ $# -eq 1 ] || usage; cd "$ROOT"; exec "$TOOL" start "$1" ${from[@]+"${from[@]}"} ;;
  stop)    [ $# -eq 1 ] || usage; cd "$ROOT"; exec "$TOOL" stop "$1" ;;
  restart) { [ $# -eq 1 ] || { [ $# -eq 2 ] && [ "$2" = --yes ]; }; } || usage
           cd "$ROOT"; exec "$TOOL" restart "$@" ${from[@]+"${from[@]}"} ;;
  discard) [ $# -ge 1 ] || usage; cd "$ROOT"; exec "$TOOL" discard "$@" ;;
  status)  cd "$ROOT"; exec "$TOOL" status "$@" ;;
  changes) [ $# -ge 1 ] || usage; cd "$ROOT"; exec "$TOOL" changes "$@" ;;
  permit)  { [ $# -eq 2 ] || [ $# -eq 3 ]; } || usage; cd "$ROOT"; exec "$TOOL" permit "$1" "$2" "${3:-all}" ;;
  model)   cd "$ROOT"; exec "$TOOL" model "$@" ;;
  backlog) cd "$ROOT"; exec "$TOOL" backlog "$@" ;;
  watch)
    { [ $# -eq 1 ] || { [ $# -eq 2 ] && [ "$2" = --once ]; }; } || usage
    if [ "${2:-}" = --once ]; then exec "$TOOL" watch "$1"; fi
    exec "$TOOL" watch "$1" --follow "${WATCH_INTERVAL:-3}" ;;
  *) usage ;;
esac
