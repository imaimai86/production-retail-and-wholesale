#!/usr/bin/env bash
# Ship stage: commit exactly the files this cycle changed, tick the backlog item, report what was skipped.
# Usage: bash scripts/sdlc-ship.sh <slug> <docs-dir> <baseline-file> <backlog-file>
# Skipped files (developer's own changes, secrets, editor/agent config, generated, > 1 MiB) are listed in <docs-dir>/logs/ship-skipped.md.
set -euo pipefail
SLUG="$1"; DOCS="$2"; BASELINE="$3"; BACKLOG="$4"
LOG="$DOCS/logs"; mkdir -p "$LOG"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

# Keys added to a git-ignored .env go into .env.example (placeholder values only) before the changes are listed.
node scripts/sdlc-changes.cjs mirror "$BASELINE"
CHANGES="$(node scripts/sdlc-changes.cjs changed "$BASELINE")"
INCLUDE=(); while IFS= read -r p; do [ -n "$p" ] && INCLUDE+=("$p"); done < <(printf '%s' "$CHANGES" | node -e 'JSON.parse(require("fs").readFileSync(0,"utf8")).include.forEach(p=>console.log(p))')
SKIPPED="$(printf '%s' "$CHANGES" | node -e 'JSON.parse(require("fs").readFileSync(0,"utf8")).skipped.forEach(s=>console.log("- "+s.path+": "+s.reason))')"
N_SKIPPED=0; [ -z "$SKIPPED" ] || N_SKIPPED=$(printf '%s\n' "$SKIPPED" | wc -l | tr -d ' ')
BACKLOG_DIRTY=$(node -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(Object.prototype.hasOwnProperty.call(b.files,process.argv[2])?"yes":"no")' "$BASELINE" "$BACKLOG")

if [ "${#INCLUDE[@]}" -eq 0 ]; then
  echo "WARNING: nothing to commit"
else
  BODY="$(printf '%s\n' "${INCLUDE[@]:0:50}")"
  git add -A -- "${INCLUDE[@]}"
  git commit -q -m "feat($SLUG): implement per $DOCS/specs-1.md" -m "$BODY" -- "${INCLUDE[@]}"
fi

if grep -qE "^- \[ \] \`$SLUG\`" "$BACKLOG" 2>/dev/null; then
  sed -i.bak -E "s/^- \[ \] (\`$SLUG\`)/- [x] \1/" "$BACKLOG" && rm -f "$BACKLOG.bak"
  if [ "$BACKLOG_DIRTY" = yes ]; then
    echo "WARNING: $BACKLOG had local changes before the run; ticked $SLUG but not committed"
  else
    git add -- "$BACKLOG"
    git commit -q -m "chore(backlog): mark $SLUG done" -- "$BACKLOG"
  fi
else
  echo "WARNING: $SLUG not found in $BACKLOG; not ticked"
fi

{ [ -z "$SKIPPED" ] || printf '%s\n' "$SKIPPED"; } > "$LOG/ship-skipped.md"
[ -z "$SKIPPED" ] || { echo "Skipped:"; printf '%s\n' "$SKIPPED"; }
echo
echo "DONE: $SLUG on $BRANCH. Committed ${#INCLUDE[@]} file(s), skipped $N_SKIPPED (see $LOG/ship-skipped.md)."
