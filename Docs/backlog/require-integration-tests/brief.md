# require-integration-tests

Type: feature
Priority: P2 (normal)
Source: report: "all additions or changes to db or apis should create corresponding integration tests".

## Problem
The pipeline never asks for integration tests. The Plan prompt (`scripts/sdlc.sh:120`) and the Red tests prompt (`scripts/sdlc.sh:126`) do not mention them. The red gate (`scripts/sdlc.sh:128`) runs only `npm test`, and jest ignores `__tests__/integration/` (`server/package.json`, `testPathIgnorePatterns`), so an integration test written in Red tests is never shown to fail before the implementation exists. The integration suite runs only afterwards, inside `success_check` (line 61). Existing coverage is partial: `server/__tests__/integration/` covers `POST /inventory/transfer`, the sales endpoints, migrations and the pool; users, categories, products, batches, `GET /inventory` and the invoice have none. Verified by reading `scripts/sdlc.sh`, `server/package.json` and the integration tests; nothing was run.

## Expected behaviour
A pipeline run that adds or changes a database or API behaviour cannot reach Ship unless the Red tests stage produced integration tests for it, and those tests failed before the implementation.

## Decisions
- Plan: the Plan prompt requires `plan-1.md` to contain a section `## DB and API changes` whose bullets are exactly `- API: \`<METHOD> <path>\``, `- DB: migration \`<file name without .sql>\``, `- DB: table \`<name>\``, `- DB: column \`<table.column>\``, `- DB: model \`<file name without .js>\``, or the single bullet `- none`. A missing section fails the Plan stage (`Plan has no '## DB and API changes' section`).
- Red tests: the prompt requires, for every bullet, integration tests in `server/__tests__/integration/` following `api.integration.test.js` (helper `server/test-utils/scratchDb.js`, `supertest` on `require('../../index')`), with the bullet's token (`POST /sales/:id/refund`, `003_add_refunds`, `refunds`, `refunds.reason`, `sales`) written in a `describe` or `test` title, and a matching section in `test-cases-1.md`.
- New `scripts/sdlc-integration-gate.cjs` (exit 0 pass, 1 reject with `REJECT:` lines on stderr, same style as `scripts/sdlc-testcheck.cjs`). `plan <plan-1.md> <test-dir>`: unless the section is `- none`, every bullet's token must appear in a new or modified file under `<test-dir>/integration/`.
- Red gate: after the `plan` check passes and the section is not `- none`, `scripts/sdlc.sh` runs `bash scripts/sdlc-integration.sh`; exit 1 (tests failing) is the expected red result; exit 0 prints `RED GATE FAILED: new integration tests pass before implementation. See $LOG/integration.log`; exit 3 stops with `ERROR: no database for the integration red check (set DATABASE_URL or start Docker)`. The integration red check is skipped with a warning when `CI` is non-empty and `SDLC_INTEGRATION_CI` is not `run`.
- `scripts/sdlc-integration.sh` exits 3 (was 1) for the two infrastructure errors only: no `test:integration` script (line 14) and no `DATABASE_URL` or docker (line 77). Failing tests still exit 1. Tests 4 and 7 in `server/__tests__/scripts/sdlc-integration.test.js` change to expect 3.
- Diff gate: `diff <red_sha> <orig_red_sha>`. A source change is any file changed since `<red_sha>` under `server/migrations/`, `server/schema.sql`, `server/models/`, `server/index.js`, `server/middleware/` or `server/validation.js`, ignoring comment-only and whitespace-only changes (`git diff -U0 -w --ignore-blank-lines`, dropping lines that start with `//`, `*`, `/*` or `--`). If any remain, `git diff --name-only <orig_red_sha>~1 <orig_red_sha> -- server/__tests__/integration/` must be non-empty, else exit 1 listing the files and saying to rerun from Plan. It runs after each Implement attempt, next to the existing test-modified guard (line 151), and after Review (line 206). The orig sha keeps it correct after a Test repair commit.
- No opt-out switch, as with the integration check itself. Docs, `server/test-utils/`, `server/scripts/` and package files are not source changes.

## Scope
- In: `scripts/sdlc.sh` (Plan and Red tests prompts, red gate, two diff-gate calls); `scripts/sdlc-integration-gate.cjs` (new); `scripts/sdlc-integration.sh` (exit 3); `.claude/commands/plan.md`, `red-tests.md`, `tdd-loop.md`; `AGENTS.md` and `CLAUDE.md` (development guidelines); `README.md` ("Running integration tests").
- Out of scope: backfilling integration tests for endpoints that have none; CI; the Test repair stage; the guard plugin; unit-test rules.

## Tests
- New `server/__tests__/scripts/sdlc-integration-gate.test.js` (throwaway git repos): `plan` with `- none`, with a missing section, with each bullet kind present or missing from the integration files, and with only unit tests; `diff` with each path class, comment-only and whitespace-only edits (ignored), docs-only changes (pass), a red commit without integration tests (fail), with them (pass), and after a repair commit (uses the orig sha).
- New `server/__tests__/scripts/sdlc-integration-gate-wiring.test.js` (reads `scripts/sdlc.sh` as text): both prompts name the section and the integration folder; the `plan` check runs before the red gate; exit 0 and exit 3 handling; the diff gate runs after each Implement attempt and after Review; the CI skip; `bash -n` passes.
- `sdlc-integration.test.js` tests 4 and 7 expect exit 3.

## Docs
- `AGENTS.md` and `CLAUDE.md`: every DB or API change needs integration tests in `server/__tests__/integration/`. `README.md`: the section format and the gates.

## Open questions
- none
