# add-integration-success-check

Type: feature
Priority: P2 (normal)
Source: user request: "Add integration tests to the sdlc success check in local not in ci", clarified: integration tests must be a required part of the SDLC because unit tests alone missed database issues; the only skip allowed is a TEMPORARY one in CI, because CI has no database yet. Once CI has a database, the user will enable the check there too.

## Problem
The pipeline's success checks (`tests_pass` in `scripts/sdlc.sh`, which runs `npm test`) only run the mocked unit tests. A change can pass every gate and still break against a real Postgres; database issues were already missed this way. The integration suite (from `add-db-integration-tests`) is not part of any gate.

## Expected behaviour
- On a developer machine, `./scripts/sdlc.sh` always runs `npm run test:integration` against a real, throwaway Postgres as part of its success checks. There is no local way to turn it off, and a missing script, missing database or missing Docker is a failure, never a silent skip.
- In CI the step is skipped for now, loudly and by default, and a single CI variable switches it on later without any code change.

## Decisions
- Preconditions: `add-db-integration-tests` must be merged first (it provides the `test:integration` script and the suite). This item's own run is not affected, because the pipeline running it uses the committed `scripts/sdlc.sh`; but every later run of the new `sdlc.sh` fails with the missing-script error until that item is in.
- The `SDLC_INTEGRATION` variable is removed from the design. There is no local opt-out. Setting `SDLC_INTEGRATION=off` has no effect.
- New helper `scripts/sdlc-integration.sh` (`set -euo pipefail`). Exit 0 means the suite passed or the temporary CI skip applied; non-zero means failure. `scripts/sdlc.sh` calls it as `bash scripts/sdlc-integration.sh` (the helper must not depend on the executable bit, because the pipeline's agents cannot run `chmod`) and writes its output to `$LOG/integration.log`.
- Helper logic, in this order:
  1. TEMPORARY CI skip: if `CI` is set and non-empty and `SDLC_INTEGRATION_CI` is not exactly `run`: print `WARNING: TEMPORARY: integration tests skipped in CI. Set SDLC_INTEGRATION_CI=run once CI has a database.` and exit 0. A comment `TODO(temporary): remove this skip once CI provides a database` sits directly above this block. Calls no other command.
  2. If `server/package.json` has no `test:integration` script (checked with `node -e`): print `ERROR: no test:integration script in server/package.json (see add-db-integration-tests)` and exit 1.
  3. If `DATABASE_URL` is set and non-empty: use it as is (the suite creates and drops its own scratch database) and run step 5. This is also the path CI uses with `SDLC_INTEGRATION_CI=run`.
  4. Otherwise, if `docker` is available: start a throwaway container with `docker run -d --rm --name prw-sdlc-db-<pid> -e POSTGRES_USER=app -e POSTGRES_PASSWORD=<random> -e POSTGRES_DB=app -p 127.0.0.1::5432 postgres:16`; the password is random per run (for example from `openssl rand -hex 8`) and the port is chosen by Docker and read with `docker port`. Wait until `docker exec <name> pg_isready -h 127.0.0.1 -U app -d app` succeeds (TCP, not the unix socket, because the image's temporary init server answers on the socket first); poll once a second for 60 attempts, then fail. Build and export `DATABASE_URL` for that port, and register a `trap` on EXIT, INT and TERM that runs `docker rm -f <name>` so the container is removed even when tests fail or the script is interrupted. If neither `DATABASE_URL` nor `docker` exists: print `ERROR: integration tests need DATABASE_URL or docker` and exit 1.
  5. Run `npm run test:integration --prefix server` and exit with its exit code.
- The password and the full URL are never printed or written to the log.
- Enabling it in CI later: set the CI/CD variable `SDLC_INTEGRATION_CI=run` and provide `DATABASE_URL` (for example from a `postgres:16` service). No code change.
- `scripts/sdlc.sh`: add `success_check() { tests_pass && integration_check; }` where `integration_check` runs the helper into `$LOG/integration.log`. Use `success_check` at: the Implement green gate, after an accepted Test repair, and after Review. The Red tests gate keeps using `tests_pass` only (it must see unit tests fail). The next attempt's Implement prompt also points at `$LOG/integration.log`.
- Failure handling: an integration failure counts as a failed Implement attempt. Integration failures are never eligible for the Test repair stage (its pre-check stays unit-only), so if they persist after the last attempt the run exits 1 with `See $LOG/integration.log`.
- The agents themselves do not start Docker or run the integration suite; only the bash script does.
- Docs: `README.md` and `CLAUDE.md` state that integration tests are a required part of the pipeline locally (needs Docker or `DATABASE_URL`), that CI skips them temporarily, and how to switch CI on (`SDLC_INTEGRATION_CI=run`). The header comment of `scripts/sdlc.sh` lists `SDLC_INTEGRATION_CI`.

## Scope
- In: `scripts/sdlc-integration.sh` (new), `scripts/sdlc.sh`, `README.md`, `CLAUDE.md`.
- Out of scope: the integration tests themselves and `.gitlab-ci.yml` (item `add-db-integration-tests`), the Red tests gate, the Test repair stage logic, the Ship stage commit scope (item `fix-ship-commit-scope`), any application source, `.claude/commands/*`.

## Tests
- New `server/__tests__/scripts/sdlc-integration.test.js`: runs `bash scripts/sdlc-integration.sh` with `child_process.spawnSync` in a temporary directory, with shim executables for `docker`, `npm`, `node` and `openssl` placed first on `PATH`; each shim appends its arguments to a calls file. Do not assert the executable bit. Cases:
  - `CI=true` -> exit 0, output contains `TEMPORARY` and `SDLC_INTEGRATION_CI=run`, no shim was called.
  - `CI=true` and `SDLC_INTEGRATION_CI=run` with `DATABASE_URL` set -> `npm run test:integration` is called and `docker` is not.
  - `SDLC_INTEGRATION=off` (and no `CI`) -> the suite still runs: `npm run test:integration` is called.
  - no `test:integration` script (the `node` shim reports it missing) -> exit 1 and output contains `no test:integration script`.
  - `DATABASE_URL` set -> `npm run test:integration` is called with that URL in its environment and `docker` is never called.
  - `DATABASE_URL` unset and a `docker` shim -> `docker run` is called with `postgres:16`, `127.0.0.1::5432` and a `--name` starting with `prw-sdlc-db-`; readiness uses `pg_isready -h 127.0.0.1`; `npm run test:integration` runs with a `DATABASE_URL` for the shim's port; `docker rm -f` is called afterwards, including when the `npm` shim exits 1; the script exits with the `npm` shim's exit code.
  - neither `DATABASE_URL` nor `docker` -> exit 1 and output contains `DATABASE_URL or docker`.
  - the generated password never appears in stdout or stderr.
- New `server/__tests__/scripts/sdlc-gates.test.js`: reads `scripts/sdlc.sh` as text and asserts: it defines `success_check`; the Red gate line uses `tests_pass` and not `success_check`; the Implement green gate, the post-Test-repair check and the post-Review check use `success_check`; the file contains `integration.log` and `SDLC_INTEGRATION_CI`; it does not contain `SDLC_INTEGRATION=` as an opt-out; `README.md` and `CLAUDE.md` do not contain `SDLC_INTEGRATION=off`; and `bash -n scripts/sdlc.sh` and `bash -n scripts/sdlc-integration.sh` succeed.

## Docs
- `README.md` (SDLC section), `CLAUDE.md` (commands table and a note on `SDLC_INTEGRATION_CI`), header comment of `scripts/sdlc.sh`.

## Open questions
- none
