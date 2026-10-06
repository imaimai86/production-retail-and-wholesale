#!/usr/bin/env bash
# Ship stage: commit exactly the files the SDLC cycle changed (see scripts/sdlc-changes.cjs), then tick the backlog.
# Usage: bash scripts/sdlc-ship.sh <slug> <docs-dir> <baseline-file> <backlog-file>
# Skipped files (pre-existing local changes, secrets, editor/agent config, generated, too large) are listed in
# <docs-dir>/logs/ship-skipped.md.
set -euo pipefail
[ $# -eq 4 ] || { echo "Usage: $0 <slug> <docs-dir> <baseline-file> <backlog-file>"; exit 1; }
SLUG="$1"; DOCS="$2"; BASELINE="$3"; BACKLOG="$4"
HERE="$(cd "$(dirname "$0")" && pwd)"
LOG="$DOCS/logs"; mkdir -p "$LOG"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

CHANGES="$LOG/ship-changes.json"
node "$HERE/sdlc-changes.cjs" changed "$BASELINE" > "$CHANGES"
INCLUDE=(); while IFS= read -r p; do [ -n "$p" ] && INCLUDE+=("$p"); done < <(node -e '
  for (const p of JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).include) console.log(p)' "$CHANGES")
node -e '
  const { skipped } = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  console.log(skipped.length ? skipped.map(s => `- ${s.path}: ${s.reason}`).join("\n") : "No files skipped.")' "$CHANGES" > "$LOG/ship-skipped.md"
SKIPPED=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).skipped.length)' "$CHANGES")
N=${#INCLUDE[@]}

if [ "$N" -eq 0 ]; then
  echo "WARNING: nothing to commit"
else
  BODY=$(printf '%s\n' "${INCLUDE[@]:0:50}")
  [ "$N" -le 50 ] || BODY="$BODY"$'\n'"... and $((N - 50)) more"
  git add -A -- "${INCLUDE[@]}"
  if ! OUT=$(git commit -q -m "feat($SLUG): implement per $DOCS/specs-1.md" -m "$BODY" -- "${INCLUDE[@]}" 2>&1); then
    case "$OUT" in
      *"nothing to commit"*|*"no changes added"*) echo "WARNING: nothing to commit"; N=0;;
      *) echo "$OUT"; exit 1;;
    esac
  fi
fi

# Tick the backlog. A backlog file the developer had already modified is ticked but left uncommitted.
if grep -q "^- \[ \] \`$SLUG\`" "$BACKLOG" 2>/dev/null; then
  sed -i.bak -E "s/^- \[ \] (\`$SLUG\`)/- [x] \1/" "$BACKLOG" && rm -f "$BACKLOG.bak"
  if node -e 'process.exit(Object.prototype.hasOwnProperty.call(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")), process.argv[2]) ? 0 : 1)' "$BASELINE" "$BACKLOG"; then
    echo "WARNING: $BACKLOG had local changes before the run; ticked $SLUG but did not commit it"
  else
    git add -- "$BACKLOG"
    git commit -q -m "chore(backlog): mark $SLUG done" -- "$BACKLOG"
  fi
elif ! grep -q "^- \[x\] \`$SLUG\`" "$BACKLOG" 2>/dev/null; then
  echo "WARNING: $SLUG not found in $BACKLOG; not ticked"
fi

echo "Skipped files:"; cat "$LOG/ship-skipped.md"
echo "DONE: $SLUG on $BRANCH. Committed $N file(s), skipped $SKIPPED (see $LOG/ship-skipped.md)."
