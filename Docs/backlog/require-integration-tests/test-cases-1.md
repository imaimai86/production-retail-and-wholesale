# Test cases: require-integration-tests

Covers `specs-1.md` and `plan-1.md`. All tests run the code under test (the gate script via `spawnSync` in throwaway git repos, `scripts/sdlc-integration.sh` with shims, `bash -n`). No test reads a test file.

## DB and API changes

- none

(No `server/` DB or API behaviour changes, so no integration tests are required for this item.)

## 1. Gate script, `plan` (`server/__tests__/scripts/sdlc-integration-gate.test.js`)

| ID | AC | Case | Expected |
|---|---|---|---|
| P1 | AC1 | Section is `- none` | exit 0, no `REJECT` |
| P2 | AC1 | `- none` with blank lines around it | exit 0 |
| P3 | AC2 | No section | exit 1, `Plan has no '## DB and API changes' section` |
| P4 | AC2 | Near-miss heading `## DB and API change` | exit 1 |
| P5 | AC3 | For each of API, migration, table, column, model: token in a modified integration file | exit 0 |
| P6 | AC3 | Same, token in a new staged integration file | exit 0 |
| P7 | AC3 | Same, token absent | exit 1, `REJECT:` naming the token |
| P8 | AC4 | Same, token only in a unit test file | exit 1 |
| P9 | AC4 | Same, token only in an unmodified (committed) integration file | exit 1 |
| P10 | AC4 | Same, token only in an untracked integration file | exit 1 |
| P11 | AC3 | Several bullets, some missing | exit 1, every missing bullet listed, present ones not |
| P12 | AC3 | Several bullets, all present | exit 0 |
| P13 | AC4 | Bullet in a later `## ` section | not required (section ends at next heading) |
| P14 | AC5 | Malformed bullets (free text, no backticks, lower-case method, `.sql`/`.js` suffix, column without dot, `*` bullet, prose) | exit 1, `REJECT:` |
| P15 | AC5 | Malformed line is named in the output | stderr contains the line |
| P16 | AC5 | Empty section; heading at end of file with no bullets | exit 1 |
| P17 | AC5 | `- none` plus another bullet (either order) | exit 1 |
| P18 | 3.3 | Section at end of file, no following heading | parsed, exit 0 |
| P19 | 5 | Unknown subcommand, no subcommand, missing arguments for `plan` / `diff` | exit 1, usage on stderr |

## 2. Gate script, `diff` (same file)

| ID | AC | Case | Expected |
|---|---|---|---|
| D1 | AC6 | Real change in each of the six source paths, original red commit has no integration tests | exit 1, `REJECT:` lists the file, says to rerun from Plan |
| D2 | AC6 | Same, original red commit has integration tests | exit 0 |
| D3 | AC6 | Removed line in a source file | counts as a change |
| D4 | AC6 | No change at all | exit 0 |
| D5 | AC7 | Added comment lines (`//`, `*`, `/*`, `--`, indented) | exit 0 without integration tests |
| D6 | AC7 | Removed comment line | exit 0 |
| D7 | AC7 | Whitespace-only and blank-line-only edits | exit 0 |
| D8 | AC7 | Comment plus a real line | exit 1 |
| D9 | AC7 | Comment-only file plus real change in another file | exit 1, only the real file listed |
| D10 | AC8 | Docs, `server/test-utils/`, `server/scripts/`, root and server `package.json`, unit test file | exit 0 |
| D11 | AC9 | Repair commit after red commit; integration tests only in original red commit | exit 0 with `<orig_red_sha>` = red commit |
| D12 | AC9 | Same, `<orig_red_sha>` = repair commit | exit 1 (proves the original is used) |
| D13 | AC9 | Original red commit has none, repair commit has them | exit 1 |
| D14 | AC9 | Source change committed before the locked commit | not counted, exit 0 |
| D15 | AC10 | New untracked file under `server/migrations/` only | exit 0 (documented limitation) |
| D16 | 5.3 | Same file once staged | exit 1 |

## 3. Wiring (`sdlc-integration-gate-wiring.test.js`, reads `scripts/sdlc.sh` only)

| ID | AC | Case |
|---|---|---|
| W1 | AC11 | Plan prompt names `## DB and API changes` and the six forms |
| W2 | AC11 | Red tests prompt names the section, `server/__tests__/integration/`, `api.integration.test.js`, `scratchDb`, `supertest`; existing rules stay |
| W3 | AC12 | Order: `git add "$DOCS" "$TEST_DIR"` < gate `plan` call < `scripts/sdlc-integration.sh` < integration `RED GATE FAILED` < red commit |
| W4 | AC12 | Unit-only `RED GATE FAILED` line stays and comes first |
| W5 | AC13 | Exact exit 0 and exit 3 messages; output goes to `$LOG/integration.log`; exit code captured with `|| rc=$?` |
| W6 | AC14 | `diff "$RED_SHA" "$INT_RED_SHA"` in the Implement loop and in Review, each before `success_check` and each followed by `|| exit 1` |
| W7 | AC14 | `INT_RED_SHA` found with `git log --grep="^test($SLUG): add failing tests"` |
| W8 | AC15 | CI skip condition `-n "${CI:-}"` and `"${SDLC_INTEGRATION_CI:-}" != "run"` in the Red tests stage |
| W9 | 6 | No `success_check` in the Red tests stage; no `SDLC_INTEGRATION=` opt-out |
| W10 | AC16 | `bash -n scripts/sdlc.sh` passes |

## 4. Integration script (`sdlc-integration.test.js`, updated)

| ID | AC | Case | Expected |
|---|---|---|---|
| I4 | AC17 | Test 4: no `test:integration` script | exit 3 |
| I6d | AC17, R1 | Test 6d: container never ready (60 `docker exec`, container removed) | exit 3 |
| I7 | AC17 | Test 7: no `DATABASE_URL`, no docker | exit 3 |
| I6b/c | AC17 | Tests 6b, 6c unchanged: npm failure propagates 1 / other codes | exit 1 / 7 |

## 5. Documentation (`sdlc-integration-gate-docs.test.js`, reads docs only)

| ID | AC | Case |
|---|---|---|
| X1 | AC18 | `AGENTS.md`, `CLAUDE.md` require integration tests in `server/__tests__/integration/` for DB or API changes |
| X2 | AC18 | `plan.md`, `red-tests.md` describe the section; `red-tests.md` the integration directory; `tdd-loop.md` the diff gate |
| X3 | AC18 | `README.md`: section format, exit code 3, CI skip, untracked limitation, no opt-out |

## 6. Review items (not tested)

- R1: container-not-ready exit 3 is covered by I6d with shims, no real container needed.
- R2: "could not determine database container port" stays `exit 1`; reviewer confirms whether it should be 3.
- R3: the wiring and docs tests read `scripts/sdlc.sh` and documentation only, never a test file. The rule that tests must not read test files is a review item, not a test.
- R4: the `NONE` stdout marker of `plan` (plan-1 Step 5) is a wiring detail; it is exercised only through W3/W5, not asserted as a gate contract.
- R5: end-to-end Red gate verdict table (spec 4.3) needs a live pipeline run; not unit-testable without running agents. Review the shell block against the table by hand.
