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
#        Test repair re-runs UNCLAIMED failing tests once; a pass is a flaky test: WARNING, listed in $LOG/flaky-tests.md, not rejected.
#        Prompts: scripts/prompts/prompt-<stage>.md (spec, plan, red-tests, implement, test-repair, test-audit, review), read at run
#        time. Placeholders: {{DOCS}} {{LOG}} {{TEST_DIR}} {{TEST_CMD}} {{RED_SHA}} {{SLUG}}.
#        Model and effort per stage: MODEL_<STAGE> and EFFORT_<STAGE>, STAGE = SPEC PLAN RED_TESTS IMPLEMENT TEST_REPAIR
#        TEST_AUDIT REVIEW (for example MODEL_IMPLEMENT=opus EFFORT_IMPLEMENT=high). SDLC_MODEL / SDLC_EFFORT set every stage
#        that has no stage-specific value. Models: any `claude --model` value (alias or full id); effort: low|medium|high|xhigh|max.
#        Defaults are in stage_defaults() below.
#        SDLC_INTEGRATION_CI=run  when CI is set the integration suite is skipped with a warning
#        unless this is "run" (which also needs DATABASE_URL)
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
MODELS_JSON="{}"; CUR_MODEL=""; CUR_EFFORT=""
CUR_STAGE=""; CUR_AGENT=""; CUR_ATTEMPT=""; AGENT_STARTED=""; RUN_STATE="running"
set_status() {
  printf '{"slug":"%s","state":"%s","stage":"%s","agent":"%s","model":"%s","effort":"%s","models":%s,"attempt":"%s","agent_started":"%s","run_started":"%s","updated":"%s","pid":%s}\n' \
    "$SLUG" "$RUN_STATE" "$CUR_STAGE" "$CUR_AGENT" "$CUR_MODEL" "$CUR_EFFORT" "$MODELS_JSON" "$CUR_ATTEMPT" "$AGENT_STARTED" "$RUN_STARTED" "$(date +%Y-%m-%dT%H:%M:%S)" "$$" \
    > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
}
# Final state on any exit: done (0), paused for answers (2), failed (anything else).
trap 'rc=$?; case $rc in 0) RUN_STATE=done;; 2) RUN_STATE=paused;; *) RUN_STATE=failed;; esac; CUR_AGENT=""; CUR_MODEL=""; CUR_EFFORT=""; set_status' EXIT

# Default per stage (no limit; override for any run with MODEL_<STAGE> / EFFORT_<STAGE>): "<model> <effort>". See the header.
stage_defaults() {
  case "$1" in
    spec)        echo "opus medium";;
    plan)        echo "opus medium";;
    red-tests)   echo "sonnet medium";;
    implement)   echo "sonnet medium";;
    test-repair) echo "sonnet medium";;
    test-audit)  echo "opus medium";;   # a different model from test-repair, so the audit is independent
    review)      echo "opus medium";;
    *)           echo "sonnet medium";;
  esac
}
# stage_model_effort <stage>: sets SM and SE for the stage (stage env > SDLC_* env > default); exits 1 on a bad effort.
stage_model_effort() {
  local up def dm de; up=$(echo "$1" | tr 'a-z-' 'A-Z_'); def=$(stage_defaults "$1"); dm="${def% *}"; de="${def#* }"
  eval "SM=\"\${MODEL_$up:-\${SDLC_MODEL:-$dm}}\"; SE=\"\${EFFORT_$up:-\${SDLC_EFFORT:-$de}}\""
  case "$SE" in low|medium|high|xhigh|max) ;; *) echo "ERROR: invalid effort '$SE' for stage $1 (use low, medium, high, xhigh or max)" >&2; exit 1;; esac
}
# stage_flags <stage>: sets STAGE_FLAGS to "--model M --effort E" and CUR_MODEL/CUR_EFFORT for the status file.
stage_flags() {
  stage_model_effort "$1"; CUR_MODEL="$SM"; CUR_EFFORT="$SE"
  STAGE_FLAGS=(--model "$SM" --effort "$SE")
  echo "   model=$SM effort=$SE"
}
# Resolved model/effort of every stage, written to status.json so the monitor can show them (and a bad value fails at the start).
MODELS_JSON="{"
for st in spec plan red-tests implement test-repair test-audit review; do
  stage_model_effort "$st"; MODELS_JSON="$MODELS_JSON\"$st\":{\"model\":\"$SM\",\"effort\":\"$SE\"},"
done
MODELS_JSON="${MODELS_JSON%,}}"
# render_prompt <stage>: scripts/prompts/prompt-<stage>.md with the {{PLACEHOLDERS}} filled in.
render_prompt() {
  local f="scripts/prompts/prompt-$1.md" t
  [ -f "$f" ] || { echo "ERROR: missing prompt file $f" >&2; exit 1; }
  t=$(cat "$f")
  t=${t//\{\{DOCS\}\}/$DOCS}; t=${t//\{\{LOG\}\}/$LOG}; t=${t//\{\{TEST_DIR\}\}/$TEST_DIR}
  t=${t//\{\{TEST_CMD\}\}/$TEST_CMD}; t=${t//\{\{RED_SHA\}\}/${RED_SHA:-}}; t=${t//\{\{SLUG\}\}/$SLUG}
  printf '%s' "$t"
}
# agent <log-name> <stage>: headless, scoped tools, bounded turns, transcript saved. The prompt comes from prompt-<stage>.md
# (plus the developer's manual input for that stage, if any); model and effort come from stage_flags.
agent() {
  local name="$1" pstage="$2" prompt
  prompt="$(render_prompt "$pstage")"
  case "$pstage" in test-repair|test-audit) ;; *) prompt="$prompt$(manual_input "$pstage")";; esac
  echo "   -> agent: $name"
  stage_flags "$pstage"
  CUR_AGENT="$name"; AGENT_STARTED="$(date +%Y-%m-%dT%H:%M:%S)"; set_status
  claude -p "$prompt" "${STAGE_FLAGS[@]}" --permission-mode acceptEdits --allowedTools "${ALLOWED[@]}" \
    --max-turns "$MAX_TURNS" > "$LOG/$name.log" 2>&1 \
    || { echo "   !! agent '$name' failed, see $LOG/$name.log"; [ "$pstage" = test-repair ] && resume_hint || true; exit 1; }
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
# retry_unclaimed: one-time re-run of the UNCLAIMED failing tests in now.json; merges flaky passes back into it.
retry_unclaimed() {
  local keys n=0 file pat
  keys=$($CHECK unclaimed "$LOG/now.json" "$DOCS/test-issues.md") || return 1
  [ -n "$keys" ] || return 0
  rm -f "$LOG"/retry-*.json
  printf '%s\n' "$keys" | $CHECK retry-plan | while IFS=$'\t' read -r file pat; do
    n=$((n+1))
    if [ -n "$pat" ]; then (cd server && npx jest "$file" -t "$pat" --json --outputFile="$ROOT/$LOG/retry-$n.json" >/dev/null 2>&1) || true
    else (cd server && npx jest "$file" --json --outputFile="$ROOT/$LOG/retry-$n.json" >/dev/null 2>&1) || true; fi
  done
  $CHECK merge-retry "$LOG/now.json" "$DOCS/test-issues.md" "$LOG/flaky-tests.md" "$LOG"/retry-*.json
}
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
agent "spec-$ROUND_NO" spec
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
agent plan plan
[ -f "$DOCS/plan-1.md" ] || { echo "Plan not produced"; exit 1; }
fi

if [ "$FROM_N" -le 3 ]; then
# 3. RED TESTS ------------------------------------------------------------
stage "3/6 Red tests (red gate)"
[ -f "$DOCS/plan-1.md" ] || { echo "FROM=$FROM but $DOCS/plan-1.md is missing: run Plan first"; exit 1; }
agent tests red-tests
if tests_pass; then echo "RED GATE FAILED: new tests pass before implementation. See $LOG/tests.log"; exit 1; fi
git add "$DOCS" "$TEST_DIR"
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
  agent "impl-$i" implement
  if [ -n "$(git diff --name-only "$RED_SHA" -- "$TEST_DIR")" ]; then
    echo "GUARD FAILED: tests were modified during implementation"; git diff --name-only "$RED_SHA" -- "$TEST_DIR"; exit 1
  fi
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
  retry_unclaimed
  if [ "$FROM_N" -eq 5 ]; then
    # FROM=test-repair: fail early, before any agent runs and before anything is restored.
    $CHECK precheck "$LOG/now.json" "$DOCS/test-issues.md" "$MAX_REPAIR_TESTS" 2> "$LOG/precheck.err" \
      || { echo "REJECT: claims would not pass the pre-check" >&2; cat "$LOG/precheck.err" >&2; exit 1; }
  fi
  $CHECK precheck "$LOG/now.json" "$DOCS/test-issues.md" "$MAX_REPAIR_TESTS" || reject "claims fail pre-check (see above)" hint
  SRC_BEFORE=$(src_hash)
  agent test-repair test-repair
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
  stage_flags test-audit
  AUDIT_PROMPT="$(render_prompt test-audit)"
  claude -p "$AUDIT_PROMPT" "${STAGE_FLAGS[@]}" \
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
agent review review
if [ -n "$(git diff --name-only "$RED_SHA" -- "$TEST_DIR")" ]; then echo "GUARD FAILED: review modified tests"; exit 1; fi
success_check || { echo "Checks broke after review. See $FAIL_LOG"; exit 1; }

# 6. SHIP -----------------------------------------------------------------
stage "6/6 Commit"
bash scripts/sdlc-ship.sh "$SLUG" "$DOCS" "$BASELINE" "$BACKLOG"
echo "Review with: git log --oneline $RED_SHA~1..HEAD ; then open a PR."
