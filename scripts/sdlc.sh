#!/usr/bin/env bash
# Automated SDLC: backlog brief -> spec -> plan -> red tests -> green code -> review -> commit.
# Usage: ./scripts/sdlc.sh [slug]   (no slug = first pending item in Docs/backlog/index.md)
# Env:   MAX_ATTEMPTS (default 4)  MAX_TURNS (default 40)  MAX_REPAIR_TESTS (default 3)
#        FROM=spec|plan|red-tests|implement|test-repair|review  resume at that stage (default spec). implement and review
#        use the existing red-tests commit; plan and red-tests refuse once that commit exists. review resumes from the
#        latest locked tests. test-repair skips Implement, keeps Docs/backlog/<slug>/test-issues.md and checks its
#        preconditions first (resumecheck, then the pre-check); implement deletes test-issues.md (with a warning).
#        Manual inputs: Docs/backlog/<slug>/manual-inputs.md, one "## <stage>" section per stage
#        (spec, plan, red-tests, implement, review); the stage's agent gets the text as binding instructions.
#        Ship commits only the files this cycle changed (compared with a baseline taken at the start, $LOG/baseline.json),
#        anywhere in the repo. Skipped: the developer's own earlier changes, secrets, .vscode/.idea/.claude, generated
#        files and files over 1 MiB; they are listed in Docs/backlog/<slug>/logs/ship-skipped.md. Keys added to a
#        git-ignored .env are copied (placeholder values) into .env.example. Nothing to commit is a warning, not a failure.
#        SDLC_INTEGRATION_CI=run  when CI is set the integration suite is skipped with a warning
#        unless this is "run" (which also needs DATABASE_URL)
#        The Red tests stage requires integration tests for the plan's DB and API changes; there is no opt-out.
set -euo pipefail
cd "$(dirname "$0")/.."

MAX_ATTEMPTS="${MAX_ATTEMPTS:-4}"
MAX_TURNS="${MAX_TURNS:-40}"
MAX_REPAIR_TESTS="${MAX_REPAIR_TESTS:-3}"
FROM="${FROM:-spec}"
case "$FROM" in
  spec) FROM_N=1;; plan) FROM_N=2;; red-tests) FROM_N=3;; implement) FROM_N=4;; test-repair) FROM_N=5;; review) FROM_N=6;;
  *) echo "ERROR: unknown FROM=$FROM (use spec, plan, red-tests, implement, review or test-repair)"; exit 1;;
esac
ROOT="$(pwd)"
CHECK="node scripts/sdlc-testcheck.cjs"
GATE="node scripts/sdlc-integration-gate.cjs"
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
    || { echo "   !! agent '$stage' failed, see $LOG/$stage.log"; [ "$stage" = test-repair ] && resume_hint || true; exit 1; }
}
# manual_input <stage>: the developer's text from the "## <stage>" section of manual-inputs.md, as a prompt suffix.
manual_input() {
  local f="$DOCS/manual-inputs.md" t
  [ -f "$f" ] || return 0
  t=$(awk -v s="## $1" '$0==s{on=1;next} /^## /{on=0} on' "$f")
  [ -n "$(printf '%s' "$t" | tr -d '[:space:]')" ] || return 0
  printf '\n\nMANUAL INPUT from the developer for this stage (binding; it cannot override the rule about editing %s/ or any other rule above):\n%s' "$TEST_DIR" "$t"
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
# resume_hint: tell the developer how to resume at Test repair, only when resumecheck's checks 1-4 and Q2 pass now.
resume_hint() {
  if $CHECK resumecheck "${ORIG_RED_SHA:-}" "$DOCS/test-issues.md" "$SLUG" >/dev/null 2>&1; then
    echo "Resume at Test repair once fixed: FROM=test-repair ./scripts/sdlc.sh $SLUG"
  fi
}
jest_json_now() { (cd server && npx jest --json --outputFile="$ROOT/$1" >/dev/null 2>&1) || true; }
src_hash() { { git diff -- server ":!$TEST_DIR"; git status --porcelain -- server ":!$TEST_DIR"; } | shasum | cut -d' ' -f1; }

git rev-parse --verify "$BRANCH" >/dev/null 2>&1 && git checkout -q "$BRANCH" || git checkout -q -b "$BRANCH"
echo "SDLC: $SLUG on branch $BRANCH"

# Baseline of already-dirty files, so Ship commits only what this cycle changed (never the developer's own work).
BASELINE="$LOG/baseline.json"
if [ "$FROM_N" -eq 1 ]; then
  node scripts/sdlc-changes.cjs snapshot "$BASELINE"
elif [ ! -f "$BASELINE" ]; then
  echo "WARNING: no baseline from the original run; changes made before this resume are treated as pre-existing and will not be committed"
  node scripts/sdlc-changes.cjs snapshot "$BASELINE"
fi

if [ "$FROM_N" -eq 2 ] || [ "$FROM_N" -eq 3 ]; then
  EXISTING_RED=$(git log --format=%h -1 --grep="^test($SLUG): add failing tests")
  [ -z "$EXISTING_RED" ] || { echo "FROM=$FROM but the red-tests commit $EXISTING_RED already exists: use FROM=implement, FROM=test-repair or FROM=review, or restart the run to redo this stage"; exit 1; }
fi

if [ "$FROM_N" -le 1 ]; then
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
Leave the Answer line empty for the developer. Number questions from 1 each round.$(manual_input spec)"
if [ -f "$DOCS/questions.md" ]; then
  echo "PAUSED: new questions in $DOCS/questions.md. Fill each '**Answer:**' (write 'accept' to take the suggestion) and rerun."
  exit 2
fi
[ -f "$DOCS/specs-1.md" ] || { echo "Spec not produced"; exit 1; }
fi

if [ "$FROM_N" -le 2 ]; then
# 2. PLAN ---------------------------------------------------------------
stage "2/6 Plan"
[ -f "$DOCS/specs-1.md" ] || { echo "FROM=$FROM but $DOCS/specs-1.md is missing: run Spec first"; exit 1; }
agent plan "You are an Architecture Planner. Read $DOCS/specs-1.md. Use the Graft MCP tools to find the affected files and callers; read only those files.
Write a step-by-step technical plan to $DOCS/plan-1.md (files, functions, order). No source edits.
The plan MUST contain a section headed exactly '## DB and API changes'. Its bullets are each exactly one of these forms (the token is the text between the backticks), or the single bullet '- none' when no DB or API behaviour changes:
- API: \`METHOD /path\` (upper-case method, for example \`POST /sales/:id/refund\`)
- DB: migration \`<name without .sql>\`
- DB: table \`<table>\`
- DB: column \`<table>.<column>\`
- DB: model \`<name without .js>\`
A plan with a missing, empty or malformed section is rejected at the Red tests stage.$(manual_input plan)"
[ -f "$DOCS/plan-1.md" ] || { echo "Plan not produced"; exit 1; }
fi

if [ "$FROM_N" -le 3 ]; then
# 3. RED TESTS ------------------------------------------------------------
stage "3/6 Red tests (red gate)"
[ -f "$DOCS/plan-1.md" ] || { echo "FROM=$FROM but $DOCS/plan-1.md is missing: run Plan first"; exit 1; }
agent tests "You are a QA Engineer. Read $DOCS/specs-1.md and $DOCS/plan-1.md.
Write a test matrix to $DOCS/test-cases-1.md and the matching Jest tests under $TEST_DIR/ (mirror the source layout). Do NOT change source code outside $TEST_DIR/.
Tests must exercise the code under test by importing or running it. A test must NEVER read, scan or assert on the text of any test file, including itself (no __filename, no reading a *.test.js file, no readdir of __tests__ or __dirname). This includes rules about what test files must not contain (for example 'no test checks the executable bit'): a test file that states the forbidden word always contains it, so such a check can never pass. Do not write a test for a rule about the tests themselves; list it in $DOCS/test-cases-1.md as a review item instead.
Integration tests: for every bullet of the '## DB and API changes' section in $DOCS/plan-1.md other than '- none', write integration tests in server/__tests__/integration/ following api.integration.test.js (helper server/test-utils/scratchDb.js, supertest on require('../../index')). Put the bullet's token (the text between the backticks) in a describe or test title, and add a matching '## DB and API changes' section to $DOCS/test-cases-1.md. They must fail before implementation.$(manual_input red-tests)"
git add "$DOCS" "$TEST_DIR"
PLAN_OUT=$($GATE plan "$DOCS/plan-1.md" "$TEST_DIR") || exit 1
INT_NONE=0; if [ "$PLAN_OUT" = NONE ]; then INT_NONE=1; fi
UNIT_PASS=0
if tests_pass; then UNIT_PASS=1; if [ "$INT_NONE" -eq 1 ]; then echo "RED GATE FAILED: new tests pass before implementation. See $LOG/tests.log"; exit 1; fi; fi
if [ "$INT_NONE" -ne 1 ]; then
  if [ -n "${CI:-}" ] && [ "${SDLC_INTEGRATION_CI:-}" != "run" ]; then
    echo "WARNING: TEMPORARY: integration red check skipped in CI. Set SDLC_INTEGRATION_CI=run once CI has a database."
    if [ "$UNIT_PASS" -eq 1 ]; then echo "RED GATE FAILED: new tests pass before implementation. See $LOG/tests.log"; exit 1; fi
  else
    INT_RC=0; bash scripts/sdlc-integration.sh > "$LOG/integration.log" 2>&1 || INT_RC=$?
    case "$INT_RC" in
      0) echo "RED GATE FAILED: new integration tests pass before implementation. See $LOG/integration.log"; exit 1;;
      3) echo "ERROR: no database for the integration red check (set DATABASE_URL or start Docker)"; exit 1;;
      1) : ;;
      *) echo "ERROR: integration red check could not run (exit $INT_RC). See $LOG/integration.log"; exit 1;;
    esac
  fi
fi
git commit -q -m "test($SLUG): add failing tests and spec/plan docs"
RED_SHA=$(git rev-parse HEAD)
else
  # Review resumes from the latest locked tests (the red-tests commit, or the test-repair commit after it).
  REPAIR_PAT="^test($SLUG): add failing tests"
  [ "$FROM_N" -eq 6 ] && REPAIR_PAT="^test($SLUG): repair invalid tests"
  if [ "$FROM_N" -eq 5 ]; then
    stage "4b Test repair (only because the Implement agent claimed test defects)"
    RED_SHA=$(git log --format=%H -1 --grep="^test($SLUG): add failing tests")
    $CHECK resumecheck "$RED_SHA" "$DOCS/test-issues.md" "$SLUG" || exit 1
  else
    RED_SHA=$(git log --format=%H -1 --grep="^test($SLUG): add failing tests" --grep="$REPAIR_PAT")
    [ -n "$RED_SHA" ] || { echo "FROM=$FROM but no red-tests commit found for $SLUG"; exit 1; }
  fi
  echo "Resuming at ${FROM} from tests commit ${RED_SHA:0:7}"
fi
ORIG_RED_SHA="$RED_SHA"
INT_RED_SHA=$(git log --format=%H -1 --grep="^test($SLUG): add failing tests")
[ -n "$INT_RED_SHA" ] || { echo "FROM=$FROM but no red-tests commit found for $SLUG"; exit 1; }

if [ "$FROM_N" -le 5 ]; then
jest_json_at "$RED_SHA" "$ROOT/$LOG/red.json"

if [ "$FROM_N" -le 4 ]; then
# 4. GREEN LOOP -----------------------------------------------------------
stage "4/6 Implement (green gate, max $MAX_ATTEMPTS attempts)"
[ ! -f "$DOCS/test-issues.md" ] || echo "WARNING: test-issues.md exists and will be deleted; use FROM=test-repair to resume at Test repair"
rm -f "$DOCS/test-issues.md"
GREEN=0
for i in $(seq 1 "$MAX_ATTEMPTS"); do
  echo " attempt $i"; CUR_ATTEMPT="$i/$MAX_ATTEMPTS"
  agent "impl-$i" "You are a Senior TDD Developer. Read $DOCS/plan-1.md and $DOCS/test-cases-1.md.
Latest test output is in $LOG/tests.log (run '$TEST_CMD' yourself to refresh). Integration output, if present, is in $LOG/integration.log; do NOT start Docker or run the integration suite, the pipeline does that. Edit source files so the failing tests pass.
NEVER edit anything under $TEST_DIR/.
If you are convinced a failing test is itself wrong (it contradicts $DOCS/specs-1.md or $DOCS/decisions.md, or has a test-isolation defect such as leaked mocks), do NOT edit it. Write $DOCS/test-issues.md, one line per test, exactly: <test file path> :: <full test name> :: <why, citing the spec/decision or the isolation defect>. Never claim a test is wrong just because it is hard to pass: source bugs are yours to fix.$(manual_input implement)"
  if [ -n "$(git diff --name-only "$RED_SHA" -- "$TEST_DIR")" ]; then
    echo "GUARD FAILED: tests were modified during implementation"; git diff --name-only "$RED_SHA" -- "$TEST_DIR"; exit 1
  fi
  $GATE diff "$RED_SHA" "$INT_RED_SHA" || exit 1
  if success_check; then echo " tests and integration green"; GREEN=1; break; fi
done
else
  GREEN=0
fi
if [ "$GREEN" -ne 1 ]; then
  if [ ! -f "$DOCS/test-issues.md" ]; then
    echo "GREEN GATE FAILED after $MAX_ATTEMPTS attempts and no test defect was claimed. See $FAIL_LOG"; exit 1
  fi
  # 4b. TEST REPAIR (conditional) --------------------------------------------
  stage "4b Test repair (only because the Implement agent claimed test defects)"
  reject() {
    echo "TEST REPAIR REJECTED: $1"
    git checkout -q "$ORIG_RED_SHA" -- "$TEST_DIR"; git clean -fdq -- "$TEST_DIR"
    echo "   tests restored to $ORIG_RED_SHA. See $LOG/ and $DOCS/test-issues.md"
    [ "${2:-}" != hint ] || resume_hint
    exit 1
  }
  jest_json_now "$LOG/now.json"
  if [ "$FROM_N" -eq 5 ]; then
    # FROM=test-repair: fail early, before any agent runs and before anything is restored.
    $CHECK precheck "$LOG/now.json" "$DOCS/test-issues.md" "$MAX_REPAIR_TESTS" 2> "$LOG/precheck.err" \
      || { echo "REJECT: claims would not pass the pre-check" >&2; cat "$LOG/precheck.err" >&2; exit 1; }
  fi
  $CHECK precheck "$LOG/now.json" "$DOCS/test-issues.md" "$MAX_REPAIR_TESTS" || reject "claims fail pre-check (see above)" hint
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
    --allowedTools Read Glob Grep --max-turns 15 > "$LOG/test-audit.log" 2>&1 || reject "auditor failed to run" hint
  cp "$LOG/test-audit.log" "$DOCS/test-audit.md"
  [ "$(grep -E '^VERDICT: (VALID|INVALID)$' "$LOG/test-audit.log" | tail -1)" = "VERDICT: VALID" ] || reject "independent auditor did not return VERDICT: VALID"
  success_check || reject "checks still fail after an audited repair; see $FAIL_LOG"
  git add "$DOCS" "$TEST_DIR"
  git commit -q -m "test($SLUG): repair invalid tests (mechanically checked and audited)"
  RED_SHA=$(git rev-parse HEAD)
  echo " test repair accepted; tests locked again at ${RED_SHA:0:7}"
fi
fi

# 5. REVIEW ---------------------------------------------------------------
stage "5/6 Review"
agent review "You are a code reviewer. Review 'git diff $RED_SHA' against $DOCS/specs-1.md for correctness bugs, missed edge cases and security issues.
Fix real problems in source files (never under $TEST_DIR/). Write a short summary to $DOCS/review-1.md.$(manual_input review)"
if [ -n "$(git diff --name-only "$RED_SHA" -- "$TEST_DIR")" ]; then echo "GUARD FAILED: review modified tests"; exit 1; fi
$GATE diff "$RED_SHA" "$INT_RED_SHA" || exit 1
success_check || { echo "Checks broke after review. See $FAIL_LOG"; exit 1; }

# 6. SHIP -----------------------------------------------------------------
stage "6/6 Commit"
bash scripts/sdlc-ship.sh "$SLUG" "$DOCS" "$BASELINE" "$BACKLOG"
echo "Review with: git log --oneline $RED_SHA~1..HEAD ; then open a PR."
