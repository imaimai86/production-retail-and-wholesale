# retry-unclaimed-failing-test

Type: feature
Priority: P3 (nice to have)
Source: report: "Re-run an unclaimed failing test once before rejecting, to filter flaky tests." (Test repair stage of the SDLC pipeline). Checked against `Docs/backlog/index.md`, `Engineering/bugs.md` and the folders under `Docs/backlog/`: no existing item covers it.

## Problem
Verified by reading `scripts/sdlc.sh` and `scripts/sdlc-testcheck.cjs` (nothing was run):
- The Test repair stage (block `4b Test repair`, `scripts/sdlc.sh:159-200`) runs only when the Implement stage used all its attempts without going green and `$DOCS/test-issues.md` exists. It runs `jest_json_now "$LOG/now.json"` (`scripts/sdlc.sh:166`, defined at `:76`) once, then `$CHECK precheck "$LOG/now.json" "$DOCS/test-issues.md" "$MAX_REPAIR_TESTS" || reject ...` (`:167`).
- `precheck` (`scripts/sdlc-testcheck.cjs:50-60`) adds `REJECT: failing test is NOT claimed as a test defect (source bug, not test repair): <key>` for every failing test that the claim file does not list. `reject()` (`:161`) then restores the tests to `$ORIG_RED_SHA` and exits 1.
- A single flaky test (timing, ordering, a shared mock) that fails once in that one `now.json` run therefore sinks the whole Test repair stage, although the failure is not a source bug and not a claimed test defect.

## Expected behaviour
Before the Test repair stage rejects because of UNCLAIMED failing tests, it re-runs only those tests, once. A test that passes on the re-run is treated as flaky: it is logged and printed as a WARNING and is ignored by `precheck` for this run. A test that fails again is rejected exactly as today. Claimed tests are never re-run by this mechanism.

## Decisions
- Preconditions: this item edits the Test repair block of `scripts/sdlc.sh`, as do the items adding a `FROM=test-repair` resume point and `fix-ship-commit-scope`. Start the pipeline for this item only after those have merged into the branch you start from.
- Exactly one re-run, never more. No new environment variable and no opt-out switch.
- The retry set is the failing keys in `now.json` that are not claimed (same key form as `precheck`: `<file>::<normalised full test name>`). Claimed tests are never re-run. If the retry set is empty, nothing is re-run and behaviour is unchanged.
- Only the retry set is re-run, not the suite. Per test file in the set, run `npx jest <file> -t <anchored, regex-escaped full name>` from `server/` with `--json --outputFile`, the same invocation style as `jest_json_now` (stdout and stderr discarded, `|| true`). Extra tests matched by `-t` are ignored: only the retried keys are looked at in the re-run result. A key of the form `<file>::<suite failed to run>` is re-run by running the whole file without `-t`.
- Merge rule (in `scripts/sdlc-testcheck.cjs`): a retried key that is present and passed in the re-run JSON is flaky; a key that failed again, or is missing from the re-run JSON, is NOT flaky (it stays failing). The merged `now.json` is rewritten in place so that flaky tests are marked passed; this keeps every later check (`precheck`, `namecheck`) unchanged. All other entries in `now.json` stay untouched.
- New `sdlc-testcheck.cjs` subcommands (exit 0 on success; update the usage lines in the header comment and the final `console.error`):
  - `unclaimed <now.json> <test-issues.md>`: print the unclaimed failing keys, one per line (empty output when none).
  - `merge-retry <now.json> <test-issues.md> <flaky-tests.md> <retry.json>...`: apply the merge rule over one or more re-run JSON files, rewrite `now.json`, append one line per flaky test to `flaky-tests.md`, print `WARNING: flaky test passed on re-run, not rejected: <key>` to stdout, and never treat a claimed key as flaky.
- `flaky-tests.md` line format: `<key> :: first run: failed :: re-run: passed`. It is written to `$LOG/flaky-tests.md` and only when at least one test is flaky. It must not be committed: the Test repair commit runs `git add "$DOCS" "$TEST_DIR"` (`scripts/sdlc.sh:195`), so the Plan must check whether `$DOCS/logs` is git-ignored and, if not, keep the file out of the commit.
- In `scripts/sdlc.sh` the retry runs directly after `jest_json_now "$LOG/now.json"` and before `precheck`, in a new function `retry_unclaimed` that builds the retry set with `unclaimed`, runs the per-file jest commands into `$LOG/retry-*.json`, and calls `merge-retry`.
- Not changed: the `MAX_ATTEMPTS` Implement attempts, claim handling and `MAX_REPAIR_TESTS`, `diffcheck`, `namecheck`, `redcheck`, the auditor, the second `jest_json_now "$LOG/after.json"`, and `success_check`. The `after.json` and `success_check` runs are not retried.
- No new executable: helpers are called as `node scripts/sdlc-testcheck.cjs ...`; tests must not assert the executable bit.

## Scope
- In: `scripts/sdlc.sh` (Test repair block, header comment), `scripts/sdlc-testcheck.cjs`, `README.md` SDLC section, new tests.
- Out of scope: the Implement and Review stages, the integration suite (`scripts/sdlc-integration.sh`), anything under `server/` other than the new tests, CI config, re-running claimed tests.

## Tests
- `server/__tests__/scripts/sdlc-testcheck.test.js` (new; call `node scripts/sdlc-testcheck.cjs` with small jest-JSON fixtures written to a temp dir):
  - `unclaimed` prints only failing keys that are not in the claim file, and nothing when all failures are claimed.
  - `merge-retry` marks a retried key that passed on re-run as passed, writes the `flaky-tests.md` line in the format above and prints the WARNING.
  - `merge-retry` leaves a key that failed again, and a key missing from the retry JSON, failing; `precheck` on the merged file still exits 1 with the `NOT claimed` message for it.
  - `merge-retry` never touches a claimed failing test, even if it passes in the retry JSON.
  - `precheck` on a merged file where every unclaimed failure was flaky exits 0 (given valid claims).
  - Test names containing regex characters (`(`, `.`, `[`) produce a correctly escaped `-t` pattern (through the subcommand or helper the Plan chooses).
- `server/__tests__/scripts/sdlc-gates.test.js` (extend, text assertions on `scripts/sdlc.sh` like the existing tests): the retry call sits after `jest_json_now "$LOG/now.json"` and before the `precheck` line, and `MAX_REPAIR_TESTS` is still passed to `precheck`.

## Docs
- Header comment of `scripts/sdlc.sh`: one line on the one-time re-run of unclaimed failures in Test repair and `$LOG/flaky-tests.md`.
- `README.md` SDLC section: the same behaviour, the WARNING text and the file format.
- `server/API.md`, `schema.md`, `AGENTS.md`: none.

## Open questions
- none
