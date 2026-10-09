# Test cases: retry-unclaimed-failing-test

Based on `specs-1.md` and `plan-1.md`. Tests run `node scripts/sdlc-testcheck.cjs` on jest-JSON fixtures in a temp dir (no jest re-run is started), and read `scripts/sdlc.sh` as source text.

## Test matrix

### `server/__tests__/scripts/sdlc-testcheck.test.js`

| # | Criterion | Case | Expected |
|---|---|---|---|
| U1 | 1 | `unclaimed`: two files, some failing, one claimed | prints only unclaimed failing keys, exit 0 |
| U2 | 1 | all failures claimed | empty stdout, exit 0 |
| U3 | 1 | claim file missing | all failing keys printed |
| U4 | 1 | all tests pass | empty stdout |
| U5 | 1 | suite failed to run | prints `<file>::<suite failed to run>` |
| U6 | usage | `unclaimed` without arguments | exit 1, usage on stderr |
| M1 | 2 | `merge-retry`, key passes on re-run | `now.json` status `passed`; flaky line `<key> :: first run: failed :: re-run: passed`; stdout `WARNING: flaky test passed on re-run, not rejected: <key>` |
| M2 | 3 | key fails again | stays failing, no WARNING; `precheck` exit 1 with `NOT claimed` message |
| M3 | 3 | key missing from re-run JSON | stays failing, no flaky file; `precheck` rejects |
| M4 | 4 | claimed failing key passes in re-run | unchanged (failed), not in `flaky-tests.md` or stdout; unclaimed sibling is merged |
| M5 | 5 | every unclaimed failure flaky, valid claim | `precheck` exit 1 before merge, exit 0 after |
| M6 | 6 | other entries (passing tests, other files, top-level fields) | deep-equal except the flaky status |
| M7 | 7 | nothing flaky | `flaky-tests.md` not created, `now.json` unchanged |
| M8 | 5 (empty set) | empty retry set | no output, no file, `now.json` unchanged |
| M9 | 3.3 | `<suite failed to run>` passes on re-run | counts as passed, WARNING and line written, `unclaimed` then empty |
| M10 | 3.3 | suite fails to run again | stays in retry set, no flaky file |
| M11 | 5 | re-run file unparseable / not existing | exit 0, no crash, keys stay failing |
| M12 | 3.3 | several re-run files | results are treated together, one WARNING and line per flaky key |
| M13 | 3.3 | existing `flaky-tests.md` | lines are appended, not overwritten |
| M14 | usage | `merge-retry` without arguments | exit 1, usage on stderr |
| R1 | 8 | `retry-plan` name with `(`, `.`, `[` | anchored pattern; `RegExp` matches the name, not near-misses or longer strings |
| R2 | 8 | several names in one file | one line, alternation matches each name only |
| R3 | 10 | keys of two files | one line per distinct file |
| R4 | 10 | `<suite failed to run>` key | empty pattern (whole file) |
| R5 | 10 | suite key plus named keys in the same file | empty pattern for that file; other files keep their pattern |
| R6 | 2 | empty stdin | no output |

### `server/__tests__/scripts/sdlc-gates.test.js` (extended)

| # | Criterion | Case | Expected |
|---|---|---|---|
| G1 | 9 | `retry_unclaimed` function defined | found |
| G2 | 9 | call position | after `jest_json_now "$LOG/now.json"`, before the first `precheck "$LOG/now.json"` |
| G3 | 9 | every `precheck "$LOG/now.json"` line | still contains `MAX_REPAIR_TESTS` |
| G4 | 3.1 | exactly one call of `retry_unclaimed`; the `after.json` run exists separately | one call site |
| G5 | 10 | function body | `npx jest`, ` -t `, `--json --outputFile`, `|| true`, `>/dev/null 2>&1`, `cd server`, `unclaimed`, `merge-retry`, `flaky-tests.md` |
| G6 | 11 | no new env variable / opt-out | no `SDLC_RETRY*=` / `SDLC_FLAKY*=`, no `${VAR:-}` default in the function body |

`bash -n scripts/sdlc.sh` is already covered by the existing gates test.

## Expected Red state
All new `sdlc-testcheck` tests and G1-G6 fail before Implement (the subcommands and the function do not exist yet). Existing tests stay green.

## Review items (not tested)
- Criterion 11: "no new executable" and "no executable bit assertion in tests": reviewer checks `git diff --summary` shows no mode change or new executable file.
- Criterion 12: `flaky-tests.md` is not committed: reviewer confirms `.gitignore` still contains `Docs/backlog/*/logs/` and the Test repair commit uses `git add "$DOCS" "$TEST_DIR"`.
- Criterion 13: usage text, `sdlc.sh` header comment and `README.md` content (WARNING text, line format, git-ignored note): reviewer reads them.
- Actual jest re-run behaviour of `retry_unclaimed` (real `npx jest <file> -t <pattern>` against a flaky test, crash handling, stale `retry-*.json` removal): manual check, since the tests must not start nested jest runs.
- Test names altered by `norm` (for example containing a literal `›`) will not match `-t`; they stay failing and are rejected as today (accepted risk in the plan).
