#!/usr/bin/env bash
# Automated SDLC: backlog brief -> spec -> plan -> red tests -> green code -> review -> commit.
# Usage: ./scripts/sdlc.sh [slug]   (no slug = first pending item in Docs/backlog/index.md)
# Env:   MAX_ATTEMPTS (default 4)  MAX_TURNS (default 40)
set -euo pipefail
cd "$(dirname "$0")/.."

MAX_ATTEMPTS="${MAX_ATTEMPTS:-4}"
MAX_TURNS="${MAX_TURNS:-40}"
TEST_CMD="npm test"
TEST_DIR="server/__tests__"
BACKLOG="Docs/backlog/index.md"

SLUG="${1:-}"
if [ -z "$SLUG" ] && [ -f "$BACKLOG" ]; then
  SLUG=$(grep -m1 '^- \[ \]' "$BACKLOG" | sed -E 's/^- \[ \] `([^`]+)`.*/\1/' || true)
fi
[ -n "$SLUG" ] || { echo "Usage: $0 <slug> (or add a pending item to $BACKLOG)"; exit 1; }

DOCS="Docs/backlog/$SLUG"
[ -f "$DOCS/brief.md" ] || { echo "Missing $DOCS/brief.md"; exit 1; }
BRANCH="sdlc/$SLUG"
LOG="$DOCS/logs"; mkdir -p "$LOG"

ALLOWED='Read Write Edit Glob Grep mcp__graft Bash(npm test:*) Bash(npm run lint:*) Bash(graft:*) Bash(ls:*) Bash(git status:*) Bash(git diff:*) Bash(git log:*)'

# agent <stage> <prompt>: headless, scoped tools, bounded turns, transcript saved.
agent() {
  local stage="$1" prompt="$2"
  echo "   -> agent: $stage"
  claude -p "$prompt" --permission-mode acceptEdits --allowedTools $ALLOWED \
    --max-turns "$MAX_TURNS" > "$LOG/$stage.log" 2>&1 \
    || { echo "   !! agent '$stage' failed, see $LOG/$stage.log"; exit 1; }
}
tests_pass() { $TEST_CMD > "$LOG/tests.log" 2>&1; }
stage() { echo; echo "== $1"; }

git rev-parse --verify "$BRANCH" >/dev/null 2>&1 && git checkout -q "$BRANCH" || git checkout -q -b "$BRANCH"
echo "SDLC: $SLUG on branch $BRANCH"

# 1. SPEC ---------------------------------------------------------------
# Developer answers are recorded in $DOCS/decisions.md so they are never asked twice.
# Flow: agent writes questions.md -> developer fills each "**Answer:**" line ->
# rerun archives the answered round into decisions.md and the agent reads it.
stage "1/6 Spec"
DECISIONS="$DOCS/decisions.md"
if [ -f "$DOCS/questions.md" ]; then
  TOTAL=$(grep -c '^### Q' "$DOCS/questions.md" || true)
  ANSWERED=$(grep -cE '^\*\*Answer:\*\*[[:space:]]*[^[:space:]]' "$DOCS/questions.md" || true)
  if [ "$TOTAL" -eq 0 ] || [ "$ANSWERED" -lt "$TOTAL" ]; then
    echo "PAUSED: $ANSWERED/$TOTAL questions answered in $DOCS/questions.md. Fill every '**Answer:**' line and rerun."
    exit 2
  fi
  ROUND=$(( $(grep -c '^## Round ' "$DECISIONS" 2>/dev/null || true) + 1 ))
  { [ -f "$DECISIONS" ] || printf '# Decisions for %s\n' "$SLUG" > "$DECISIONS"
    printf '\n## Round %s (%s)\n\n' "$ROUND" "$(date +%Y-%m-%d)"
    grep -v '^# ' "$DOCS/questions.md"; } >> "$DECISIONS"
  rm "$DOCS/questions.md"
  echo "   recorded round $ROUND answers in $DECISIONS"
fi
ROUND_NO=$(( $(grep -c '^## Round ' "$DECISIONS" 2>/dev/null || true) + 1 ))
agent "spec-$ROUND_NO" "You are a Requirements Agent. Read CLAUDE.md, AGENTS.md, $DOCS/brief.md and, if it exists, $DOCS/decisions.md (answers the developer already gave: treat them as binding and NEVER ask them again; an Answer of "accept" means the Suggested value was approved).
Write a complete specification to $DOCS/specs-1.md: behaviour, inputs/outputs, error cases, acceptance criteria. No source code.
ZERO-GUESSING: if the brief and decisions leave a requirement ambiguous or missing, do NOT invent it. Do not write specs-1.md; write only the NEW questions to $DOCS/questions.md in exactly this format, one block per question:
### Q<n>: <short title>
<the question and why it matters>
**Suggested:** <your recommended answer>
**Answer:**
Leave the Answer line empty for the developer. Number questions from 1 each round."
if [ -f "$DOCS/questions.md" ]; then
  echo "PAUSED: new questions in $DOCS/questions.md. Fill each '**Answer:**' (write 'accept' to take the suggestion) and rerun."
  exit 2
fi
[ -f "$DOCS/specs-1.md" ] || { echo "Spec not produced"; exit 1; }

# 2. PLAN ---------------------------------------------------------------
stage "2/6 Plan"
agent plan "You are an Architecture Planner. Read $DOCS/specs-1.md. Use the Graft MCP tools to find the affected files and callers; read only those files.
Write a step-by-step technical plan to $DOCS/plan-1.md (files, functions, order). No source edits."
[ -f "$DOCS/plan-1.md" ] || { echo "Plan not produced"; exit 1; }

# 3. RED TESTS ------------------------------------------------------------
stage "3/6 Failing tests (red gate)"
agent tests "You are a QA Engineer. Read $DOCS/specs-1.md and $DOCS/plan-1.md.
Write a test matrix to $DOCS/test-cases-1.md and the matching Jest tests under $TEST_DIR/ (mirror the source layout). Do NOT change source code outside $TEST_DIR/."
if tests_pass; then echo "RED GATE FAILED: new tests pass before implementation. See $LOG/tests.log"; exit 1; fi
git add "$DOCS" "$TEST_DIR"
git commit -q -m "test($SLUG): add failing tests and spec/plan docs"
RED_SHA=$(git rev-parse HEAD)

# 4. GREEN LOOP -----------------------------------------------------------
stage "4/6 Implement (green gate, max $MAX_ATTEMPTS attempts)"
for i in $(seq 1 "$MAX_ATTEMPTS"); do
  echo " attempt $i"
  agent "impl-$i" "You are a Senior TDD Developer. Read $DOCS/plan-1.md and $DOCS/test-cases-1.md.
Latest test output is in $LOG/tests.log (run '$TEST_CMD' yourself to refresh). Edit source files so the failing tests pass.
NEVER edit anything under $TEST_DIR/."
  if [ -n "$(git diff --name-only "$RED_SHA" -- "$TEST_DIR")" ]; then
    echo "GUARD FAILED: tests were modified during implementation"; git diff --name-only "$RED_SHA" -- "$TEST_DIR"; exit 1
  fi
  if tests_pass; then echo " tests green"; break; fi
  [ "$i" -lt "$MAX_ATTEMPTS" ] || { echo "GREEN GATE FAILED after $MAX_ATTEMPTS attempts. See $LOG/tests.log"; exit 1; }
done

# 5. REVIEW ---------------------------------------------------------------
stage "5/6 Review"
agent review "You are a code reviewer. Review 'git diff $RED_SHA' against $DOCS/specs-1.md for correctness bugs, missed edge cases and security issues.
Fix real problems in source files (never under $TEST_DIR/). Write a short summary to $DOCS/review-1.md."
if [ -n "$(git diff --name-only "$RED_SHA" -- "$TEST_DIR")" ]; then echo "GUARD FAILED: review modified tests"; exit 1; fi
tests_pass || { echo "Tests broke after review. See $LOG/tests.log"; exit 1; }

# 6. SHIP -----------------------------------------------------------------
stage "6/6 Commit"
git add server "$DOCS"
git commit -q -m "feat($SLUG): implement per $DOCS/specs-1.md"
sed -i.bak -E "s/^- \[ \] (\`$SLUG\`)/- [x] \1/" "$BACKLOG" && rm -f "$BACKLOG.bak"
git add "$BACKLOG" && git commit -q -m "chore(backlog): mark $SLUG done"
echo; echo "DONE: $SLUG on $BRANCH. Review with: git log --oneline $RED_SHA~1..HEAD ; then open a PR."
