# Specification: require-integration-tests

Source: `brief.md` and the binding answers in `decisions.md` (Rounds 1 to 4). Stage names are used throughout: Spec, Plan, Red tests, Implement, Test repair, Review, Ship.

## 1. Purpose

A pipeline run that adds or changes a database or API behaviour cannot reach Ship unless the Red tests stage produced integration tests for it, and those tests failed before the implementation existed. There is no opt-out switch for local runs.

## 2. Components

| Component | Change |
|---|---|
| `scripts/sdlc.sh` | Plan prompt, Red tests prompt, Red gate (plan check plus integration red check), two diff-gate calls (after each Implement attempt, after Review) |
| `scripts/sdlc-integration-gate.cjs` | New. Subcommands `plan` and `diff` |
| `scripts/sdlc-integration.sh` | Exit 3 for infrastructure errors |
| `.claude/commands/plan.md`, `red-tests.md`, `tdd-loop.md` | Describe the new section, tests and gates |
| `AGENTS.md`, `CLAUDE.md` | Development guidelines: every DB or API change needs integration tests in `server/__tests__/integration/` |
| `README.md` | "Running integration tests": section format and gates |
| `server/__tests__/scripts/` | Two new test files; tests 4 and 7 of `sdlc-integration.test.js` updated |

Out of scope: backfilling integration tests for existing endpoints that have none (users, categories, products, batches, `GET /inventory`, invoice), CI changes, the Test repair stage, the guard plugin, unit-test rules.

## 3. The `## DB and API changes` section (Plan output)

### 3.1 Plan prompt
The Plan prompt in `scripts/sdlc.sh` requires `plan-1.md` to contain a section headed exactly `## DB and API changes`. Its bullets are exactly one of the following forms (one bullet per change, `<...>` filled in):

| Bullet | Token to be tested |
|---|---|
| ``- API: `<METHOD> <path>` `` | `<METHOD> <path>`, e.g. `POST /sales/:id/refund` |
| ``- DB: migration `<file name without .sql>` `` | e.g. `003_add_refunds` |
| ``- DB: table `<name>` `` | e.g. `refunds` |
| ``- DB: column `<table.column>` `` | e.g. `refunds.reason` |
| ``- DB: model `<file name without .js>` `` | e.g. `sales` |
| `- none` (the single bullet of the section) | no token; the plan changes no DB or API behaviour |

The token of a bullet is the text between the backticks.

### 3.2 Where it is checked
Only at the Red tests stage (decision, Round 2 Q2). There is no check right after the Plan agent finishes. A bad plan therefore costs one Red tests agent run before the gate rejects it. A `FROM=red-tests` resume is covered because the check lives in the Red tests stage.

### 3.3 Parsing rules (derived from "exactly")
- The section starts at the line `## DB and API changes` and ends at the next `## ` heading or end of file.
- Missing section: `REJECT: Plan has no '## DB and API changes' section`, exit 1.
- Any bullet not matching one of the six forms, an empty section, or `- none` together with other bullets: a `REJECT:` line naming the offending line, exit 1.
- Blank lines in the section are ignored.

## 4. Red tests stage

### 4.1 Red tests prompt
For every bullet other than `- none` the prompt requires:
- integration tests in `server/__tests__/integration/`, following `api.integration.test.js` (helper `server/test-utils/scratchDb.js`, `supertest` on `require('../../index')`);
- the bullet's token written in a `describe` or `test` title;
- a matching section in `test-cases-1.md`.

The prompt also names the section `## DB and API changes`. The existing prompt rules stay unchanged.

### 4.2 Ordering of checks in the Red tests stage
1. The Red tests agent runs.
2. **Staging.** Before the `plan` check, `scripts/sdlc.sh` stages `$DOCS` and `$TEST_DIR` (`git add`). This puts brand-new integration test files in the index so that `git diff HEAD` reports them. This is the point in the flow at which the files are tracked (decision, Round 2 Q1: only changes git reports against the comparison commit count; untracked files do not).
3. `node scripts/sdlc-integration-gate.cjs plan "$DOCS/plan-1.md" "$TEST_DIR"`. A reject stops the run with exit 1 (no commit).
4. Unit run (`tests_pass`, i.e. `npm test`).
5. If the section is not `- none`: the integration red check `bash scripts/sdlc-integration.sh` always runs (decision, Round 3 Q1), whatever the unit result.
6. Red gate verdict (see 4.3).
7. Commit `test(<slug>): add failing tests and spec/plan docs` (unchanged), set `RED_SHA`.

### 4.3 Red gate verdict
| Section | `npm test` | Integration exit | Result |
|---|---|---|---|
| `- none` | passes | not run | `RED GATE FAILED: new tests pass before implementation. See $LOG/tests.log`, exit 1 (unchanged) |
| `- none` | fails | not run | red gate passes |
| not `- none` | any | 0 | `RED GATE FAILED: new integration tests pass before implementation. See $LOG/integration.log`, exit 1 |
| not `- none` | passes | 1 | red gate passes (integration tests failing is the expected red result) |
| not `- none` | fails | 1 | red gate passes |
| not `- none` | fails | 0 | `RED GATE FAILED: new integration tests pass before implementation. See $LOG/integration.log`, exit 1 |
| not `- none` | any | 3 | `ERROR: no database for the integration red check (set DATABASE_URL or start Docker)`, exit 1 |

The red gate passes if either `npm test` fails or the integration red check exits 1; with a non-`- none` section an integration exit of 0 always fails the gate, because the integration tests must fail regardless of the unit result. The integration output is written to `$LOG/integration.log`.

### 4.4 CI skip
When `CI` is non-empty and `SDLC_INTEGRATION_CI` is not `run`, the integration red check is skipped with a warning (the existing skip in `scripts/sdlc-integration.sh` exits 0 with its `WARNING: TEMPORARY` line; the red gate must treat this as a skip, not as `RED GATE FAILED`). In that case the unit-run verdict applies as for 4.3 with the integration result treated as absent: the gate passes only if `npm test` fails. The `plan` check still runs in CI.

## 5. `scripts/sdlc-integration-gate.cjs`

Style: same as `scripts/sdlc-testcheck.cjs`. Exit 0 = pass, exit 1 = reject with one or more `REJECT: ...` lines on stderr. Unknown subcommand or missing arguments: usage on stderr, exit 1.

### 5.1 `plan <plan-1.md> <test-dir>`
- Parse the section (3.3). Any parse failure rejects.
- Section `- none`: pass, exit 0, no further check.
- Otherwise, for every bullet, its token must appear as text in at least one file that is new or modified under `<test-dir>/integration/`. "New or modified" means differing from `HEAD` as git reports it (`git diff HEAD`, which includes staged new files); untracked files do not count, and neither do unmodified files.
- Each bullet whose token appears in none of those files gives a `REJECT:` line naming the bullet and its token. All missing bullets are listed in one run.
- A change only to unit tests (outside `<test-dir>/integration/`) satisfies nothing.

### 5.2 `diff <red_sha> <orig_red_sha>`
1. **Source paths:** `server/migrations/`, `server/schema.sql`, `server/models/`, `server/index.js`, `server/middleware/`, `server/validation.js`. Docs, `server/test-utils/`, `server/scripts/`, package files and everything else are not source changes.
2. **Source change:** a file under the source paths that changed since `<red_sha>`, as reported by `git diff -U0 -w --ignore-blank-lines <red_sha>` (tracked changes only; untracked files are not seen). From the diff, drop changed lines that start with `//`, `*`, `/*` or `--` (after leading whitespace is ignored by `-w`). If any changed line remains, a source change exists. Comment-only, whitespace-only and blank-line-only edits are ignored.
3. If no source change exists: exit 0.
4. If a source change exists: `git diff --name-only <orig_red_sha>~1 <orig_red_sha> -- server/__tests__/integration/` must be non-empty. If empty: exit 1 with `REJECT:` lines listing the source files that changed and saying to rerun from Plan.
5. `<orig_red_sha>` is the original red-tests commit, which keeps the gate correct after a Test repair commit (decision, Round 1 Q1). `<red_sha>` is the current locked tests commit (the red-tests commit, or the repair commit after it).

### 5.3 Limitation (accepted decision, Round 2 Q1)
The diff gate sees only changes git reports against `<red_sha>`. A new, still untracked file under the source paths (for example a brand-new `server/migrations/003_add_refunds.sql` that has not been staged or committed) is not seen, so by itself it does not trigger the integration-test requirement. This is accepted; the gate is not extended to untracked files and no `git add` is added for the source paths. It must be documented in `README.md`.

## 6. Diff gate in `scripts/sdlc.sh`

- Runs after each Implement attempt, next to the existing test-modified guard (the `git diff --name-only "$RED_SHA" -- "$TEST_DIR"` check), and after Review.
- Call: `node scripts/sdlc-integration-gate.cjs diff "$RED_SHA" "$ORIG_RED_SHA"`. A reject stops the run with exit 1 (the gate's `REJECT:` output is shown).
- **`ORIG_RED_SHA` on resume (decision, Round 1 Q1):** on every resume (`FROM=implement`, `FROM=test-repair`, `FROM=review`) the original red-tests commit, found with `git log --grep="^test($SLUG): add failing tests"`, is used as `<orig_red_sha>` for the integration-test check only. The existing `RED_SHA` and `ORIG_RED_SHA` handling for the other guards stays unchanged. On a fresh run it is the red-tests commit created by the Red tests stage.
- If no such commit exists on a resume, the existing "no red-tests commit found" error already stops the run.

## 7. `scripts/sdlc-integration.sh` exit codes

| Condition | Before | After |
|---|---|---|
| Tests pass | 0 | 0 |
| CI skip (`CI` set, `SDLC_INTEGRATION_CI` not `run`) | 0 | 0 |
| Tests fail | 1 | 1 |
| No `test:integration` script in `server/package.json` | 1 | **3** |
| No `DATABASE_URL` and no docker | 1 | **3** |
| Database container not ready after 60 attempts (decision, Round 4 Q1) | 1 | **3** |
| Container port cannot be determined | 1 | unchanged by the brief; see review item R2 |

Exit 3 means the integration suite could not run. The existing message texts stay. The existing `success_check` caller must treat exit 3 as a failure of the integration check (not as a pass), as it treats exit 1 today.

Tests in `server/__tests__/scripts/sdlc-integration.test.js`: tests 4 and 7 expect exit 3. A test for the container-not-ready case is added if it can be done without a real container; otherwise it is a review item (R1).

## 8. Documentation

- `.claude/commands/plan.md`, `red-tests.md`, `tdd-loop.md`: describe the section, the integration tests requirement and the two gates.
- `AGENTS.md` and `CLAUDE.md` development guidelines: every DB or API change needs integration tests in `server/__tests__/integration/`.
- `README.md` "Running integration tests": the section format (3.1), the Red gate and diff gate behaviour, the exit codes, the CI skip, the untracked-file limitation (5.3) and that there is no opt-out.

## 9. Error cases (summary)

| Case | Result |
|---|---|
| No `## DB and API changes` section | `REJECT: Plan has no '## DB and API changes' section`, exit 1 |
| Malformed bullet, empty section, `- none` mixed with others | `REJECT:` line, exit 1 |
| Bullet token not in a new or modified integration file | `REJECT:` line per bullet, exit 1 |
| Integration tests pass before implementation | `RED GATE FAILED: new integration tests pass before implementation. See $LOG/integration.log`, exit 1 |
| No database for the red check (exit 3) | `ERROR: no database for the integration red check (set DATABASE_URL or start Docker)`, exit 1 |
| Source change without integration tests in the original red commit | `REJECT:` listing files, rerun from Plan, exit 1 |
| Unknown subcommand or missing arguments to the gate | usage on stderr, exit 1 |

## 10. Acceptance criteria

Gate script (`server/__tests__/scripts/sdlc-integration-gate.test.js`, throwaway git repos):
1. AC1 `plan` with `- none`: exit 0.
2. AC2 `plan` with a missing section: exit 1 with `Plan has no '## DB and API changes' section`.
3. AC3 `plan` with each of the five bullet kinds: exit 0 when the token is in a modified or new (staged) file under `integration/`; exit 1 naming the bullet when it is absent.
4. AC4 `plan` with the token only in a unit test file, only in an unmodified integration file, or only in an untracked integration file: exit 1.
5. AC5 `plan` with a malformed bullet, an empty section, or `- none` plus another bullet: exit 1.
6. AC6 `diff` with a change in each of the six source paths and no integration tests in the original red commit: exit 1; with them: exit 0.
7. AC7 `diff` with comment-only (`//`, `*`, `/*`, `--`) or whitespace-only edits: exit 0 even with no integration tests.
8. AC8 `diff` with docs-only, `server/test-utils/`, `server/scripts/` or package-file changes: exit 0.
9. AC9 `diff` after a Test repair commit: uses `<orig_red_sha>`, so integration tests in the original red commit pass the gate although the repair commit has none.
10. AC10 `diff` with an untracked new file under a source path only: exit 0 (documented limitation).

Wiring (`sdlc-integration-gate-wiring.test.js`, reads `scripts/sdlc.sh` as text; reads the script, not a test file):
11. AC11 the Plan prompt names `## DB and API changes`; the Red tests prompt names the section and `server/__tests__/integration/`.
12. AC12 the `plan` check appears before the integration red check and the red gate verdict.
13. AC13 exit 0 handling prints `RED GATE FAILED: new integration tests pass before implementation. See $LOG/integration.log`; exit 3 handling prints the `ERROR: no database ...` message.
14. AC14 the `diff` call appears after each Implement attempt and after Review.
15. AC15 the CI skip condition (`CI` non-empty and `SDLC_INTEGRATION_CI` not `run`) is present for the integration red check.
16. AC16 `bash -n scripts/sdlc.sh` passes.

Integration script:
17. AC17 tests 4 and 7 of `sdlc-integration.test.js` expect exit 3; tests failing still exit 1.

Docs:
18. AC18 `AGENTS.md`, `CLAUDE.md`, `README.md` and the three `.claude/commands/` files contain the updates in section 8.

## 11. Review items (not testable as unit tests)

- R1: container-not-ready exit 3 if it cannot be tested without a real Docker container.
- R2: the "could not determine database container port" error (`exit 1`) is not named in the brief or decisions; it is left unchanged, and the reviewer should confirm whether it should also be 3.
- R3: the rule that a test must not read test files applies to the wiring test: it reads `scripts/sdlc.sh` only.
