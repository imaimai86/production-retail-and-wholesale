# Spec: add-test-repair-resume

Add `FROM=test-repair` as a resume point of the SDLC pipeline. It continues at Test repair when a run stopped there, after checking every precondition up front. It also makes `FROM` validation complete and adds hints. Binding inputs: `brief.md` and `decisions.md` (Round 1: Q1 and Q2 accepted).

## 1. Scope

In scope: `scripts/sdlc.sh` (`FROM` validation, resume path, hints, header comment), `scripts/sdlc-testcheck.cjs` (new `resumecheck` command), `scripts/sdlc-mod.sh` (header comment, pass-through), `README.md` (SDLC section).

Out of scope: the Test repair checks and agent prompts, `MAX_REPAIR_TESTS`, the auditor, the commit made after an accepted repair, the Implement loop, the Review and Ship stages, the control pane plugin buttons, `fix-ship-commit-scope`.

## 2. `FROM` values and validation

- Accepted values: `spec` (default), `plan`, `red-tests`, `implement`, `test-repair`, `review`. The existing values `plan`, `red-tests`, `implement` and `review` keep their current behaviour (Q1).
- Any other value (including an empty-looking typo such as `Implement` or `test_repair`; matching is case-sensitive) exits with code 1 and prints exactly: `ERROR: unknown FROM=<value> (use spec, plan, red-tests, implement, review or test-repair)`.
- This check sits at the top of `scripts/sdlc.sh`, before the branch checkout, before any `git` call, and before any directory or file creation (no `mkdir`, no `status.json` content that depends on the slug being created). A rejected `FROM` leaves the repository and working tree exactly as they were.
- Stage ordering: `test-repair` sits between `implement` and `review`; the numeric stage ordering used for the `FROM` comparisons is adjusted so `spec < plan < red-tests < implement < test-repair < review`. Every existing comparison keeps its meaning (for example `FROM=plan` and `FROM=red-tests` still refuse once the red-tests commit exists; `FROM=review` still resumes from the latest locked tests, which is the repair commit if one exists).
- The `FROM=plan|red-tests` refusal message, which suggests `FROM=implement or FROM=review`, may also mention `FROM=test-repair`.

## 3. `FROM=test-repair` behaviour

Invocation: `FROM=test-repair ./scripts/sdlc.sh <slug>` (also through `scripts/sdlc-mod.sh`, which passes `FROM` through unchanged).

Sequence:
1. `FROM` is validated (section 2). The usual start-up work then happens as for other resumes (slug resolution, `brief.md` presence, `logs/` directory, `status.json`, baseline handling as for any `FROM` other than `spec`).
2. Spec, Plan, Red tests and Implement are skipped: no agent runs for them, and the Implement loop does not execute.
3. The red-tests commit is looked up with `git log --grep="^test(<slug>): add failing tests"` only (latest match). It is NOT the later `repair invalid tests` commit (Q2). If none exists, this is reported as precondition 1 below.
4. All preconditions (section 4) are evaluated before any agent call, and all failures are reported together. If any fails: exit 1, no agent called, no file changed other than the run's own `status.json` / log files, and no git change (tests are not restored automatically).
5. `$LOG/red.json` is regenerated from the red-tests commit exactly as `FROM=implement` does (`jest_json_at "$RED_SHA" ...`).
6. `rm -f "$DOCS/test-issues.md"` is NOT executed.
7. `status.json` shows stage `Test repair` from the start of the run (the stage label of the existing Test repair block, `4b Test repair ...`).
8. Control jumps into the existing Test repair block, which runs unchanged: pre-check, repair agent, source-hash guard, diffcheck, namecheck, redcheck, auditor, `success_check`, then the commit `test(<slug>): repair invalid tests ...`. Afterwards the run continues to Review and Ship as today, with `RED_SHA` set to the repair commit.
9. The Test repair block runs only if the claim file exists; `FROM=test-repair` must never reach the "GREEN GATE FAILED ... no test defect was claimed" path, because precondition 2 already guarantees the claim file.

Note: the green gate is not re-run before the Test repair block (the run is resuming after Implement failed); the pre-check (precondition 5) is what confirms the claimed tests currently fail.

## 4. Preconditions

All are checked before any agent runs and reported together: one `REJECT:` line per failure, in the style of `sdlc-testcheck.cjs` (`REJECT: <message>` on stderr), exit 1 if any fails. Checks 1-4 plus the Q2 check are implemented in `resumecheck`; check 5 stays in `scripts/sdlc.sh`.

1. **Red-tests commit exists.** A commit whose subject matches `^test(<slug>): add failing tests` exists. If not, only this reject is raised for the commit-dependent checks (checks 3 and 4 and the already-repaired check cannot be evaluated without a SHA and are skipped), while check 2 (claim file) is still evaluated and reported.
2. **Claim file is usable.** `$DOCS/test-issues.md` exists, is non-empty, and `node scripts/sdlc-testcheck.cjs claimed` prints at least one claim key for it (i.e. it has at least one valid claim line). Separate rejects for: missing, empty, no valid claim lines.
3. **Tests unchanged since the red-tests commit.** `git diff --name-only <RED_SHA> -- server/__tests__` is empty and there are no untracked files under `server/__tests__` (ignored files excluded, as elsewhere in the pipeline). On failure the reject lists the offending paths and prints the exact restore command, which is not run: `git checkout <RED_SHA> -- server/__tests__ && git clean -fd server/__tests__`.
4. **Implementation present.** At least one changed path since `<RED_SHA>` (commits since that commit and uncommitted working-tree changes, including untracked non-ignored files) lies outside `server/__tests__/` and `Docs/`. Changes only under `Docs/` or the test directory count as none.
5. **Claims would pass the pre-check.** In `scripts/sdlc.sh`, after checks 1-4 pass (this check runs jest, so it runs only when 1-4 passed): `jest_json_now "$LOG/now.json"` then `node scripts/sdlc-testcheck.cjs precheck "$LOG/now.json" "$DOCS/test-issues.md" "$MAX_REPAIR_TESTS"`, exactly as the Test repair block does. On failure it prints `REJECT: claims would not pass the pre-check` followed by the pre-check's own reasons, and exits 1 before any agent runs. Because the pre-check inside the Test repair block repeats the same command, the result is the same; the up-front run exists only to fail early.
6. **Repair not already accepted (Q2).** If a commit matching `^test(<slug>): repair invalid tests` exists after the red-tests commit, `FROM=test-repair` fails with `ERROR: test repair was already accepted in commit <sha>: use FROM=review`. This runs before any agent call and before any file change. It is raised through the same report as one more `REJECT:` line (`REJECT: test repair was already accepted in commit <sha>: use FROM=review`), and because the tests then legitimately differ from the red-tests commit, check 3's reject is still printed alongside it when it applies. Exit 1.

Order of output: rejects are printed in the order commit, claim file, repair-already-accepted, tests unchanged, implementation present, then (separately, from `sdlc.sh`) the pre-check. When checks 1-4 or 6 fail, check 5 is not run.

## 5. `resumecheck` command

`node scripts/sdlc-testcheck.cjs resumecheck <red_sha> <test-issues.md> <slug>`

- Inputs: the red-tests SHA (may be empty or the literal empty string when no commit was found, in which case check 1 rejects), the path to the claim file, the slug.
- Output: exit 0 and no output when every condition passes. Otherwise exit 1 with one `REJECT:` line per failed condition on stderr (via the existing `fail` helper).
- It only reads (git and files); it never changes the repository or the test directory.
- Missing arguments: usage error and non-zero exit, like the other commands.
- The test directory used is `server/__tests__`; the working directory is the repository to inspect.

## 6. Hint on failure

When the Test repair block exits for a non-verdict reason, print on its own line:
`Resume at Test repair once fixed: FROM=test-repair ./scripts/sdlc.sh <slug>`
- Non-verdict reasons: the repair agent failed to run, the auditor failed to run (`auditor failed to run`), and `claims fail pre-check`.
- The hint is printed only if `resumecheck` checks 1-4 (and the Q2 check) currently pass, evaluated at the time of the failure (after the block has restored or not restored the tests). Note: since the existing `reject` restores the tests to `ORIG_RED_SHA` before exiting, the tests-unchanged check is evaluated after that restore.
- Verdict rejections print NO hint: the diff check, name check or red check failing, an auditor `VERDICT: INVALID` (or no verdict line), source files modified during repair, `NO REPAIR NEEDED`, and tests still failing after a repair.
- The hint does not change the exit code (still 1) or the text of the existing `TEST REPAIR REJECTED:` line.

## 7. `FROM=implement` change

Unchanged except for one extra line printed before `rm -f "$DOCS/test-issues.md"` runs, only when the claim file exists:
`WARNING: test-issues.md exists and will be deleted; use FROM=test-repair to resume at Test repair`
The file is still deleted. No warning when the file does not exist. The same applies to other `FROM` values that enter the Implement loop (`spec`, `plan`, `red-tests`) only through the shared line; the warning text is identical.

## 8. `scripts/sdlc-mod.sh`

- `FROM=test-repair` is passed through to `sdlc.sh` like `FROM=implement` (no new validation in the wrapper beyond what exists).
- The header comment (line 19 area) lists `spec|plan|red-tests|implement|test-repair|review`.

## 9. Documentation

- `scripts/sdlc.sh` header comment: lists the six `FROM` values and explains `test-repair` (skips Implement, keeps the claim file, checks preconditions first).
- `README.md` SDLC section: the six `FROM` values and what `FROM=test-repair` checks (the preconditions above) and when to use it.

## 10. Error cases (summary)

| Situation | Result |
|---|---|
| Unknown `FROM` | exit 1, `ERROR: unknown FROM=<value> (use spec, plan, red-tests, implement, review or test-repair)`, nothing changed |
| `FROM=test-repair`, any of preconditions 1-6 fail | exit 1, one `REJECT:` line each, no agent called, nothing changed |
| Pre-check fails (precondition 5) | exit 1, `REJECT: claims would not pass the pre-check` plus reasons, no agent called |
| Test repair already accepted | exit 1, message points to `FROM=review` |
| Tests were edited since the red commit | exit 1, restore command printed but not run |
| Block fails for a non-verdict reason and 1-4 pass | exit 1 plus resume hint |
| Block fails with a verdict rejection | exit 1, no hint |

## 11. Acceptance criteria

AC1. `FROM=bogus` (any unlisted value) exits 1 with the exact error message, and neither `git status` of the repository nor the file system changes (no `Docs/backlog/<slug>/logs`, no branch, no checkout). The check precedes the first `git` call and the first `mkdir` in `sdlc.sh`.
AC2. `spec`, `plan`, `red-tests`, `implement` and `review` still validate and behave as before; `test-repair` is accepted.
AC3. `resumecheck` exits 0 with no output when: a red-tests commit exists, the claim file is non-empty with at least one valid claim, `server/__tests__` is unchanged and has no untracked files, and there is an implementation change outside `server/__tests__/` and `Docs/` since the red commit.
AC4. `resumecheck` rejects, with a `REJECT:` line each: no red-tests commit; missing claim file; empty claim file; claim file without valid lines; a modified test file; an untracked test file (message includes the exact restore command); no implementation change since the red commit; implementation changes only under `Docs/`.
AC5. With several failures at once, every corresponding `REJECT:` line is printed (not just the first), and the exit code is 1.
AC6. A repair commit after the red-tests commit causes a reject naming it and pointing to `FROM=review`.
AC7. `FROM=test-repair` with failing preconditions calls no agent and changes nothing in git or in the test directory.
AC8. With all preconditions met, `FROM=test-repair` does not delete `test-issues.md`, does not run the Implement loop or agents, sets the status stage to `Test repair`, regenerates `$LOG/red.json`, runs the existing Test repair block unchanged and then proceeds to Review and Ship after an accepted repair.
AC9. The hint appears only for non-verdict failures with checks 1-4 passing, never for verdict rejections.
AC10. `FROM=implement` prints the WARNING line when the claim file exists and still deletes it.
AC11. `bash -n scripts/sdlc.sh` passes; `sdlc-mod.sh` passes `FROM=test-repair` through; the header comments and `README.md` are updated.
AC12. Tests: new `server/__tests__/scripts/sdlc-test-repair-resume.test.js` (resumecheck cases on a temporary git repo; text assertions on `scripts/sdlc.sh` for validation order, the unknown-value message, the skipped `rm -f`, the skipped Implement loop and the hint text; one execution test with `FROM=bogus` in a temporary copy laid out as `<tmp>/scripts/sdlc.sh`); `server/__tests__/scripts/sdlc-mod.test.js` updated if it asserts the list of `FROM` values.
