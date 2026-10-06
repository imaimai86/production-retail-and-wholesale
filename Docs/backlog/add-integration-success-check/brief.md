# add-integration-success-check

Type: feature
Priority: P2 (normal)
Source: user request: "Add integration tests to the sdlc success check in local not in ci".

## Problem
The pipeline's success checks (`tests_pass` in `scripts/sdlc.sh`, which runs `npm test`) only run the mocked unit tests. A change can pass every gate and still break against a real Postgres. The integration suite (from `add-db-integration-tests`) is not part of any gate, and a developer running the pipeline locally has no way to include it.

## Expected behaviour
When `./scripts/sdlc.sh` runs on a developer machine, its success checks also run `npm run test:integration` against a real, throwaway Postgres. When it runs in CI, it does not (CI has its own integration job).

## Decisions
- New helper `scripts/sdlc-integration.sh` (executable, `set -euo pipefail`). Exit 0 means pass or deliberate skip, non-zero means failure. `scripts/sdlc.sh` calls it and writes its output to `$LOG/integration.log`.
- Helper logic, in this order:
  1. If `CI` is set and non-empty: print `integration tests skipped in CI (CI has its own job)` and exit 0. Calls no other command.
  2. If `SDLC_INTEGRATION=off`: print a visible `WARNING: integration tests skipped (SDLC_INTEGRATION=off)` and exit 0. Default is `on`.
  3. If `server/package.json` has no `test:integration` script (checked with `node -e`): print `WARNING: no test:integration script, skipping` and exit 0, so the pipeline still works before `add-db-integration-tests` is merged.
  4. If `DATABASE_URL` is set and non-empty: use it as is (the developer's own database; the suite creates and drops its own scratch database) and run step 6.
  5. Otherwise, if `docker` is available: start a throwaway container with `docker run -d --rm --name prw-sdlc-db-<pid> -e POSTGRES_USER=app -e POSTGRES_PASSWORD=<random> -e POSTGRES_DB=app -p 127.0.0.1::5432 postgres:16`, where the password is random per run (for example from `openssl rand -hex 8`) and the port is chosen by Docker and read with `docker port`. Wait until `docker exec <name> pg_isready -U app -d app` succeeds (poll once a second, 30 attempts, then fail). Build `DATABASE_URL` for that port, export it, and register a `trap` on EXIT that runs `docker rm -f <name>` so the container is removed even when tests fail or the script is interrupted. If neither `DATABASE_URL` nor `docker` exists: print `ERROR: integration tests need DATABASE_URL or docker (set SDLC_INTEGRATION=off to skip)` and exit 1.
  6. Run `npm run test:integration` from the repo root and exit with its exit code.
- The password and the full URL are never printed or written to the log.
- `scripts/sdlc.sh`: add `success_check() { tests_pass && integration_check; }` where `integration_check` runs the helper into `$LOG/integration.log`. Use `success_check` at: the Implement green gate, after an accepted Test repair, and after Review. The Red tests gate keeps using `tests_pass` only (it must see unit tests fail).
- Failure handling: an integration failure counts as a failed Implement attempt, and the next attempt's prompt also points at `$LOG/integration.log`. Integration failures are never eligible for the Test repair stage (its pre-check stays unit-only), so if they persist after the last attempt the run exits 1 with `See $LOG/integration.log`.
- The agents themselves do not start Docker or run the integration suite; only the bash script does.
- Docs: `README.md` and `CLAUDE.md` (commands table): describe `SDLC_INTEGRATION=on|off`, the `CI` skip, and that Docker or `DATABASE_URL` is needed locally. Add the new variable to the header comment of `scripts/sdlc.sh`.

## Scope
- In: `scripts/sdlc-integration.sh` (new), `scripts/sdlc.sh`, `README.md`, `CLAUDE.md`.
- Out of scope: the integration tests themselves and `.gitlab-ci.yml` (item `add-db-integration-tests`), the Red tests gate, the Test repair stage logic, any application source, `.claude/commands/*`.

## Tests
- New `server/__tests__/scripts/sdlc-integration.test.js`: runs `bash scripts/sdlc-integration.sh` with `child_process.spawnSync` in a temporary directory, with shim executables for `docker`, `npm`, `node` and `openssl` placed first on `PATH`; each shim appends its arguments to a calls file. Cases:
  - `CI=true` -> exit 0, output contains `skipped in CI`, no shim was called.
  - `SDLC_INTEGRATION=off` -> exit 0, output contains `WARNING`, no `npm` or `docker` call.
  - no `test:integration` script (the `node` shim reports it missing) -> exit 0 with a `WARNING`.
  - `DATABASE_URL` set -> `npm run test:integration` is called with that URL in its environment and `docker` is never called.
  - `DATABASE_URL` unset and a `docker` shim -> `docker run` is called with `postgres:16`, `127.0.0.1::5432` and a `--name` starting with `prw-sdlc-db-`; `npm run test:integration` runs with a `DATABASE_URL` for the shim's port; `docker rm -f` is called afterwards, including when the `npm` shim exits 1; the script exits with the `npm` shim's exit code.
  - neither `DATABASE_URL` nor `docker` (empty `PATH` except the shims) -> exit 1 and output contains `DATABASE_URL or docker`.
  - the generated password never appears in stdout or stderr.
- New `server/__tests__/scripts/sdlc-gates.test.js`: reads `scripts/sdlc.sh` as text and asserts: it defines `success_check`; the Red gate line uses `tests_pass` and not `success_check`; the Implement green gate, the post-Test-repair check and the post-Review check use `success_check`; the file contains `integration.log`; and `bash -n scripts/sdlc.sh` and `bash -n scripts/sdlc-integration.sh` succeed.

## Docs
- `README.md` (SDLC section), `CLAUDE.md` (commands table and a note on `SDLC_INTEGRATION`), header comment of `scripts/sdlc.sh`.

## Open questions
- none
