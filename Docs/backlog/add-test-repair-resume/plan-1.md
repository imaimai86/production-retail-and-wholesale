# Plan: add-test-repair-resume

Implements `specs-1.md`. No source edits are made by this plan stage.

## Affected files (from graft and direct reads; shell scripts are not in the graft index)

| File | Why |
|---|---|
| `scripts/sdlc-testcheck.cjs` | new `resumecheck` command (helpers `fail`, `claims`, `git`, `TEST_DIR` already exist) |
| `scripts/sdlc.sh` | `FROM` validation and ordering, resume path, `rm -f` warning, Test repair entry, hint, header comment |
| `scripts/sdlc-mod.sh` | header comment (line 19); it passes `FROM` through unchanged, so there is no logic change |
| `README.md` | SDLC section (the `FROM` resume text around lines 99 and 123-124) |
| `server/__tests__/scripts/sdlc-test-repair-resume.test.js` | new test file (AC12) |
| `server/__tests__/scripts/sdlc-manual-input.test.js` | lines 22 and 26 assert the old error text and the 5-value list, so they must be updated |
| `server/__tests__/scripts/sdlc-mod.test.js` | only if it asserts the `FROM` list; the grep shows it does not (it just passes `FROM=implement` through), so likely no change |

Callers: `resumecheck` is called only from `sdlc.sh` (the up-front gate and the hint). `scripts/sdlc-mod.sh` calls `sdlc.sh`. No other callers are affected.

## Order of work

### Step 1. `scripts/sdlc-testcheck.cjs`: add `resumecheck`
1. Update the header comment: add `resumecheck <red_sha> <test-issues.md> <slug>`. Update the usage string at the end to include `resumecheck`.
2. Read the arguments from the existing `[, , cmd, a, b, c]` destructuring: `a` = red SHA, `b` = claim file, `c` = slug. If `a`, `b` and `c` are all absent, or `b` or `c` is missing, print a usage error and exit 1 (an empty or absent `a` is allowed and means "no commit").
3. Branch `else if (cmd === 'resumecheck')`, collecting rejects into `errs` in this order:
   1. **Commit.** If `a` is empty, push `no red-tests commit found for <slug> (expected a commit with subject "test(<slug>): add failing tests")` and skip the commit-dependent checks 3, 4 and Q2.
   2. **Claim file.** Run these separately: missing (`!fs.existsSync(b)`); empty (`size` 0, or only whitespace); no valid lines (`claims(b).length === 0`). Always evaluated, even without a SHA.
   3. **Repair already accepted (Q2).** Only when `a` is set: `git('log','--format=%h','-1','--grep=^test(<slug>): repair invalid tests', a + '..HEAD')`. If there is output, push `test repair was already accepted in commit <sha>: use FROM=review`. The `--grep` pattern is a basic regex, so escape the slug (`escapeRegex`) and use `git log --fixed-strings` only if the regex escaping proves awkward (the existing shell uses it unescaped, so keep that behaviour).
   4. **Tests unchanged.** Only when `a` is set: `git diff --name-only a -- TEST_DIR` plus `git ls-files --others --exclude-standard -- TEST_DIR`, merged and deduplicated. If non-empty, push `tests changed since the red-tests commit <a7>: <paths>; restore with: git checkout <a> -- server/__tests__ && git clean -fd server/__tests__`.
   5. **Implementation present.** Only when `a` is set: the union of `git diff --name-only a` (committed since `a` plus uncommitted tracked changes) and `git ls-files --others --exclude-standard`. Keep paths that do not start with `server/__tests__/` or `Docs/`. If none remain, push `no implementation change since the red-tests commit (changes only under server/__tests__/ or Docs/ do not count)`.
4. `if (errs.length) fail(errs)`. The `fail` helper prints every `REJECT:` line, so AC5 holds. Exit 0 with no output otherwise. The command only reads git and files.
5. Run git calls with the cwd as the repository (the default for `execFileSync`). Wrap them so that an unknown SHA yields a reject rather than a stack trace.

### Step 2. `scripts/sdlc.sh`: `FROM` validation and stage numbering (top of the file, lines 21-25)
1. Change the `case` to: `spec) 1; plan) 2; red-tests) 3; implement) 4; test-repair) 5; review) 6`. The default branch prints exactly `ERROR: unknown FROM=$FROM (use spec, plan, red-tests, implement, review or test-repair)` and exits 1.
2. The check already sits before the first `git` call (line 98) and the first `mkdir` (line 41). Keep it at the top, directly after the env defaults and before `cd`-dependent work. No code moves before it.
3. Update the two comparisons that used the number 5 for review:
   - Line 175: `[ "$FROM_N" -eq 5 ]` becomes `-eq 6` (review).
   - The `-le 4` block guard (line 182) is handled in Step 4.
4. Line 112 refusal text may add `or FROM=test-repair`. The `-eq 2 || -eq 3` conditions are unchanged.

### Step 3. `scripts/sdlc.sh`: resume path for `FROM=test-repair` (the `else` branch at lines 172-179)
1. Add a branch for `FROM_N -eq 5` before the existing latest-lock lookup: `RED_SHA=$(git log --format=%H -1 --grep="^test($SLUG): add failing tests")` (red-tests commit only, never the repair commit). An empty result is allowed here, because `resumecheck` reports it as check 1.
2. For `FROM_N -eq 5` run `$CHECK resumecheck "$RED_SHA" "$DOCS/test-issues.md" "$SLUG" || exit 1`. This is before any agent call and before `jest_json_at`. Put it in a helper `repair_resume_ok()` (returns 0 or 1, output to stderr) so the hint (Step 5) can reuse it quietly with `>/dev/null 2>&1`.
3. Precondition 5 (the pre-check) runs right after `resumecheck` passes: `jest_json_now "$LOG/now.json"`, then `$CHECK precheck "$LOG/now.json" "$DOCS/test-issues.md" "$MAX_REPAIR_TESTS" || { echo "REJECT: claims would not pass the pre-check"; exit 1; }`. Because stderr already carries the pre-check's reasons, print the `REJECT:` header line before them (capture the output or print the header first) so the order matches the spec. It runs only when checks 1-4 and Q2 passed.
4. Print `Resuming at test-repair from tests commit ${RED_SHA:0:7}`. The existing `ORIG_RED_SHA="$RED_SHA"` (line 180) stays.
5. Call `stage "4b Test repair (only because the Implement agent claimed test defects)"` early for this resume, right after the baseline handling and before the resume lookup, so `status.json` shows `Test repair` from the start. The existing call inside the block stays.

### Step 4. `scripts/sdlc.sh`: jump into the Test repair block (lines 182-246)
1. Change the outer guard `if [ "$FROM_N" -le 4 ]` to `-le 5`, so test-repair enters the block (review is now 6 and still skips it).
2. `jest_json_at "$RED_SHA" "$ROOT/$LOG/red.json"` stays as is and runs for `FROM_N -le 5`.
3. Wrap the `stage "4/6 Implement ..."` call, the `rm -f` and the `for` loop in `if [ "$FROM_N" -le 4 ]; then ... else GREEN=0; fi`. For test-repair no Implement stage, `rm -f`, loop or agent runs, and `GREEN=0` leads straight into the existing `if [ "$GREEN" -ne 1 ]` block.
4. Before `rm -f "$DOCS/test-issues.md"` add: `[ ! -f "$DOCS/test-issues.md" ] || echo "WARNING: test-issues.md exists and will be deleted; use FROM=test-repair to resume at Test repair"`. The `rm -f` itself is unchanged (AC10).
5. The check `[ ! -f "$DOCS/test-issues.md" ]` ("GREEN GATE FAILED") stays and cannot trigger for test-repair, because precondition 2 guarantees the file.
6. The Test repair block body (pre-check, agent, guards, auditor, `success_check`, commit) is unchanged, except for the `reject` hint arguments in Step 5. After an accepted repair, `RED_SHA` is the repair commit and the run proceeds to Review and Ship.

### Step 5. `scripts/sdlc.sh`: resume hint
1. Define `resume_hint()` before `reject`: `if $CHECK resumecheck "$ORIG_RED_SHA" "$DOCS/test-issues.md" "$SLUG" >/dev/null 2>&1; then echo "Resume at Test repair once fixed: FROM=test-repair ./scripts/sdlc.sh $SLUG"; fi`. It covers checks 1-4 and Q2, evaluated at call time.
2. Change `reject()` to take an optional second argument `hint`. After the restore (`git checkout ... && git clean ...`) and the `tests restored` line, and before `exit 1`, call `resume_hint` only when `$2` is `hint`. The `TEST REPAIR REJECTED:` text and the exit code are unchanged.
3. Pass `hint` only for non-verdict reasons:
   - `reject "claims fail pre-check (see above)" hint` (line 212)
   - `... || reject "auditor failed to run" hint` (line 237)
4. Repair agent failure: `agent()` exits from inside the function. In its failure branch, add `[ "$stage" = test-repair ] && resume_hint || true` before `exit 1`. `resume_hint` must therefore be defined before `agent()` is called (define it near the other helpers around line 96; it only needs `ORIG_RED_SHA`, so use `${ORIG_RED_SHA:-}`).
5. No hint for the diff check, name check, red check, auditor `VERDICT: INVALID` or no verdict, source modified, `NO REPAIR NEEDED`, or `success_check` failing after repair.

### Step 6. Docs and comments
1. `scripts/sdlc.sh` header (lines 5-6): list `spec|plan|red-tests|implement|test-repair|review`. Explain that `test-repair` skips Implement, keeps `test-issues.md`, and checks the preconditions first. Note that review resumes from the latest locked tests.
2. `scripts/sdlc-mod.sh` line 19: `FROM=spec|plan|red-tests|implement|test-repair|review`.
3. `README.md` SDLC section (near lines 99 and 123-124): list the six `FROM` values. Describe `FROM=test-repair`: when to use it (a run stopped at Test repair for a non-verdict reason), the preconditions 1-6, the restore command that is printed but never run, and the `FROM=implement` warning.

### Step 7. Tests (written by the Red tests stage, listed here for the file layout)
1. New `server/__tests__/scripts/sdlc-test-repair-resume.test.js`:
   - `resumecheck` cases on a temporary git repo (`git init`, a commit `test(<slug>): add failing tests` with a test file, a claim file, then an implementation commit): the pass case (AC3); each reject case in AC4; a multi-failure case (AC5); the repair-commit case (AC6); a missing-arguments usage error.
   - Text assertions on `scripts/sdlc.sh`: validation precedes `git` and `mkdir`; the unknown-value message; the guard around `rm -f`; the skipped Implement loop for `FROM=test-repair`; the hint text; the `WARNING:` line.
   - One execution test with `FROM=bogus` in a temporary copy laid out as `<tmp>/scripts/sdlc.sh`: exit 1, the exact message, and nothing created.
2. Update `server/__tests__/scripts/sdlc-manual-input.test.js`: the expected message (line 22) and the accepted list (line 26) to include `test-repair`.
3. `server/__tests__/scripts/sdlc-mod.test.js`: no change expected.

### Step 8. Verification
1. `bash -n scripts/sdlc.sh scripts/sdlc-mod.sh` (AC11).
2. `npm test` from the repo root.
3. Manual dry run in a scratch clone, never in this worktree: `FROM=bogus`, and `FROM=test-repair` with the preconditions deliberately failing, to confirm that no agent is called.

## Risks and notes
- Renumbering `review` from 5 to 6 must be reflected at every `FROM_N` comparison. The only one that tests review by number is line 175. The `-le N` guards (lines 103, 115, 152, 161, 182) keep their meaning once line 182 becomes `-le 5` and the Implement loop is wrapped separately.
- `set -euo pipefail` is active, so every new check must use `|| exit 1`, `|| true`, or an `if`.
- `reject()` is defined inside the `-le 5` block. `resume_hint` must be defined earlier, because `agent()` can call it before `reject()` exists.
- The Q2 and tests-unchanged rejects can both print. This is intended (spec section 4, Q2 paragraph).
- Graft does not index `.sh` files, so shell edits cannot use `graft callers`. The shell call sites above were found by direct grep and read.
