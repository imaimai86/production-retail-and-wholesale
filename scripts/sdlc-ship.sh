#!/usr/bin/env bash
# Ship stage of the SDLC: commit only the files the cycle changed, then tick the backlog.
# Usage: bash scripts/sdlc-ship.sh <slug> <docs-dir> <baseline-file> <backlog-file>
# Run from the repo root. The baseline comes from `node scripts/sdlc-changes.cjs snapshot`.
# Writes <log-dir>/ship-skipped.md (log dir = directory of the baseline file); last line is DONE.
set -euo pipefail

[ $# -eq 4 ] || { echo "Usage: bash scripts/sdlc-ship.sh <slug> <docs-dir> <baseline-file> <backlog-file>" >&2; exit 1; }
SLUG="$1"; DOCS="$2"; BASELINE="$3"; BACKLOG="$4"
LOG="$(dirname "$BASELINE")"

JSON=$(node scripts/sdlc-changes.cjs changed "$BASELINE") || exit 1

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
printf '%s' "$JSON" > "$TMP/changes.json"

# Prepares include.nul, body.txt, skipped.md and prints "<N_FEAT> <M> <backlog dirty at baseline 0|1>".
COUNTS=$(node -e '
const fs = require("fs");
const [json, baselineFile, backlog, tmp] = process.argv.slice(1);
const { include, skipped } = JSON.parse(fs.readFileSync(json, "utf8"));
const feat = include.filter((p) => p !== backlog);
const skip = skipped.filter((s) => s.path !== backlog);
fs.writeFileSync(tmp + "/include.nul", feat.map((p) => p + "\0").join(""));
let body = feat.slice(0, 50).join("\n");
if (feat.length > 50) body += "\n... and " + (feat.length - 50) + " more";
fs.writeFileSync(tmp + "/body.txt", body);
fs.writeFileSync(tmp + "/skipped.md", skip.length ? skip.map((s) => "- " + s.path + ": " + s.reason).join("\n") + "\n" : "No files skipped.\n");
const baseline = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
const dirty = Object.prototype.hasOwnProperty.call(baseline, backlog) ? 1 : 0;
console.log(feat.length + " " + skip.length + " " + dirty);
' "$TMP/changes.json" "$BASELINE" "$BACKLOG" "$TMP") || exit 1
read -r N_FEAT M BACKLOG_DIRTY <<< "$COUNTS"

if [ "$N_FEAT" -eq 0 ]; then
  echo "WARNING: nothing to commit"
else
  git add -A --pathspec-from-file="$TMP/include.nul" --pathspec-file-nul
  git commit -q -m "feat($SLUG): implement per $DOCS/specs-1.md" -m "$(cat "$TMP/body.txt")" \
    --pathspec-from-file="$TMP/include.nul" --pathspec-file-nul
fi

TICK_COMMITTED=0
if grep -q "^- \[ \] \`$SLUG\`" "$BACKLOG" 2>/dev/null; then
  sed -i.bak -E "s/^- \[ \] (\`$SLUG\`)/- [x] \1/" "$BACKLOG" && rm -f "$BACKLOG.bak"
  if [ "$BACKLOG_DIRTY" -eq 1 ]; then
    echo "WARNING: $BACKLOG was already modified before the run; $SLUG was ticked but not committed"
  else
    git add -- "$BACKLOG"
    if ! git diff --cached --quiet -- "$BACKLOG"; then
      git commit -q -m "chore(backlog): mark $SLUG done" -- "$BACKLOG"
      TICK_COMMITTED=1
    fi
  fi
else
  echo "WARNING: $SLUG not found in $BACKLOG; not ticked"
fi

cp "$TMP/skipped.md" "$LOG/ship-skipped.md"
cat "$LOG/ship-skipped.md"

BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
N=$((N_FEAT + TICK_COMMITTED))
echo "DONE: $SLUG on $BRANCH_NAME. Committed $N file(s), skipped $M (see $LOG/ship-skipped.md)."
