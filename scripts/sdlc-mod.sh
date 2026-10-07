#!/usr/bin/env bash
# Interactive-SDLC wrapper: runs scripts/sdlc.sh for one backlog item in its own git worktree,
# so several pipelines can run at the same time. sdlc.sh itself is not modified.
#   scripts/sdlc-mod.sh run <slug>     start (or resume) the pipeline for <slug>
#   scripts/sdlc-mod.sh stop <slug>    interrupt the running pipeline for <slug>
#   scripts/sdlc-mod.sh discard <slug> [--yes] [--stop]   delete its worktree, branch and run record (without --yes: show what would go,
#                                                         exit 6; a running pipeline is refused unless --stop stops it first)
#   scripts/sdlc-mod.sh restart <slug> [--yes]   stop it if running, discard it, and start again from Spec
#   scripts/sdlc-mod.sh status         one line per known run
#   scripts/sdlc-mod.sh watch <slug> [--once]   live view of one pipeline: its status.json line, run state, uncommitted files and the
#                                               tail of run.out, read from its worktree (or the current directory for a run started
#                                               in place). Refreshes every WATCH_INTERVAL seconds (default 3); --once prints one frame.
# Env: SDLC_MAX_PARALLEL   most pipelines running at once (default 2; exit 3 when full)
#      SDLC_BASE           ref a new branch starts from (default origin/main, else main, else HEAD)
#      SDLC_WT_BASE        folder holding the worktrees (default ../<repo>-sdlc)
#      SDLC_PLUGIN_DIRS    plugin folders loaded in every agent (default .claude/plugins/sdlc-guard, if present)
#      SDLC_ALLOW_MERGED   set to run an item again whose red-tests commit is already in the base branch (exit 5 otherwise)
#      WATCH_INTERVAL      seconds between frames of `watch` (default 3; a non-positive or non-numeric value exits 2)
#      FROM=spec|plan|red-tests|implement|review   passed through to sdlc.sh (resume at that stage)
# Run state is kept in <git common dir>/sdlc-runs/<slug>.json, outside every worktree, so one place lists all runs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMMON="$(git -C "$ROOT" rev-parse --git-common-dir)"
case "$COMMON" in /*) ;; *) COMMON="$ROOT/$COMMON" ;; esac
REG="$COMMON/sdlc-runs"
MAX_PARALLEL="${SDLC_MAX_PARALLEL:-2}"
WT_BASE="${SDLC_WT_BASE:-$(dirname "$ROOT")/$(basename "$ROOT")-sdlc}"

now() { date +%Y-%m-%dT%H:%M:%S; }
usage() { echo "Usage: $0 run <slug> | stop <slug> | discard <slug> [--yes] [--stop] | restart <slug> [--yes] | status | watch <slug> [--once]" >&2; exit 2; }
check_slug() { [[ "${1:-}" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "Invalid slug '${1:-}': lowercase letters, digits and dashes only" >&2; exit 2; }; }
json_get() { node -e 'try{const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))[process.argv[2]];process.stdout.write(v===undefined||v===null?"":String(v))}catch(e){}' "$1" "$2"; }
# kill -0 also succeeds on a zombie (a process that has exited but whose parent has not collected it): that is not alive.
alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null && [ "$(ps -o stat= -p "$1" 2>/dev/null | cut -c1)" != Z ]; }
killtree() { local p="$1" c; for c in $(pgrep -P "$p" 2>/dev/null); do killtree "$c"; done; kill -TERM "$p" 2>/dev/null || true; }

# write_reg <slug> <worktree> <pid> <started> <state> <exit_code> <interrupted> <finished> [message]
write_reg() {
  local msg="${9:-}"
  msg="${msg//\"/\'}"
  printf '{"slug":"%s","worktree":"%s","pid":%s,"started":"%s","state":"%s","exit_code":"%s","interrupted":%s,"finished":"%s","message":"%s"}\n' \
    "$1" "$2" "$3" "$4" "$5" "$6" "$7" "$8" "$msg" > "$REG/$1.json.tmp" && mv "$REG/$1.json.tmp" "$REG/$1.json"
}

# fail_start <slug> <exit code> <message>: a start that is refused is recorded, so the control pane can say why.
fail_start() {
  local f="$REG/$1.json"
  echo "$3"
  if [ ! -f "$f" ] || [ "$(json_get "$f" state)" != running ] || ! alive "$(json_get "$f" pid)"; then
    write_reg "$1" "" 0 "$(now)" exited "$2" false "$(now)" "$3"
  fi
  exit "$2"
}

running_count() {
  local n=0 f pid
  for f in "$REG"/*.json; do
    [ -e "$f" ] || continue
    [ "$(json_get "$f" state)" = running ] || continue
    pid="$(json_get "$f" pid)"
    alive "$pid" && n=$((n + 1))
  done
  echo "$n"
}

# The ref a new branch starts from.
pick_base() {
  local p base="${SDLC_BASE:-}"
  if [ -z "$base" ]; then
    for p in origin/main main HEAD; do git -C "$ROOT" rev-parse --verify -q "$p" >/dev/null && { base="$p"; break; }; done
  fi
  echo "$base"
}

# True when the item's red-tests commit is already in the base branch: it was merged.
is_merged() { [ -n "$(git -C "$ROOT" log "$2" -1 --format=%h --grep="^test($1): add failing tests" 2>/dev/null)" ]; }

# Stops a running pipeline and waits until its process has gone, so it cannot write its record afterwards.
stop_if_running() {
  local slug="$1" f="$REG/$1.json" pid i
  [ -f "$f" ] || return 0
  pid="$(json_get "$f" pid)"
  alive "$pid" || return 0
  : > "$REG/$slug.interrupt"
  killtree "$pid"
  for i in $(seq 1 100); do alive "$pid" || return 0; sleep 0.2; done
  echo "could not stop $slug (pid $pid)" >&2; exit 1
}

cmd_run() {
  local slug="$1" docs wt branch base started rc f p
  check_slug "$slug"
  mkdir -p "$REG"
  exec >>"$REG/$slug.wrapper.log" 2>&1
  echo "== $(now) run $slug"

  f="$REG/$slug.json"
  if [ -f "$f" ] && [ "$(json_get "$f" state)" = running ] && alive "$(json_get "$f" pid)"; then
    echo "already running (pid $(json_get "$f" pid))"; exit 4
  fi
  if [ "$(running_count)" -ge "$MAX_PARALLEL" ]; then
    fail_start "$slug" 3 "at most $MAX_PARALLEL pipelines may run at once (SDLC_MAX_PARALLEL)"
  fi

  docs="Docs/backlog/$slug"
  wt="$WT_BASE/$slug"
  branch="sdlc/$slug"
  base="$(pick_base)"
  if [ ! -e "$wt/.git" ]; then
    # Fail before creating anything. An item whose red-tests commit is already in the base branch was merged: its
    # branch is stale, and running it again would redo finished work on old code.
    if [ -z "${SDLC_ALLOW_MERGED:-}" ] && is_merged "$slug" "$base"; then
      fail_start "$slug" 5 "$slug is already merged into $base. Delete branch $branch and its backlog entry, or set SDLC_ALLOW_MERGED=1 to run it again."
    fi
    # The brief must be in the main working tree or already committed on the branch.
    if [ ! -f "$ROOT/$docs/brief.md" ] && ! git -C "$ROOT" cat-file -e "$branch:$docs/brief.md" 2>/dev/null \
       && ! git -C "$ROOT" cat-file -e "$base:$docs/brief.md" 2>/dev/null; then
      fail_start "$slug" 1 "Missing $docs/brief.md"
    fi
    mkdir -p "$WT_BASE"
    if git -C "$ROOT" show-ref --verify --quiet "refs/heads/$branch"; then
      git -C "$ROOT" worktree add "$wt" "$branch"
    else
      git -C "$ROOT" worktree add "$wt" -b "$branch" "$base"
    fi
  fi
  # A brief that is not committed on the base branch yet is copied from the main working tree.
  if [ ! -f "$wt/$docs/brief.md" ]; then
    [ -f "$ROOT/$docs/brief.md" ] || fail_start "$slug" 1 "Missing $docs/brief.md"
    mkdir -p "$wt/$docs"; cp "$ROOT/$docs/brief.md" "$wt/$docs/brief.md"
  fi
  # Gitignored things a pipeline needs are shared with the main working tree.
  # A .gitignore pattern that ends in "/" (node_modules/, /graft/) does not match a symlink, so the links are
  # also listed in the repo's local exclude file (shared by every worktree): no stage may commit them.
  mkdir -p "$COMMON/info"
  for p in server/node_modules node_modules graft .env; do
    if [ -e "$ROOT/$p" ] && [ ! -e "$wt/$p" ] && [ ! -L "$wt/$p" ]; then mkdir -p "$(dirname "$wt/$p")"; ln -s "$ROOT/$p" "$wt/$p"; fi
    if [ -L "$wt/$p" ] && ! grep -qxF "/$p" "$COMMON/info/exclude" 2>/dev/null; then echo "/$p" >> "$COMMON/info/exclude"; fi
  done
  mkdir -p "$wt/$docs/logs"
  rm -f "$REG/$slug.interrupt"

  started="$(now)"
  write_reg "$slug" "$wt" "$$" "$started" running "" false ""

  plugins="${SDLC_PLUGIN_DIRS:-}"
  if [ -z "$plugins" ] && [ -d "$ROOT/.claude/plugins/sdlc-guard" ]; then plugins="$ROOT/.claude/plugins/sdlc-guard"; fi
  [ -z "$plugins" ] || export CLAUDE_CODE_PLUGIN_DIRS="$plugins"
  export SDLC_SLUG="$slug"

  rc=0
  (cd "$wt" && exec bash scripts/sdlc.sh "$slug") >>"$wt/$docs/logs/run.out" 2>&1 &
  CHILD=$!
  trap 'killtree "$CHILD"' TERM INT
  wait "$CHILD" || rc=$?
  # A trapped signal ends `wait` early: wait for the killed tree to finish before reading its status.
  while alive "$CHILD"; do sleep 0.2; done
  wait "$CHILD" 2>/dev/null || rc=$?

  if [ -f "$REG/$slug.interrupt" ]; then
    write_reg "$slug" "$wt" "$$" "$started" exited "$rc" true "$(now)"
  else
    write_reg "$slug" "$wt" "$$" "$started" exited "$rc" false "$(now)"
  fi
  echo "== $(now) finished $slug exit $rc"
  exit "$rc"
}

cmd_stop() {
  local slug="$1" f pid
  check_slug "$slug"
  f="$REG/$slug.json"
  [ -f "$f" ] || { echo "No run recorded for $slug" >&2; exit 1; }
  pid="$(json_get "$f" pid)"
  alive "$pid" || { echo "$slug is not running"; exit 0; }
  : > "$REG/$slug.interrupt"
  killtree "$pid"
  echo "stopped $slug"
}

# Deletes everything a pipeline left behind: worktree, local branch, run record. The branch tip is saved first.
cmd_discard() {
  local slug="$1" yes="" stop="" a f wt branch base tip="" ahead=0 dirty=0
  shift
  for a in "$@"; do
    case "$a" in --yes) yes=--yes ;; --stop) stop=1 ;; "") ;; *) usage ;; esac
  done
  check_slug "$slug"
  f="$REG/$slug.json"; wt="$WT_BASE/$slug"; branch="sdlc/$slug"
  if [ -z "$stop" ] && [ -f "$f" ] && [ "$(json_get "$f" state)" = running ] && alive "$(json_get "$f" pid)"; then
    echo "$slug is running: stop it first, or pass --stop" >&2; exit 4
  fi
  if git -C "$ROOT" show-ref --verify --quiet "refs/heads/$branch"; then tip="$(git -C "$ROOT" rev-parse "$branch")"; fi
  if [ ! -e "$wt/.git" ] && [ -z "$tip" ] && [ ! -f "$f" ]; then echo "Nothing to discard for $slug" >&2; exit 1; fi
  base="$(pick_base)"
  if [ -n "$tip" ]; then ahead="$(git -C "$ROOT" rev-list --count "$base..$branch")"; fi
  if [ -e "$wt/.git" ]; then dirty="$(git -C "$wt" status --porcelain --untracked-files=all | wc -l | tr -d ' ')"; fi
  echo "Discard $slug: worktree $wt, branch $branch ($ahead commit(s) not in $base, $dirty uncommitted file(s)), run record"
  if [ "$yes" != --yes ]; then echo "Nothing deleted. Run again with --yes to discard it."; exit 6; fi
  if [ -n "$stop" ]; then stop_if_running "$slug"; fi
  if [ -e "$wt" ]; then git -C "$ROOT" worktree remove --force "$wt" 2>/dev/null || rm -rf "$wt"; fi
  git -C "$ROOT" worktree prune
  if [ -n "$tip" ]; then git -C "$ROOT" branch -D "$branch" >/dev/null; fi
  rm -f "$REG/$slug.json" "$REG/$slug.interrupt" "$REG/$slug.wrapper.log"
  if [ -n "$tip" ]; then
    echo "git branch $branch $tip" > "$REG/$slug.discarded"
    echo "Discarded $slug. To get the branch back: git branch $branch $tip"
  else
    echo "Discarded $slug."
  fi
}

# Starts an item again from scratch: stop, discard, run.
cmd_restart() {
  local slug="$1" yes="${2:-}" base rc=0
  check_slug "$slug"
  base="$(pick_base)"
  if [ -z "${SDLC_ALLOW_MERGED:-}" ] && is_merged "$slug" "$base"; then
    echo "$slug is already merged into $base: a restart would be refused (SDLC_ALLOW_MERGED=1 overrides)" >&2; exit 5
  fi
  if [ "$yes" != --yes ]; then cmd_discard "$slug" ""; fi
  stop_if_running "$slug"
  (cmd_discard "$slug" --yes) || rc=$?
  [ "$rc" -eq 0 ] || [ "$rc" -eq 1 ] || exit "$rc"
  cmd_run "$slug"
}

cmd_status() {
  local f slug state pid
  for f in "$REG"/*.json; do
    [ -e "$f" ] || continue
    slug="$(json_get "$f" slug)"; state="$(json_get "$f" state)"; pid="$(json_get "$f" pid)"
    if [ "$state" = running ] && ! alive "$pid"; then state="stopped"; fi
    [ "$(json_get "$f" interrupted)" = true ] && state="interrupted"
    printf '%-12s %s\n' "$state" "$slug"
  done
}

# One frame of `watch`: the pipeline's own files, wherever its worktree is.
watch_frame() {
  local slug="$1" dir="$2" f="$REG/$1.json" logs state pid line
  logs="$dir/Docs/backlog/$slug/logs"
  if [ -f "$logs/status.json" ]; then cat "$logs/status.json"; else echo "(no status.json yet in $logs)"; fi
  if [ -f "$f" ]; then
    state="$(json_get "$f" state)"; pid="$(json_get "$f" pid)"
    if [ "$(json_get "$f" interrupted)" = true ]; then echo "run: interrupted (stopped by the user)"
    elif [ "$state" = exited ]; then echo "run: finished, exit code $(json_get "$f" exit_code)"
    elif [ "$state" = running ] && ! alive "$pid"; then echo "run: process has gone (stopped without finishing)"
    fi
  fi
  { git -C "$dir" status --short 2>&1 | head -15; } || true
  if [ -f "$logs/run.out" ]; then echo "--- run.out (last 5 lines)"; tail -n 5 "$logs/run.out"; fi
}

cmd_watch() {
  local slug="$1" once="${2:-}" interval="${WATCH_INTERVAL:-3}" f dir="" wt
  check_slug "$slug"
  case "$once" in ""|--once) ;; *) usage ;; esac
  if ! [[ "$interval" =~ ^[0-9]+(\.[0-9]+)?$ ]] || ! awk -v n="$interval" 'BEGIN { exit !(n > 0) }'; then
    echo "Invalid WATCH_INTERVAL '$interval': a positive number of seconds" >&2; exit 2
  fi
  f="$REG/$slug.json"
  wt="$(json_get "$f" worktree 2>/dev/null || true)"
  if [ -n "$wt" ] && [ -d "$wt" ]; then dir="$wt"
  elif [ -f "Docs/backlog/$slug/logs/status.json" ]; then dir="."
  else echo "No pipeline for $slug" >&2; exit 1
  fi
  if [ "$once" = --once ]; then watch_frame "$slug" "$dir"; return 0; fi
  while true; do
    printf '\033[H\033[2J'
    watch_frame "$slug" "$dir"
    sleep "$interval"
  done
}

case "${1:-}" in
  run)    [ $# -eq 2 ] || usage; cmd_run "$2" ;;
  stop)   [ $# -eq 2 ] || usage; cmd_stop "$2" ;;
  discard) [ $# -ge 2 ] || usage; slug="$2"; shift 2; cmd_discard "$slug" "$@" ;;
  restart) { [ $# -eq 2 ] || [ $# -eq 3 ]; } || usage; cmd_restart "$2" "${3:-}" ;;
  status) cmd_status ;;
  watch)  { [ $# -eq 2 ] || [ $# -eq 3 ]; } || usage; cmd_watch "$2" "${3:-}" ;;
  *)      usage ;;
esac
