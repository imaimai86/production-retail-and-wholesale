#!/usr/bin/env bash
# Automated SDLC: backlog brief -> spec -> plan -> red tests -> green code -> review -> commit.
# Usage: ./scripts/sdlc.sh [slug]   (no slug = first pending item in Docs/backlog/index.md)
# Env:   MAX_ATTEMPTS (default 4)  MAX_TURNS (default 40)  MAX_REPAIR_TESTS (default 3)
#        FROM=implement  resume after Spec/Plan/Red tests (uses the existing red-tests commit)
#        SDLC_INTEGRATION_CI=run  when CI is set the integration suite is skipped with a warning
#        unless this is "run" (which also needs DATABASE_URL)
set -euo pipefail
cd "$(dirname "$0")/.."

MAX_ATTEMPTS="${MAX_ATTEMPTS:-4}"
MAX_TURNS="${MAX_TURNS:-40}"
MAX_REPAIR_TESTS="${MAX_REPAIR_TESTS:-3}"
FROM="${FROM:-spec}"
ROOT="$(pwd)"
CHECK="node scripts/sdlc-testcheck.cjs"
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
FAIL_LOG="$LOG/tests.log"

ALLOWED=(Read Write Edit Glob Grep mcp__graft
  "Bash(npm test:*)" "Bash(npm run lint:*)" "Bash(npm run generate-spec:*)" "Bash(graft:*)"
  "Bash(ls:*)" "Bash(git status:*)" "Bash(git diff:*)" "Bash(git log:*)")

# Status file: ONE small JSON line, overwritten in place (never appended), so it stays tiny.
# Watch it with:  watch -n5 cat Docs/backlog/<slug>/logs/status.json
STATUS="$LOG/status.json"; RUN_STARTED="$(date +%Y-%m-%dT%H:%M:%S)"
CUR_STAGE=""; CUR_AGENT=""; CUR_ATTEMPT=""; AGENT_STARTED=""; RUN_STATE="running"
set_status() {
  printf '{"slug":"%s","state":"%s","stage":"%s","agent":"%s","attempt":"%s","agent_started":"%s","run_started":"%s","updated":"%s","pid":%s}\n' \
    "$SLUG" "$RUN_STATE" "$CUR_STAGE" "$CUR_AGENT" "$CUR_ATTEMPT" "$AGENT_STARTED" "$RUN_STARTED" "$(date +%Y-%m-%dT%H:%M:%S)" "$$" \
    > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
}
# Final state on any exit: done (0), paused for answers (2), failed (anything else).
trap 'rc=$?; case $rc in 0) RUN_STATE=done;; 2) RUN_STATE=paused;; *) RUN_STATE=failed;; esac; CUR_AGENT=""; set_status' EXIT

# agent <stage> <prompt>: headless, scoped tools, bounded turns, transcript saved.
agent() {
  local stage="$1" prompt="$2"
  echo "   -> agent: $stage"
  CUR_AGENT="$stage"; AGENT_STARTED="$(date +%Y-%m-%dT%H:%M:%S)"; set_status
  claude -p "$prompt" --permission-mode acceptEdits --allowedTools "${ALLOWED[@]}" \
    --max-turns "$MAX_TURNS" > "$LOG/$stage.log" 2>&1 \
    || { echo "   !! agent '$stage' failed, see $LOG/$stage.log"; exit 1; }
}
tests_pass() { $TEST_CMD > "$LOG/tests.log" 2>&1; }
integration_check() { bash scripts/sdlc-integration.sh > "$LOG/integration.log" 2>&1; }
# Unit tests, then the integration suite; FAIL_LOG names the log of the check that failed.
success_check() {
  if ! tests_pass; then FAIL_LOG="$LOG/tests.log"; return 1; fi
  if ! integration_check; then FAIL_LOG="$LOG/integration.log"; return 1; fi
}
stage() { echo; echo "== $1"; CUR_STAGE="$(echo "$1" | sed -E 's/^[0-9a-z]+(\/[0-9]+)? //; s/ \(.*//')"; CUR_AGENT=""; CUR_ATTEMPT=""; set_status; }
# jest_json_at <sha> <out> [files...]: run the suite on <sha>'s source, optionally overlaying test files from the working tree.
jest_json_at() {
  local sha="$1" out="$2"; shift 2
  local wt; wt="$(mktemp -d)/wt"
  git worktree add -q --detach "$wt" "$sha"
  ln -s "$ROOT/server/node_modules" "$wt/server/node_modules"
  for f in "$@"; do mkdir -p "$wt/$(dirname "$f")"; cp "$f" "$wt/$f"; done
  (cd "$wt/server" && npx jest --json --outputFile="$out" >/dev/null 2>&1) || true
  git worktree remove --force "$wt"
}
jest_json_now() { (cd server && npx jest --json --outputFile="$ROOT/$1" >/dev/null 2>&1) || true; }
src_hash() { { git diff -- server ":!$TEST_DIR"; git status --porcelain -- server ":!$TEST_DIR"; } | shasum | cut -d' ' -f1; }

git rev-parse --verify "$BRANCH" >/dev/null 2>&1 && git checkout -q "$BRANCH" || git checkout -q -b "$BRANCH"
echo "SDLC: $SLUG on branch $BRANCH"

if [ "$FROM" = "spec" ]; then
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
stage "3/6 Red tests (red gate)"
agent tests "You are a QA Engineer. Read $DOCS/specs-1.md and $DOCS/plan-1.md.
Write a test matrix to $DOCS/test-cases-1.md and the matching Jest tests under $TEST_DIR/ (mirror the source layout). Do NOT change source code outside $TEST_DIR/."
if tests_pass; then echo "RED GATE FAILED: new tests pass before implementation. See $LOG/tests.log"; exit 1; fi
git add "$DOCS" "$TEST_DIR"
git commit -q -m "test($SLUG): add failing tests and spec/plan docs"
RED_SHA=$(git rev-parse HEAD)
else
  RED_SHA=$(git log --format=%H -1 --grep="^test($SLUG): add failing tests")
  [ -n "$RED_SHA" ] || { echo "FROM=$FROM but no red-tests commit found for $SLUG"; exit 1; }
  echo "Resuming at Implement from red-tests commit ${RED_SHA:0:7}"
fi
ORIG_RED_SHA="$RED_SHA"
jest_json_at "$RED_SHA" "$ROOT/$LOG/red.json"

# 4. GREEN LOOP -----------------------------------------------------------
stage "4/6 Implement (green gate, max $MAX_ATTEMPTS attempts)"
rm -f "$DOCS/test-issues.md"
GREEN=0
for i in $(seq 1 "$MAX_ATTEMPTS"); do
  echo " attempt $i"; CUR_ATTEMPT="$i/$MAX_ATTEMPTS"
  agent "impl-$i" "You are a Senior TDD Developer. Read $DOCS/plan-1.md and $DOCS/test-cases-1.md.
Latest test output is in $LOG/tests.log (run '$TEST_CMD' yourself to refresh). Integration output, if present, is in $LOG/integration.log; do NOT start Docker or run the integration suite, the pipeline does that. Edit source files so the failing tests pass.
NEVER edit anything under $TEST_DIR/.
If you are convinced a failing test is itself wrong (it contradicts $DOCS/specs-1.md or $DOCS/decisions.md, or has a test-isolation defect such as leaked mocks), do NOT edit it. Write $DOCS/test-issues.md, one line per test, exactly: <test file path> :: <full test name> :: <why, citing the spec/decision or the isolation defect>. Never claim a test is wrong just because it is hard to pass: source bugs are yours to fix."
  if [ -n "$(git diff --name-only "$RED_SHA" -- "$TEST_DIR")" ]; then
    echo "GUARD FAILED: tests were modified during implementation"; git diff --name-only "$RED_SHA" -- "$TEST_DIR"; exit 1
  fi
  if success_check; then echo " tests and integration green"; GREEN=1; break; fi
done
if [ "$GREEN" -ne 1 ]; then
  if [ ! -f "$DOCS/test-issues.md" ]; then
    echo "GREEN GATE FAILED after $MAX_ATTEMPTS attempts and no test defect was claimed. See $FAIL_LOG"; exit 1
  fi
  # 4b. TEST REPAIR (conditional) --------------------------------------------
  stage "4b Test repair (only because the Implement agent claimed test defects)"
  reject() {
    echo "TEST REPAIR REJECTED: $1"
    git checkout -q "$ORIG_RED_SHA" -- "$TEST_DIR"; git clean -fdq -- "$TEST_DIR"
    echo "   tests restored to $ORIG_RED_SHA. See $LOG/ and $DOCS/test-issues.md"; exit 1
  }
  jest_json_now "$LOG/now.json"
  $CHECK precheck "$LOG/now.json" "$DOCS/test-issues.md" "$MAX_REPAIR_TESTS" || reject "claims fail pre-check (see above)"
  SRC_BEFORE=$(src_hash)
  agent test-repair "You are a Test Repair Agent. The Implement agent claims these tests are wrong; the claims are in $DOCS/test-issues.md. Read it, $DOCS/specs-1.md and $DOCS/decisions.md.
You may edit ONLY the test files named in test-issues.md, and ONLY to fix the claimed defect. Rules:
- Verify each claim yourself. If the test is right and the code is wrong, do not edit the test: write 'NO REPAIR NEEDED: <reason>' to $DOCS/test-repair-1.md and stop.
- Never delete, rename, skip, or weaken a test or assertion. Keep every expect() and keep it at least as strict. Do not add toBeDefined/toBeTruthy/expect.anything to replace exact checks.
- Never edit source files. Never make a test pass by asserting whatever the code currently does.
- For each change write to $DOCS/test-repair-1.md: test name, what was wrong, the spec/decision line or isolation defect that proves it, and what you changed."
  if grep -q '^NO REPAIR NEEDED' "$DOCS/test-repair-1.md" 2>/dev/null; then reject "repair agent says the tests are right; the source is wrong"; fi
  [ "$(src_hash)" = "$SRC_BEFORE" ] || reject "source files were modified during test repair"
  $CHECK diffcheck "$ORIG_RED_SHA" "$DOCS/test-issues.md" || reject "diff check failed (see above)"
  git diff "$ORIG_RED_SHA" -- "$TEST_DIR" > "$LOG/test-repair.diff"
  jest_json_now "$LOG/after.json"
  $CHECK namecheck "$LOG/red.json" "$LOG/after.json" || reject "tests were removed or renamed"
  CHANGED=$( { git diff --name-only "$ORIG_RED_SHA" -- "$TEST_DIR"; git ls-files --others --exclude-standard -- "$TEST_DIR"; } | sort -u)
  # shellcheck disable=SC2086
  jest_json_at "$ORIG_RED_SHA" "$ROOT/$LOG/repaired-on-red.json" $CHANGED
  $CHECK redcheck "$LOG/red.json" "$LOG/repaired-on-red.json" || reject "a repaired test no longer fails on the unimplemented source"
    claude -p "You are an independent, skeptical Test Auditor. You cannot edit anything. A developer agent was blocked by failing tests and another agent edited those tests. Your job is to catch any cheating.
Read $DOCS/specs-1.md, $DOCS/decisions.md, $DOCS/test-issues.md, $DOCS/test-repair-1.md and the test diff in $LOG/test-repair.diff. Then check:
1. Was the ORIGINAL test genuinely wrong (contradicted the spec/decisions, or a real isolation defect)? Quote the spec line.
2. Does the NEW test still verify the specified behaviour with equal or greater strictness?
3. Is it free of tricks: asserting whatever the code returns, loosened matchers, removed cases, changed expected status codes or bodies without spec support?
4. Does the change touch only what the claim justifies?
Reply with your reasoning, then a final line that is exactly 'VERDICT: VALID' or 'VERDICT: INVALID'. If in any doubt, INVALID." \
    --allowedTools Read Glob Grep --max-turns 15 > "$LOG/test-audit.log" 2>&1 || reject "auditor failed to run"
  cp "$LOG/test-audit.log" "$DOCS/test-audit.md"
  [ "$(grep -E '^VERDICT: (VALID|INVALID)$' "$LOG/test-audit.log" | tail -1)" = "VERDICT: VALID" ] || reject "independent auditor did not return VERDICT: VALID"
  success_check || reject "checks still fail after an audited repair; see $FAIL_LOG"
  git add "$DOCS" "$TEST_DIR"
  git commit -q -m "test($SLUG): repair invalid tests (mechanically checked and audited)"
  RED_SHA=$(git rev-parse HEAD)
  echo " test repair accepted; tests locked again at ${RED_SHA:0:7}"
fi

# 5. REVIEW ---------------------------------------------------------------
stage "5/6 Review"
agent review "You are a code reviewer. Review 'git diff $RED_SHA' against $DOCS/specs-1.md for correctness bugs, missed edge cases and security issues.
Fix real problems in source files (never under $TEST_DIR/). Write a short summary to $DOCS/review-1.md."
if [ -n "$(git diff --name-only "$RED_SHA" -- "$TEST_DIR")" ]; then echo "GUARD FAILED: review modified tests"; exit 1; fi
success_check || { echo "Checks broke after review. See $FAIL_LOG"; exit 1; }

# 6. SHIP -----------------------------------------------------------------
stage "6/6 Commit"
git add server "$DOCS"
git commit -q -m "feat($SLUG): implement per $DOCS/specs-1.md"
sed -i.bak -E "s/^- \[ \] (\`$SLUG\`)/- [x] \1/" "$BACKLOG" && rm -f "$BACKLOG.bak"
git add "$BACKLOG" && git commit -q -m "chore(backlog): mark $SLUG done"
echo; echo "DONE: $SLUG on $BRANCH. Review with: git log --oneline $RED_SHA~1..HEAD ; then open a PR."
