#!/usr/bin/env bash
# SDLC Ship stage: commit exactly the files the cycle changed, tick the backlog, report what was skipped.
# Usage: bash scripts/sdlc-ship.sh <slug> <docs-dir> <baseline-file> <backlog-file>
# Run from the repo root. Skipped files (with reasons) are written to <docs-dir>/logs/ship-skipped.md
# next to the baseline file.
set -euo pipefail

[ $# -eq 4 ] || { echo "Usage: $0 <slug> <docs-dir> <baseline-file> <backlog-file>"; exit 1; }
SLUG="$1"; DOCS="$2"; BASELINE="$3"; BACKLOG="$4"
HERE="$(cd "$(dirname "$0")" && pwd)"
LOG="$(dirname "$BASELINE")"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
mkdir -p "$LOG"
fail() { echo "sdlc-ship: $1" >&2; exit 1; }

CHANGES="$LOG/ship-changes.json"
node "$HERE/sdlc-changes.cjs" changed "$BASELINE" > "$CHANGES"

INCLUDE=()
while IFS= read -r -d '' p; do INCLUDE+=("$p"); done < <(node -e '
  for (const p of JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).include) process.stdout.write(p + "\0");' "$CHANGES")
# Keys the cycle added to a .env are appended to its .env.example as KEY=<value>; nothing else in the example changes.
while IFS= read -r -d '' pair; do
  from="${pair%%$'\t'*}"; to="${pair#*$'\t'}"
  node "$HERE/sdlc-changes.cjs" merge "$from" "$to" || fail "could not update $to from $from"
  [ -z "$(git status --porcelain -- "$to")" ] || INCLUDE+=("$to")
done < <(node -e '
  for (const m of JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).mirror || []) process.stdout.write(m.from + "\t" + m.to + "\0");' "$CHANGES")
SKIPPED_MD="$(node -e '
  for (const s of JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).skipped) console.log("- " + s.path + ": " + s.reason);' "$CHANGES")"
SKIPPED_N=0; [ -z "$SKIPPED_MD" ] || SKIPPED_N=$(printf '%s\n' "$SKIPPED_MD" | wc -l | tr -d ' ')

if [ "${#INCLUDE[@]}" -eq 0 ]; then
  echo "WARNING: nothing to commit"
else
  BODY="$(printf '%s\n' "${INCLUDE[@]:0:50}")"
  [ "${#INCLUDE[@]}" -le 50 ] || BODY="$BODY"$'\n'"... and $(( ${#INCLUDE[@]} - 50 )) more"
  git add -A -- "${INCLUDE[@]}" || fail "git add failed"
  git commit -q -m "feat($SLUG): implement per $DOCS/specs-1.md" -m "$BODY" -- "${INCLUDE[@]}" || fail "git commit failed"
fi

if [ -f "$BACKLOG" ] && grep -qF -- "- [ ] \`$SLUG\`" "$BACKLOG"; then
  sed -i.bak -E "s/^- \[ \] (\`$SLUG\`)/- [x] \1/" "$BACKLOG" && rm -f "$BACKLOG.bak"
  if node -e 'process.exit(Object.prototype.hasOwnProperty.call(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")), process.argv[2]) ? 0 : 1)' "$BASELINE" "$BACKLOG"; then
    echo "WARNING: $BACKLOG had local changes before the run; ticked $SLUG but did not commit it"
  else
    git commit -q -m "chore(backlog): mark $SLUG done" -- "$BACKLOG" || fail "git commit failed"
  fi
else
  echo "WARNING: $SLUG not found in $BACKLOG; not ticked"
fi

printf '%s\n' "$SKIPPED_MD" | sed '/^$/d' > "$LOG/ship-skipped.md"
if [ "$SKIPPED_N" -gt 0 ]; then echo "Skipped:"; cat "$LOG/ship-skipped.md"; fi
echo "DONE: $SLUG on $BRANCH. Committed ${#INCLUDE[@]} file(s), skipped $SKIPPED_N (see $LOG/ship-skipped.md)."
