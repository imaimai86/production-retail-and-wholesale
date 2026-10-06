# add-test-repair-resume

Type: feature
Priority: P2 (normal)
Source: user request: "Add a resume point at Test repair when it would likely have worked. Check preconditions for Test repair like the claim file still exists." Seen on a real run: `fix-ship-commit-scope` stopped with the implementation uncommitted and a `test-issues.md` claim file on disk, with no way to continue at Test repair.

## Problem
Verified by reading `scripts/sdlc.sh` (not by running it):
- The only resume point is `FROM=implement` (`scripts/sdlc.sh:5`, `scripts/sdlc-mod.sh:15`). `FROM` is checked only against `spec`: anything else, including a typo or `FROM=test-repair`, silently takes the `else` branch at `:132-136` and prints "Resuming at Implement".
- Resuming at Implement runs `rm -f "$DOCS/test-issues.md"` (`:142`), so the claim file is deleted and all `MAX_ATTEMPTS` Implement attempts are spent again. A run that died or was stopped at Test repair (for example the repair agent or the auditor failed to run, a rate limit, or the developer fixed the claim file by hand) cannot continue without losing the claim.
- The Test repair block (`:155-199`) depends on state that is easy to break and is not checked up front: the claim file, the red-tests commit (`ORIG_RED_SHA`, found from the commit message at `:133`), the test directory being unchanged since that commit, implementation changes present in the working tree, and `precheck` passing against the current failing tests. Today these are discovered one by one, after agent calls were already spent.

## Expected behaviour
`FROM=test-repair ./scripts/sdlc.sh <slug>` skips Spec, Plan, Red tests and Implement, checks every precondition of Test repair first, and continues at Test repair only when it would likely work. If any precondition fails it stops immediately, lists every failed precondition, calls no agent and changes nothing. After an accepted repair the run continues to Review and Ship as today.

## Decisions
- Accepted values of `FROM`: `spec` (default), `implement`, `test-repair`. Any other value exits 1 with `ERROR: unknown FROM=<value> (use spec, implement or test-repair)` BEFORE any git or file change (fixes the silent fallthrough). The check sits at the top of `scripts/sdlc.sh`, before the branch checkout.
- `FROM=test-repair` reuses the existing resume path for the red-tests commit (`git log --grep="^test(<slug>): add failing tests"`), regenerates `$LOG/red.json` as `FROM=implement` does, does NOT run `rm -f "$DOCS/test-issues.md"`, skips the Implement loop and its agents, and jumps into the existing Test repair block unchanged. `status.json` shows stage `Test repair` from the start.
- Preconditions, all checked before any agent runs, all reported together (one `REJECT:` line per failure, same style as `sdlc-testcheck.cjs`), exit 1 if any fails:
  1. A red-tests commit exists for the slug.
  2. `$DOCS/test-issues.md` exists, is non-empty, and `node scripts/sdlc-testcheck.cjs claimed` prints at least one claim key.
  3. The test directory is unchanged since the red-tests commit: `git diff --name-only <RED_SHA> -- server/__tests__` is empty and there are no untracked files under `server/__tests__`. If not, print the exact restore command (`git checkout <RED_SHA> -- server/__tests__ && git clean -fd server/__tests__`) and do not run it.
  4. The implementation is present: there is at least one changed path (commits or working tree) since `<RED_SHA>` outside `server/__tests__/` and `Docs/`.
  5. The claims would pass the pre-check: run `jest_json_now "$LOG/now.json"` and `node scripts/sdlc-testcheck.cjs precheck "$LOG/now.json" "$DOCS/test-issues.md" "$MAX_REPAIR_TESTS"` exactly as the Test repair block does; a failure is reported as `claims would not pass the pre-check` followed by its own reasons.
- The checks 1-4 live in a new command of `scripts/sdlc-testcheck.cjs`: `resumecheck <red_sha> <test-issues.md> <slug>` (exit 0 when all pass, otherwise exit 1 with the `REJECT:` lines). Check 5 stays in `scripts/sdlc.sh`, reusing the existing pre-check.
- Hint on failure: when the Test repair block exits for a non-verdict reason (the repair agent or the auditor failed to run, or `claims fail pre-check`), print `Resume at Test repair once fixed: FROM=test-repair ./scripts/sdlc.sh <slug>` only if checks 1-4 currently pass. Verdict rejections (the diff, name or red checks, an auditor `VERDICT: INVALID`, tests still failing after a repair) print no hint, because resuming would repeat the same verdict.
- `FROM=implement` is unchanged (it still deletes the claim file), except that it prints one extra line when the claim file exists: `WARNING: test-issues.md exists and will be deleted; use FROM=test-repair to resume at Test repair`.
- `MAX_REPAIR_TESTS`, the Test repair checks, the auditor and the commit made after an accepted repair are not changed. `scripts/sdlc-mod.sh` passes `FROM=test-repair` through to `sdlc.sh` like `FROM=implement`; update its header comment.

## Scope
- In: `scripts/sdlc.sh` (the `FROM` validation, the resume path, the hints), `scripts/sdlc-testcheck.cjs` (`resumecheck`), `scripts/sdlc-mod.sh` (header comment and pass-through), `README.md`.
- Out of scope: the Test repair checks and agent prompts, the Implement loop, the Review and Ship stages, the control pane plugin buttons (a follow-up), `fix-ship-commit-scope`.
- This item edits `scripts/sdlc.sh`, as do `fix-ship-commit-scope` (in progress) and the flaky-test retry item. Start it after those are merged.

## Tests
- New `server/__tests__/scripts/sdlc-test-repair-resume.test.js`. `resumecheck` cases run against a temporary git repository (`git init`, local user config) with a red-tests commit: no red-tests commit; missing claim file; empty claim file; claim file with no valid lines; a modified test file; an untracked test file (the message includes the restore command); no implementation change since the red commit; implementation change only under `Docs/` (counts as none); all conditions met (exit 0, no output); several failures at once (every `REJECT:` line is printed).
- Same file, text assertions on `scripts/sdlc.sh`: `FROM` is validated before the first `git` call and before `mkdir`; the unknown-value message exists; the `rm -f "$DOCS/test-issues.md"` line is skipped when `FROM=test-repair`; the Implement loop is skipped when `FROM=test-repair`; the hint text exists; `bash -n scripts/sdlc.sh` passes.
- Same file, one execution test: copy `scripts/sdlc.sh` into a temporary directory laid out as `<tmp>/scripts/sdlc.sh`, run it with `FROM=bogus` and a slug, and assert exit 1, the error message, and that `git status` of the temporary repository is unchanged (nothing created).
- Update `server/__tests__/scripts/sdlc-mod.test.js` if it asserts the list of `FROM` values.

## Docs
- `README.md` (SDLC section): the three `FROM` values and what `FROM=test-repair` checks. Header comment of `scripts/sdlc.sh` and of `scripts/sdlc-mod.sh`.

## Open questions
- none
