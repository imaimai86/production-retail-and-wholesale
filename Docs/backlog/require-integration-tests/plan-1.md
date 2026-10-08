# Plan: require-integration-tests

Implements `specs-1.md`. Stage names are used throughout. No source edits are made by this plan document.

Graft indexes only `scripts/sdlc-testcheck.cjs` among the touched files (shell scripts and docs are not indexed), so the shell files were read directly. Callers found:
- `success_check` (`scripts/sdlc.sh:82`) has three call sites (Implement loop, Test repair, Review). It already treats any non-zero integration exit as a failure, so exit 3 needs no change there.
- `integration_check` (`scripts/sdlc.sh:80`) is used only by `success_check`. The Red gate needs the exit code, so it calls `scripts/sdlc-integration.sh` directly instead.
- Existing tests that read `scripts/sdlc.sh` as text constrain the edits (see "Constraints from existing tests").

## DB and API changes

- none

(This plan changes only pipeline scripts, command docs and script tests. It adds no database or API behaviour in `server/`, so the section is `- none`.)

## Constraints from existing tests (must keep passing)

- `sdlc-gates.test.js` "Red tests gate stays unit-only": the first line matching `RED GATE FAILED` must contain `tests_pass` and must not contain `success_check`. Keep the existing unit-only line first and on one line; the new integration `RED GATE FAILED` line comes after it.
- `sdlc-gates.test.js` "success_check is used at exactly three call sites": do not add a fourth `success_check` call.
- `sdlc-ship-wiring.test.js`: the string `git add "$DOCS" "$TEST_DIR"` and the commit message `test($SLUG): add failing tests and spec/plan docs` must remain verbatim.
- `sdlc-manual-input.test.js` slices `sdlc.sh` between `manual_input() {` and `tests_pass()`; do not insert new functions between them.
- `set -euo pipefail` is active in `sdlc.sh`: capture exit codes with `rc=0; cmd || rc=$?`.

## Order of work

### Step 1. `scripts/sdlc-integration.sh`: exit 3 for infrastructure errors (section 7)
1. Line 15: `exit 1` becomes `exit 3` (no `test:integration` script).
2. Line 73: `exit 1` becomes `exit 3` (container not ready after 60 attempts).
3. Line 78: `exit 1` becomes `exit 3` (no `DATABASE_URL` and no docker).
4. Line 61 (container port cannot be determined) stays `exit 1` (review item R2). Message texts are unchanged.
5. Update the header comment to list the exit codes: 0 pass or CI skip, 1 tests fail, 3 suite could not run.

### Step 2. `server/__tests__/scripts/sdlc-integration.test.js` (AC17)
- Test 4 (line 116): `expect(r.status).toBe(3)`; rename the title to "exits 3".
- Test 7 (line 167): `expect(r.status).toBe(3)`; rename the title to "exits 3".
- Test 6d (line 159, container never ready) already exists with shims, so R1 is testable: change `not.toBe(0)` to `toBe(3)`. Keep the 60 `docker exec` and `docker rm -f` assertions.
- Tests 6b and 6c stay (npm failure propagates 1, other codes propagate).
- Add a test that the port-undetermined case still exits 1 only if the docker shim can return an empty `docker port`; otherwise leave it as review item R2.

### Step 3. New `scripts/sdlc-integration-gate.cjs` (section 5)
Style: copy the header comment, `fail = msgs => { console.error(msgs.map(m => 'REJECT: ' + m).join('\n')); process.exit(1); }` and `git = (...a) => execFileSync('git', a, ...)` helpers from `scripts/sdlc-testcheck.cjs:9-15,42`. Dispatch on `process.argv[2]`; unknown subcommand or missing args prints usage to stderr and exits 1. Header comment documents both subcommands.

Functions:
- `parseSection(planFile)`: read the file, find the line equal to `## DB and API changes` (trim trailing whitespace), take lines until the next line starting with `## ` or end of file, drop blank lines. Returns `{ bullets: [{line, kind, token}], none }`.
  - Missing section: `fail(["Plan has no '## DB and API changes' section"])`.
  - Bullet regexes (anchored, one per form):
    - API: ``^- API: `([A-Z]+ \S+)`$``
    - migration: ``^- DB: migration `([^`\s]+)`$``
    - table: ``^- DB: table `([^`\s]+)`$``
    - column: ``^- DB: column `([^`\s.]+\.[^`\s.]+)`$``
    - model: ``^- DB: model `([^`\s]+)`$``
    - none: ``^- none$``
  - Reject with a `REJECT:` line naming the offending line for: an unmatched line, an empty section (no bullets), or `- none` together with any other bullet. Collect all offending lines into one `fail` call.
- `changedIntegrationFiles(testDir)`: `git diff HEAD --name-only -- <testDir>/integration/`, filtered to files that still exist on disk. `git diff HEAD` includes staged new files; untracked files are not listed, so they do not count. Files outside `integration/` are never read.
- `cmdPlan(planFile, testDir)`: parse; if `none`, exit 0. Otherwise read the text of every changed integration file once, and for each bullet check `text.includes(token)`. Collect one `REJECT:` line per missing bullet, in the form ``bullet `<token>` (<bullet line>) is not in any new or modified file under <testDir>/integration/``. Exit 1 if any, else 0.
- `SOURCE_PATHS = ['server/migrations/', 'server/schema.sql', 'server/models/', 'server/index.js', 'server/middleware/', 'server/validation.js']`.
- `sourceChanges(redSha)`: `git diff -U0 -w --ignore-blank-lines <redSha> -- ...SOURCE_PATHS`. Parse per file (`diff --git a/<f> b/<f>` headers). For each `+` or `-` line (skip `+++`/`---`), `trim()` the text after the marker and drop it if it starts with `//`, `*`, `/*` or `--`. Return the set of files with at least one remaining line. Tracked changes only, so untracked files are not seen (section 5.3).
- `cmdDiff(redSha, origRedSha)`: `files = sourceChanges(redSha)`; if empty, exit 0. Else `git diff --name-only <origRedSha>~1 <origRedSha> -- server/__tests__/integration/`; non-empty means exit 0. If empty, `fail` listing each changed source file plus "add integration tests: rerun from Plan (FROM=plan)".
- Make the file executable-agnostic (invoked as `node scripts/sdlc-integration-gate.cjs`, like `$CHECK`). Do not add a `chmod`.

### Step 4. New `server/__tests__/scripts/sdlc-integration-gate.test.js` (AC1-AC10)
Use throwaway repos: `fs.mkdtempSync` in `os.tmpdir()`, `git init`, set `user.name`/`user.email`, initial commit containing `server/__tests__/integration/existing.integration.test.js`, `server/__tests__/foo.test.js` and one file per source path. Run the gate with `spawnSync('node', [gate, ...args], { cwd: repo })`. These tests exercise the script; they never read a test file's text.
- AC1-AC5: `plan` cases from section 10 (the five bullet kinds with token present in a modified file, a new staged file, and absent; token only in a unit test, only in an unmodified integration file, only in an untracked integration file; malformed bullet, empty section, `- none` plus another bullet; missing section message).
- AC6-AC10: `diff` cases: each of the six source paths with and without integration tests in the "original" commit; comment-only (`//`, `*`, `/*`, `--`) and whitespace-only edits; docs, `server/test-utils/`, `server/scripts/`, package files; a repair commit after the red commit with the original red commit holding the integration tests; an untracked new file under `server/migrations/`.
- Unknown subcommand and missing arguments exit 1 with usage.

### Step 5. `scripts/sdlc.sh` (sections 4, 6; AC11-AC16)
Edit in file order.

1. **Header comment (lines 1-17)**: add one line noting the Red tests stage requires integration tests for DB and API changes and that there is no opt-out.
2. **Constants (near line 29)**: add `GATE="node scripts/sdlc-integration-gate.cjs"`.
3. **Plan prompt (line 164)**: append a rule requiring `plan-1.md` to contain a section headed exactly `## DB and API changes`, whose bullets are exactly one of the six forms of spec 3.1 (list each form with its token), or the single bullet `- none` when no DB or API behaviour changes.
4. **Red tests prompt (line 173)**: append the integration requirement. For each bullet other than `- none`, write integration tests in `server/__tests__/integration/` following `api.integration.test.js` (helper `server/test-utils/scratchDb.js`, `supertest` on `require('../../index')`), write the bullet's token (the text between the backticks) in a `describe` or `test` title, and add a matching section in `test-cases-1.md`. Name the section `## DB and API changes`. Existing rules stay unchanged.
5. **Red gate (lines 176-179)**: replace with the following order. The unit-only `RED GATE FAILED` line keeps its text and its `tests_pass` call so the existing gates test still passes.
   ```
   git add "$DOCS" "$TEST_DIR"                      # staging: new integration files must show in git diff HEAD
   $GATE plan "$DOCS/plan-1.md" "$TEST_DIR" || exit 1
   INT_NONE=0; grep -qx -- '- none' <section> ...   # see below
   UNIT_PASS=0; tests_pass && UNIT_PASS=1
   if [ "$INT_NONE" -eq 1 ]; then
     if [ "$UNIT_PASS" -eq 1 ]; then echo "RED GATE FAILED: new tests pass before implementation. See $LOG/tests.log"; exit 1; fi
   else
     INT_RC=skipped
     if [ -n "${CI:-}" ] && [ "${SDLC_INTEGRATION_CI:-}" != "run" ]; then
       echo "WARNING: TEMPORARY: integration red check skipped in CI ..."
       -> unit verdict applies: pass only if UNIT_PASS=0
     else
       INT_RC=0; bash scripts/sdlc-integration.sh > "$LOG/integration.log" 2>&1 || INT_RC=$?
       case "$INT_RC" in
         0) echo "RED GATE FAILED: new integration tests pass before implementation. See $LOG/integration.log"; exit 1;;
         3) echo "ERROR: no database for the integration red check (set DATABASE_URL or start Docker)"; exit 1;;
         *) : ;;   # 1 (or any other non-zero): integration tests fail, the expected red result
       esac
     fi
   fi
   git commit -q -m "test($SLUG): add failing tests and spec/plan docs"
   RED_SHA=$(git rev-parse HEAD)
   ```
   - Detecting `- none` without a second parser: add a third gate subcommand is out of scope, so use the gate's output. Make `cmdPlan` print `NONE` on stdout when the section is `- none` and nothing otherwise, and capture it in `sdlc.sh` with `PLAN_OUT=$($GATE plan ... ) || exit 1; [ "$PLAN_OUT" = NONE ] && INT_NONE=1`. This keeps parsing in one place. (Document the stdout marker in the gate header; the spec's exit codes and `REJECT:` stderr are unchanged.)
   - The reject path of the `plan` check runs after `git add` but before the commit, so no commit is made (spec 4.2). The staged files stay staged; that is acceptable and noted in the README.
   - CI skip: the `CI` condition is written in `sdlc.sh` itself (AC15), not inferred from the script's exit 0 + warning. In CI, with a non-`- none` section, the gate passes only when `npm test` fails; if `npm test` passes, print the unit-only `RED GATE FAILED` message and exit 1.
   - The integration red check runs whatever the unit result (Round 3 Q1), so call `tests_pass` first, store the result, then run the integration check; do not short-circuit.
   - Use a new variable, not `integration_check`, because the red check needs the exit code and `integration_check` is only defined for `success_check`.
6. **Original red commit variable (after line 194 `ORIG_RED_SHA="$RED_SHA"`)**: add
   ```
   INT_RED_SHA=$(git log --format=%H -1 --grep="^test($SLUG): add failing tests")
   [ -n "$INT_RED_SHA" ] || { echo "FROM=$FROM but no red-tests commit found for $SLUG"; exit 1; }
   ```
   This is the red-tests commit on a fresh run (just created) and on every resume (`FROM=implement`, `test-repair`, `review`). `ORIG_RED_SHA` and `RED_SHA` handling for the other guards stays untouched. The spec's text names this value `<orig_red_sha>`; the shell name `INT_RED_SHA` avoids changing what `ORIG_RED_SHA` means for the Test repair guards (`ORIG_RED_SHA` at `FROM=review` is the repair commit).
7. **Diff gate, Implement loop (after the test-modified guard at lines 211-213)**: `$GATE diff "$RED_SHA" "$INT_RED_SHA" || exit 1`. It runs before `success_check`, so each attempt is checked.
8. **Diff gate, Review (after the guard at line 278, before `success_check` at 279)**: `$GATE diff "$RED_SHA" "$INT_RED_SHA" || exit 1`.
9. Run `bash -n scripts/sdlc.sh` (AC16).

### Step 6. New `server/__tests__/scripts/sdlc-integration-gate-wiring.test.js` (AC11-AC16)
Read `scripts/sdlc.sh` only (review item R3). Follow the `sdlc-gates.test.js` helpers (`read`, `lines`, `lineWith`).
- AC11: the Plan prompt contains `## DB and API changes`; the Red tests prompt contains `## DB and API changes` and `server/__tests__/integration/`.
- AC12: `indexOf` order: `sdlc-integration-gate.cjs`/`plan` call < `scripts/sdlc-integration.sh` red check < the integration `RED GATE FAILED` line; and `git add "$DOCS" "$TEST_DIR"` precedes the `plan` call.
- AC13: the exact strings `RED GATE FAILED: new integration tests pass before implementation. See $LOG/integration.log` and `ERROR: no database for the integration red check (set DATABASE_URL or start Docker)` are present.
- AC14: `diff "$RED_SHA" "$INT_RED_SHA"` appears inside the Implement loop (between `4/6 Implement` and `4b Test repair`) and after the `5/6 Review` stage marker.
- AC15: the text `-n "${CI:-}"` and `!= "run"` appear together in the integration red check.
- AC16: `spawnSync('bash', ['-n', scripts/sdlc.sh])` status 0.

### Step 7. Command docs (AC18, section 8)
- `.claude/commands/plan.md`: require the `## DB and API changes` section with the six bullet forms; say a bad plan is rejected at the Red tests stage.
- `.claude/commands/red-tests.md`: require integration tests per bullet in `server/__tests__/integration/`, the token in a `describe`/`test` title, and a matching `test-cases-1.md` section; describe the `plan` check and the integration red check (must fail before implementation).
- `.claude/commands/tdd-loop.md`: describe the diff gate after each Implement attempt and after Review, and that the original red commit is the reference.
Read each file before editing to match its existing tone and structure.

### Step 8. Guidelines and README (AC18)
- `AGENTS.md` (Development guidelines; line 48 is the nearest existing integration line) and `CLAUDE.md` (Development guidelines): add "Every DB or API change needs integration tests in `server/__tests__/integration/`."
- `README.md`:
  - "Running integration tests" (line 62) or the "SDLC pipeline: integration tests" section (line 73), whichever the existing text fits: add the `## DB and API changes` format table (spec 3.1), the Red gate and diff gate behaviour (spec 4.3, 5.2), the exit codes 0/1/3, the CI skip, the untracked-file limitation (spec 5.3), the fact that a bad plan costs one Red tests agent run, and that there is no opt-out.

### Step 9. Verify
1. `npm test` from the repo root (all new and updated script tests green; the existing gates and ship-wiring tests still pass).
2. `bash -n scripts/sdlc.sh scripts/sdlc-integration.sh`.
3. `bash scripts/sdlc-integration.sh` once with `DATABASE_URL` set to confirm exit 0/1 behaviour is unchanged.
4. Do not start a pipeline run. Review items R1 (now covered by test 6d) and R2 (port-undetermined `exit 1` left unchanged) are listed for the reviewer.

## Files touched (summary)

| File | Change | Step |
|---|---|---|
| `scripts/sdlc-integration.sh` | three `exit 1` become `exit 3`, header comment | 1 |
| `server/__tests__/scripts/sdlc-integration.test.js` | tests 4, 7, 6d expect 3 | 2 |
| `scripts/sdlc-integration-gate.cjs` | new: `plan`, `diff` | 3 |
| `server/__tests__/scripts/sdlc-integration-gate.test.js` | new: AC1-AC10 | 4 |
| `scripts/sdlc.sh` | prompts, Red gate, `INT_RED_SHA`, two diff-gate calls | 5 |
| `server/__tests__/scripts/sdlc-integration-gate-wiring.test.js` | new: AC11-AC16 | 6 |
| `.claude/commands/plan.md`, `red-tests.md`, `tdd-loop.md` | describe section, tests, gates | 7 |
| `AGENTS.md`, `CLAUDE.md`, `README.md` | guidelines and documentation | 8 |

## Risks and notes

- `- none` detection: the plan places the `NONE` stdout marker in the gate (single parser). If the spec author prefers no stdout contract, the alternative is a second small `section` subcommand; the plan keeps one subcommand set as in spec section 5.
- `git diff HEAD` in the `plan` check needs a `HEAD` commit; this always holds on a pipeline branch.
- The `diff` gate uses `-w --ignore-blank-lines`, which also hides whitespace-only changes inside a line; this matches spec 5.2 step 2.
- Deleted-then-restored or renamed integration files in the original red commit count as "non-empty" for `git diff --name-only`; accepted by the spec.
- The `plan` check stages `$DOCS` and `$TEST_DIR` before a possible reject; a rerun from `FROM=red-tests` restages them, so this is harmless.
