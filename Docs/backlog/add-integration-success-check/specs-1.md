# Spec 1: add-integration-success-check

## Goal
Make the integration suite (`npm run test:integration`, from `add-db-integration-tests`) a required part of the SDLC pipeline's success checks, so database issues missed by mocked unit tests fail the run. Locally it is always on. In CI it is skipped for now, loudly, and a single CI variable enables it later without a code change.

## Preconditions
- `add-db-integration-tests` must be merged first (it provides the `test:integration` script in `server/package.json` and the suite).
- Until it is merged, every run of the new `scripts/sdlc.sh` fails with the missing-script error (see E1). This item's own run is unaffected because the pipeline running it uses the committed `scripts/sdlc.sh`.

## Scope
In: `scripts/sdlc-integration.sh` (new), `scripts/sdlc.sh`, `README.md`, `CLAUDE.md`.
Out: the integration tests themselves and `.gitlab-ci.yml`, the Red tests gate, the Test repair stage logic, the Ship stage commit scope, application source, `.claude/commands/*`.

## 1. Helper: `scripts/sdlc-integration.sh`

### Contract
- Starts with `set -euo pipefail`. Invoked as `bash scripts/sdlc-integration.sh`; it must not depend on the executable bit.
- Exit 0: the suite passed, or the temporary CI skip applied. Non-zero: any failure.
- Inputs (environment only, no arguments): `CI`, `SDLC_INTEGRATION_CI`, `DATABASE_URL`. `SDLC_INTEGRATION` is not read; setting `SDLC_INTEGRATION=off` has no effect.
- Output: human-readable messages on stdout/stderr (the caller redirects them to `$LOG/integration.log`).

### Behaviour, evaluated strictly in this order
1. **Temporary CI skip.** If `CI` is set and non-empty and `SDLC_INTEGRATION_CI` is not exactly `run`: print `WARNING: TEMPORARY: integration tests skipped in CI. Set SDLC_INTEGRATION_CI=run once CI has a database.` and exit 0. The comment `TODO(temporary): remove this skip once CI provides a database` sits directly above this block. This block calls no other command (no `node`, `npm`, `docker`, `openssl`).
2. **Script presence.** Check with `node -e` whether `server/package.json` has a `test:integration` script. If not: print `ERROR: no test:integration script in server/package.json (see add-db-integration-tests)` and exit 1.
3. **Provided database.** If `DATABASE_URL` is set and non-empty: use it as is (the suite creates and drops its own scratch database), do not touch Docker, go to step 5. This is also the CI path when `SDLC_INTEGRATION_CI=run`.
4. **Throwaway Docker database.** Otherwise, if `docker` is available:
   - Generate a random per-run password (for example `openssl rand -hex 8`).
   - Start `docker run -d --rm --name prw-sdlc-db-<pid> -e POSTGRES_USER=app -e POSTGRES_PASSWORD=<random> -e POSTGRES_DB=app -p 127.0.0.1::5432 postgres:16`.
   - Read the Docker-chosen host port with `docker port`.
   - Register a `trap` on EXIT, INT and TERM that runs `docker rm -f <name>`, so the container is removed on test failure and on interrupt.
   - Wait until `docker exec <name> pg_isready -h 127.0.0.1 -U app -d app` succeeds (TCP, not the unix socket). Poll once per second, at most 60 attempts; if never ready, fail non-zero.
   - Build and export `DATABASE_URL` pointing at `127.0.0.1:<port>` for that database.
   - If neither `DATABASE_URL` nor `docker` exists: print `ERROR: integration tests need DATABASE_URL or docker` and exit 1.
5. **Run.** Run `npm run test:integration --prefix server` and exit with its exit code.

### Secrecy
The generated password and the full `DATABASE_URL` are never printed or written to the log (stdout or stderr), including in error paths.

### Error cases
| # | Condition | Result |
|---|---|---|
| E1 | No `test:integration` script (not skipped by CI) | message above, exit 1 |
| E2 | No `DATABASE_URL` and no `docker` | message above, exit 1 |
| E3 | Docker container not ready after 60 attempts | non-zero exit; container still removed by the trap |
| E4 | `docker run` or `docker port` fails | non-zero exit (via `set -e`); container removed if it was created |
| E5 | `npm run test:integration` fails | its exit code is the helper's exit code; container removed |
| E6 | Interrupted (INT/TERM) | container removed |

A missing script, missing database or missing Docker is always a failure locally, never a silent skip.

## 2. `scripts/sdlc.sh` changes
- Add `integration_check`, which runs `bash scripts/sdlc-integration.sh` with its output (stdout and stderr) written to `$LOG/integration.log`.
- Add `success_check() { tests_pass && integration_check; }`.
- Use `success_check` at exactly three places: the Implement green gate (currently `tests_pass` at the green-gate `if`), the check after an accepted Test repair, and the check after Review.
- The Red tests gate keeps using `tests_pass` only (it must see unit tests fail).
- The Test repair stage's pre-check stays unit-only; integration failures are never eligible for Test repair.
- An integration failure at the Implement gate counts as a failed Implement attempt. The next attempt's Implement prompt also points at `$LOG/integration.log` (alongside the existing tests log).
- If integration failures persist after the last Implement attempt, the run exits 1 with the message `See $LOG/integration.log`. A failure after Test repair or after Review likewise exits 1 pointing at the appropriate log (`$LOG/integration.log` for integration failures, `$LOG/tests.log` for unit failures).
- Agents never start Docker or run the integration suite; only the bash script does.
- The header comment lists `SDLC_INTEGRATION_CI` (meaning and the value `run`). No `SDLC_INTEGRATION=` opt-out appears anywhere in the file.

## 3. Docs
- `README.md` (SDLC section) and `CLAUDE.md` (commands table and a note on `SDLC_INTEGRATION_CI`) state: integration tests are a required part of the pipeline locally (needs Docker or `DATABASE_URL`); CI skips them temporarily; to switch CI on set the CI/CD variable `SDLC_INTEGRATION_CI=run` and provide `DATABASE_URL` (for example from a `postgres:16` service), with no code change.
- Neither document contains `SDLC_INTEGRATION=off`.

## 4. Tests (required deliverables)
### `server/__tests__/scripts/sdlc-integration.test.js`
Runs `bash scripts/sdlc-integration.sh` via `child_process.spawnSync` in a temporary directory, with shim executables for `docker`, `npm`, `node`, `openssl` first on `PATH`; each shim appends its arguments to a calls file. Does not assert the executable bit. Cases:
1. `CI=true` → exit 0, output contains `TEMPORARY` and `SDLC_INTEGRATION_CI=run`, no shim called.
2. `CI=true`, `SDLC_INTEGRATION_CI=run`, `DATABASE_URL` set → `npm run test:integration` called, `docker` not called.
3. `SDLC_INTEGRATION=off`, no `CI` → suite still runs (`npm run test:integration` called).
4. `node` shim reports no script → exit 1, output contains `no test:integration script`.
5. `DATABASE_URL` set → `npm run test:integration` called with that URL in its environment; `docker` never called.
6. `DATABASE_URL` unset, `docker` shim → `docker run` with `postgres:16`, `127.0.0.1::5432`, `--name` starting `prw-sdlc-db-`; readiness uses `pg_isready -h 127.0.0.1`; `npm run test:integration` runs with a `DATABASE_URL` for the shim's port; `docker rm -f` called afterwards, including when the `npm` shim exits 1; helper exits with the `npm` shim's exit code.
7. Neither `DATABASE_URL` nor `docker` → exit 1, output contains `DATABASE_URL or docker`.
8. The generated password never appears in stdout or stderr.

### `server/__tests__/scripts/sdlc-gates.test.js`
Reads `scripts/sdlc.sh` as text and asserts: defines `success_check`; the Red gate line uses `tests_pass` and not `success_check`; the Implement green gate, post-Test-repair check and post-Review check use `success_check`; the file contains `integration.log` and `SDLC_INTEGRATION_CI`; it does not contain `SDLC_INTEGRATION=` as an opt-out; `README.md` and `CLAUDE.md` do not contain `SDLC_INTEGRATION=off`; `bash -n scripts/sdlc.sh` and `bash -n scripts/sdlc-integration.sh` succeed.

## Acceptance criteria
1. Locally (no `CI`), a pipeline run executes the integration suite at the Implement green gate, after an accepted Test repair, and after Review; any failure fails that check.
2. No local setting disables the check; `SDLC_INTEGRATION=off` is inert.
3. With `CI` non-empty and `SDLC_INTEGRATION_CI` ≠ `run`, the helper prints the TEMPORARY warning and exits 0 without running any other command.
4. With `CI` non-empty and `SDLC_INTEGRATION_CI=run`, the helper runs the suite (using `DATABASE_URL`), no code change needed.
5. Missing script, or missing both `DATABASE_URL` and Docker, exits 1 with the specified messages.
6. The Docker container is always removed (success, failure, INT/TERM); password and URL never appear in output.
7. The Red tests gate and the Test repair pre-check remain unit-only.
8. The two new test files pass under `npm test`; `bash -n` passes on both scripts.
9. `README.md`, `CLAUDE.md` and the `scripts/sdlc.sh` header document the behaviour and `SDLC_INTEGRATION_CI`.
