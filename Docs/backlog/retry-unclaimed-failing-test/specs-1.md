# Spec: retry-unclaimed-failing-test

One-time re-run of UNCLAIMED failing tests in the Test repair stage, so a single flaky test no longer sinks the stage. Source of truth: `brief.md` (no `decisions.md` exists; the brief lists no open questions).

## 1. Scope
- In: `scripts/sdlc.sh` (Test repair block, header comment), `scripts/sdlc-testcheck.cjs`, `README.md` SDLC section, new tests.
- Out: Implement and Review stages, `scripts/sdlc-integration.sh`, anything under `server/` other than the new tests, CI config, re-running claimed tests.
- Unchanged: `MAX_ATTEMPTS`, claim handling, `MAX_REPAIR_TESTS`, `diffcheck`, `namecheck`, `redcheck`, the auditor, the second `jest_json_now "$LOG/after.json"` and `success_check` (these are never retried).

## 2. Terminology
- **Key**: `<file>::<normalised full test name>`, the same form `precheck` uses (`results()` and `claims()` in `sdlc-testcheck.cjs`). A suite that failed to run has the key `<file>::<suite failed to run>`.
- **Claimed key**: a key listed in `$DOCS/test-issues.md` (as returned by the `claimed` subcommand).
- **Unclaimed failing key**: a key that failed in `now.json` and is not claimed.
- **Retry set**: the unclaimed failing keys of `now.json`.
- **Flaky**: a retried key that is present and passed in the re-run JSON.

## 3. Behaviour

### 3.1 Flow in the Test repair stage (`scripts/sdlc.sh`)
1. The stage runs `jest_json_now "$LOG/now.json"` as today.
2. Directly after it, and before every `precheck` call on `now.json` (including the early `FROM=test-repair` precheck), a new function `retry_unclaimed` runs.
3. `retry_unclaimed`:
   1. Builds the retry set with `node scripts/sdlc-testcheck.cjs unclaimed "$LOG/now.json" "$DOCS/test-issues.md"`.
   2. If the retry set is empty: re-runs nothing, writes no `retry-*.json` and no `flaky-tests.md`, prints nothing extra. Behaviour is identical to today.
   3. Otherwise, for each distinct test file in the retry set, runs jest once from `server/` with `--json --outputFile="$ROOT/$LOG/retry-<n>.json"`, in the same style as `jest_json_now` (stdout and stderr discarded, `|| true`):
      - For keys whose test name is a real test name: `npx jest <file> -t <pattern>`. `<pattern>` is an anchored (`^...$`), regex-escaped form of the full normalised test name. When one file has several retried tests, one jest run per file is used and the pattern combines them as an alternation of the anchored, escaped names.
      - For a `<file>::<suite failed to run>` key: `npx jest <file>` with no `-t` (the whole file).
      - If a file has both a `<suite failed to run>` key and named keys, the whole file is run without `-t`.
   4. Calls `node scripts/sdlc-testcheck.cjs merge-retry "$LOG/now.json" "$DOCS/test-issues.md" "$LOG/flaky-tests.md" "$LOG"/retry-*.json` (all re-run JSON files of this call).
4. Then `precheck` (and the rest of the stage) runs unchanged on the merged `now.json`, with `MAX_REPAIR_TESTS` still passed.
5. Exactly one re-run per unclaimed failing test per `retry_unclaimed` call. No loop, no second retry, no new environment variable, no opt-out switch.

### 3.2 `unclaimed <now.json> <test-issues.md>`
- Prints each unclaimed failing key on its own line to stdout. Empty output when there are none. Exit 0.
- Claimed failing keys and passing keys are never printed.
- Claim lookup uses the same parsing as `claims()` (so a missing or empty `test-issues.md` means nothing is claimed).

### 3.3 `merge-retry <now.json> <test-issues.md> <flaky-tests.md> <retry.json>...`
- Computes the retry set from `now.json` and `test-issues.md` (same definition as `unclaimed`), and reads all given re-run JSON files, treating their results together.
- Merge rule per retried key:
  - present in a re-run JSON and passed: **flaky**.
  - failed again, or missing from every re-run JSON: **not flaky**, stays failing.
- A claimed key is never flaky, never modified, even if it passed in a re-run JSON.
- Rewrites `now.json` in place so that each flaky test is marked passed (the test's `assertionResults` status becomes `passed`; for a flaky `<suite failed to run>` key the file's result is made to count as passed, so `results()` no longer reports it failing). All other entries stay untouched, so `precheck` and `namecheck` need no change.
- For each flaky key: appends one line to `flaky-tests.md` and prints to stdout `WARNING: flaky test passed on re-run, not rejected: <key>`.
- `flaky-tests.md` line format: `<key> :: first run: failed :: re-run: passed`. The file is created only when at least one test is flaky (nothing is created or modified otherwise).
- Exit 0 on success, including when nothing is flaky.

### 3.4 `flaky-tests.md`
- Written to `$LOG/flaky-tests.md` (inside `Docs/backlog/<slug>/logs/`).
- It must not be committed. `.gitignore` already contains `Docs/backlog/*/logs/`, so the Test repair commit (`git add "$DOCS" "$TEST_DIR"`) does not pick it up; the Plan must confirm this and add no extra handling if it still holds.

### 3.5 Usage text
- Update the usage lines in the header comment of `sdlc-testcheck.cjs` and the final `console.error` usage message to list `unclaimed` and `merge-retry`.

### 3.6 Docs
- `scripts/sdlc.sh` header comment: one line on the one-time re-run of unclaimed failures in Test repair and `$LOG/flaky-tests.md`.
- `README.md` SDLC section: the same behaviour, the WARNING text and the `flaky-tests.md` line format.
- `server/API.md`, `schema.md`, `AGENTS.md`: no change.

## 4. Inputs / outputs
| Item | Input | Output |
|---|---|---|
| `unclaimed` | jest JSON, claim file | stdout: unclaimed failing keys, one per line; exit 0 |
| `merge-retry` | jest JSON, claim file, flaky file path, one or more re-run JSON files | `now.json` rewritten; `flaky-tests.md` appended; stdout WARNING per flaky key; exit 0 |
| `retry_unclaimed` | `$LOG/now.json`, `$DOCS/test-issues.md` | `$LOG/retry-*.json`, merged `$LOG/now.json`, optional `$LOG/flaky-tests.md` |

## 5. Error cases
- A retried key that fails again: stays failing; `precheck` rejects it with `failing test is NOT claimed as a test defect (source bug, not test repair): <key>` exactly as today, and `reject()` restores the tests.
- A retried key missing from the re-run JSON (for example a jest crash or an unreadable/missing re-run output file): stays failing, same rejection.
- Re-run JSON file that cannot be read or parsed: treated as containing no results (keys stay failing); `merge-retry` does not crash on it.
- Claimed key present in the re-run JSON as passed: ignored.
- Empty retry set: no jest run, no file written, no output.
- Invalid usage (missing arguments): usage message on stderr, exit 1, as the other subcommands.
- `now.json` unreadable: not a new case (the script already fails on it).

## 6. Acceptance criteria
1. `unclaimed` prints only failing keys that are not in the claim file, and nothing when all failures are claimed.
2. `merge-retry` marks a retried key that passed on re-run as passed in `now.json`, appends `<key> :: first run: failed :: re-run: passed` to `flaky-tests.md`, and prints `WARNING: flaky test passed on re-run, not rejected: <key>`.
3. `merge-retry` leaves a key that failed again, and a key missing from the re-run JSON, failing; `precheck` on the merged file exits 1 with the `NOT claimed` message for it.
4. `merge-retry` never changes a claimed failing test, even if it passes in the re-run JSON, and never lists it in `flaky-tests.md`.
5. `precheck` on a merged file where every unclaimed failure was flaky exits 0 (given valid claims).
6. All other entries of `now.json` are unchanged after `merge-retry`.
7. `flaky-tests.md` is not created when no test is flaky.
8. Test names containing regex characters (`(`, `.`, `[`) yield a correctly escaped, anchored `-t` pattern (through the subcommand or helper chosen by the Plan).
9. `sdlc.sh` text checks: the `retry_unclaimed` call sits after `jest_json_now "$LOG/now.json"` and before the first `precheck` line; `MAX_REPAIR_TESTS` is still passed to `precheck`.
10. Only the retry set is re-run (not the whole suite), once, with `npx jest <file> -t ...` from `server/`, `--json --outputFile`, stdout/stderr discarded, `|| true`; `<suite failed to run>` keys run the whole file without `-t`.
11. No new env variable, no opt-out switch, no new executable; tests do not assert an executable bit.
12. `flaky-tests.md` is not part of the Test repair commit (git-ignored under `Docs/backlog/*/logs/`).
13. Usage text, `sdlc.sh` header comment and `README.md` are updated as in 3.5 and 3.6.

## 7. Tests (as listed in the brief)
- New `server/__tests__/scripts/sdlc-testcheck.test.js`: runs `node scripts/sdlc-testcheck.cjs` against small jest-JSON fixtures in a temp dir, covering criteria 1-6 and 8.
- Extend `server/__tests__/scripts/sdlc-gates.test.js` with text assertions on `scripts/sdlc.sh` for criterion 9.
