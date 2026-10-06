# Plan 1: add-integration-success-check

Implements `specs-1.md`. Graft does not index shell scripts or docs (`scripts/sdlc.sh` has no indexed symbols, `tests_pass` has no graph hits), so the affected spots were located by reading `scripts/sdlc.sh` directly. There are no application-source callers: everything is in `scripts/`, docs and new tests.

## Affected files
| File | Change |
|---|---|
| `scripts/sdlc-integration.sh` | new helper |
| `scripts/sdlc.sh` | new functions, 3 call-site swaps, prompt and message tweaks, header |
| `README.md` | new SDLC section (the current README only has "Graft setup") |
| `CLAUDE.md` | commands table row plus a `SDLC_INTEGRATION_CI` note |
| `server/__tests__/scripts/sdlc-integration.test.js` | new (the `scripts/` dir does not exist yet) |
| `server/__tests__/scripts/sdlc-gates.test.js` | new |

Not touched: `server/package.json` (the `test:integration` script comes from `add-db-integration-tests`), `.gitlab-ci.yml`, `.claude/commands/*`, application source, `scripts/sdlc-testcheck.cjs`.

Current `scripts/sdlc.sh` anchors:
- `tests_pass()` at line 55, defined next to `stage()`.
- Red gate at line 119: `if tests_pass; then echo "RED GATE FAILED ..."`. Leave unchanged.
- Implement prompt at lines 137-140, the green gate at line 144, and the final failure message at line 148.
- Test repair pre-check at line 158 (`jest_json_now` plus `$CHECK precheck`). Leave unchanged.
- Post-repair check at line 186: `tests_pass || reject "..."`.
- Post-Review check at line 198: `tests_pass || { echo "Tests broke after review..."; exit 1; }`.
- Header comment at lines 2-5.

## Order of work
Write order follows the red tests gate: the tests are written first by the QA stage. This plan lists the implementation order.

### Step 1. `scripts/sdlc-integration.sh` (new)
Start with `set -euo pipefail`. No `cd`, no shebang dependence. It must work when run as `bash scripts/sdlc-integration.sh` from the repo root. The `cd` is done by the caller `sdlc.sh`, and the test runs it with `cwd` set to the temp dir (see step 5). Resolve `server/package.json` relative to the current directory.

Sections, in this exact order:
1. **Temporary CI skip.**
   ```bash
   # TODO(temporary): remove this skip once CI provides a database
   if [ -n "${CI:-}" ] && [ "${SDLC_INTEGRATION_CI:-}" != "run" ]; then
     echo "WARNING: TEMPORARY: integration tests skipped in CI. Set SDLC_INTEGRATION_CI=run once CI has a database."
     exit 0
   fi
   ```
   Only bash builtins here: no `node`, `npm`, `docker`, `openssl`, and no `command -v` (it is a builtin, but keep the block free of it).
2. **Script presence.** `node -e` reads `server/package.json` and exits 0/1 on `scripts["test:integration"]`. Use `if ! node -e '...'; then echo "ERROR: no test:integration script in server/package.json (see add-db-integration-tests)"; exit 1; fi`. Wrapping it in `if !` avoids tripping `set -e` before the message prints.
3. **Provided database.** `if [ -n "${DATABASE_URL:-}" ]`, so skip Docker and fall to step 5.
4. **Docker path** (`elif command -v docker >/dev/null 2>&1`; else `echo "ERROR: integration tests need DATABASE_URL or docker"; exit 1`):
   - `PW="$(openssl rand -hex 8)"`; `NAME="prw-sdlc-db-$$"`.
   - Define `cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }` and register `trap cleanup EXIT` and `trap 'exit 130' INT` / `trap 'exit 143' TERM` **before** `docker run`, so a half-created container is also removed (E4). `docker rm -f` on a missing container is harmless. EXIT fires for the INT/TERM exits, which gives E6.
   - `docker run -d --rm --name "$NAME" -e POSTGRES_USER=app -e POSTGRES_PASSWORD="$PW" -e POSTGRES_DB=app -p 127.0.0.1::5432 postgres:16 >/dev/null`. Discard stdout (the container id) and keep stderr, since docker does not echo `-e` values on errors. Do not use `set -x`.
   - `PORT="$(docker port "$NAME" 5432/tcp | head -n1 | sed -E 's/.*://')"`. With `pipefail`, a failing `docker port` fails the script (E4). Validate that `PORT` is numeric, else exit 1.
   - Readiness loop: up to 60 attempts, `docker exec "$NAME" pg_isready -h 127.0.0.1 -U app -d app >/dev/null 2>&1`, `sleep 1` between attempts. After 60 failures print `ERROR: database container not ready after 60 attempts` and `exit 1` (E3, the trap removes the container).
   - `export DATABASE_URL="postgres://app:${PW}@127.0.0.1:${PORT}/app"`. Never echo `PW` or `DATABASE_URL`.
5. **Run.** `npm run test:integration --prefix server` and propagate its exit code. Do not `exec` it, because `exec` would replace the shell and the EXIT trap would not run. Use a plain call with `rc=0; npm run test:integration --prefix server || rc=$?; exit "$rc"` so the trap fires and the code is preserved (E5).

Secrecy: do not pipe npm output through anything that prints the URL. The suite's own output is the only thing logged. Messages in all paths use fixed strings.

### Step 2. `scripts/sdlc.sh`
1. Header (lines 2-5): add a line documenting `SDLC_INTEGRATION_CI` (when `CI` is set, the integration suite is skipped with a warning unless `SDLC_INTEGRATION_CI=run`, which also needs `DATABASE_URL`). Do not write the literal `SDLC_INTEGRATION=` anywhere. The gates test greps for it, and `SDLC_INTEGRATION_CI=` contains `SDLC_INTEGRATION` but not `SDLC_INTEGRATION=`, so that is fine.
2. After `tests_pass()` (line 55) add:
   ```bash
   integration_check() { bash scripts/sdlc-integration.sh > "$LOG/integration.log" 2>&1; }
   success_check() { tests_pass && integration_check; }
   ```
   `success_check` is always called in a condition (`if`, `||`), so `set -e` is not an issue.
3. Implement prompt (lines 137-140): change the log line to `Latest test output is in $LOG/tests.log and integration output (if any) in $LOG/integration.log (run '$TEST_CMD' yourself to refresh; do NOT start Docker or run the integration suite, the pipeline does that).` The first attempt has no `integration.log` yet, so word it as "if present".
4. Line 144: `if tests_pass; then` becomes `if success_check; then echo " tests and integration green"; ...`.
5. Line 148 message: make it point at the log that failed. Use a small test such as `[ -s "$LOG/integration.log" ]` is not reliable, so track the failure instead: set `LAST_FAIL=tests` or `integration` inside the loop (`if tests_pass; then if integration_check; then GREEN=1; break; else LAST_FAIL=integration; fi; else LAST_FAIL=tests; fi`). Prefer this expanded form over `success_check` at this one place only if the message needs the distinction. The spec's explicit text is `See $LOG/integration.log` for persistent integration failures, so the expanded form is required. Still keep the name `success_check` defined and used at the other two sites. For the gates test (`Implement green gate uses success_check`), keep `success_check` on the gate line and compute which log to point at after the loop: `if success_check; then ...; fi` and after the loop, on failure, `if grep -q . "$LOG/tests.log" && ! tests_pass` is too costly. Simplest: the failure message prints both, `See $LOG/tests.log and $LOG/integration.log`, which contains the required `See $LOG/integration.log`? No, it does not as a substring. So use the tracked variant: `success_check` stays on the gate line, and `success_check` itself sets `FAIL_LOG`:
   ```bash
   success_check() {
     if ! tests_pass; then FAIL_LOG="$LOG/tests.log"; return 1; fi
     if ! integration_check; then FAIL_LOG="$LOG/integration.log"; return 1; fi
   }
   ```
   This still reads as `success_check() { tests_pass && integration_check; }` in behaviour. If the gates test greps for the literal one-line form, QA must match on `success_check()` only (the spec says "defines `success_check`"). The three call sites then print `See $FAIL_LOG`. Initialise `FAIL_LOG="$LOG/tests.log"` near the other vars.
6. Line 148: `... and no test defect was claimed. See $FAIL_LOG`.
   - Decision: if integration failed at the last attempt and the Implement agent also wrote `test-issues.md`, the run goes into Test repair. The pre-check stays unit-only (line 158), so an integration-only failure with a stale `test-issues.md` is rejected by the pre-check or the auditor. The loop `rm -f "$DOCS/test-issues.md"` happens before the loop, so a claim exists only if an agent wrote one. Leave as is.
7. Line 186: `tests_pass || reject "..."` becomes `success_check || reject "checks still fail after an audited repair; see $FAIL_LOG"`. The spec says the failure exits 1 pointing at the right log, and `reject` exits 1 and restores the tests.
8. Line 198: `tests_pass || { echo "Tests broke after review. See $LOG/tests.log"; exit 1; }` becomes `success_check || { echo "Checks broke after review. See $FAIL_LOG"; exit 1; }`.
9. Do not touch line 119 (Red gate) or line 158 (pre-check). Do not add an `ALLOWED` entry for docker or the integration script: agents must not run them.

### Step 3. `README.md`
Add a section "SDLC pipeline: integration tests" after "Graft setup" (README has no SDLC section yet):
- Integration tests (`npm run test:integration`) are a required part of the pipeline locally; they need Docker or `DATABASE_URL`.
- CI skips them temporarily with a visible warning.
- To enable in CI: set the CI/CD variable `SDLC_INTEGRATION_CI=run` and provide `DATABASE_URL` (for example from a `postgres:16` service). No code change.
- Do not mention `SDLC_INTEGRATION=off`.

### Step 4. `CLAUDE.md`
- Commands table: add a row `bash scripts/sdlc-integration.sh` : "Run the integration suite as the SDLC does (Docker or `DATABASE_URL`)".
- Under "SDLC pipeline", add a note on `SDLC_INTEGRATION_CI` with the same content as the README, and the same prohibition on `SDLC_INTEGRATION=off`.
- Keep stage names, not numbers.

### Step 5. Tests (written by the QA stage; the plan fixes the approach)
`server/__tests__/scripts/sdlc-integration.test.js`:
- A `beforeEach` creates a temp dir (`fs.mkdtempSync`) with a `bin/` of shims and a `calls.log`. Each shim is a small `#!/bin/sh` script that appends `name args...` to the calls file. Make them executable with `fs.chmodSync(..., 0o755)` in the test (the test must not assert the repo script's executable bit).
- Shims: `docker` (handles `run`, `port` printing `5432/tcp -> 127.0.0.1:54321`, `exec`, `rm`), `npm` (records `DATABASE_URL` from env; exit code from an env var such as `SHIM_NPM_RC`), `node` (exit code from `SHIM_NODE_RC` for the script-presence check), `openssl` (prints a fixed known password so case 8 can search the output for it).
- Run `spawnSync('bash', [path.resolve(repoRoot, 'scripts/sdlc-integration.sh')], { cwd: tmp, env: { PATH: bin + ':' + systemPath, ... } })`. Use a clean env object (not `process.env`) so a real `CI` or `DATABASE_URL` does not leak. Keep system `PATH` after the shim dir so `sed`, `head`, `sleep` resolve. Create `tmp/server/package.json` to match the relative path. `repoRoot` is `path.resolve(__dirname, '../../..')`.
- Cases 1-8 exactly as in the spec. For case 6 add a second run with `SHIM_NPM_RC=1` and assert `docker rm -f` appears after `npm`. For the readiness failure (E3) optionally make the docker shim's `exec` fail and override the sleep with a `sleep` shim so the 60 attempts are instant.
- A `sleep` shim is needed so the readiness path is fast.

`server/__tests__/scripts/sdlc-gates.test.js`: read `scripts/sdlc.sh`, `README.md`, `CLAUDE.md` as text. Assertions per the spec. Find the Red gate line with `/RED GATE FAILED/`. Check the Implement green gate by matching the `success_check` line that precedes `GREEN=1`, the post-repair line by `/audited repair/`, and the post-Review line by `/after review/`. `bash -n` through `spawnSync`.

### Step 6. Verify
- `bash -n scripts/sdlc.sh && bash -n scripts/sdlc-integration.sh`.
- `npm test` from the repo root: both new test files pass and nothing else regresses.
- `grep -rn "SDLC_INTEGRATION=" scripts README.md CLAUDE.md` returns nothing (apart from the `SDLC_INTEGRATION_CI=` forms).
- Manual: `CI=1 bash scripts/sdlc-integration.sh` prints the TEMPORARY warning and exits 0.

## Risks and notes
- Until `add-db-integration-tests` is merged, every real `sdlc.sh` run fails at the first `success_check` with the missing-script error (E1). This is expected per the spec's preconditions.
- The Docker container is named with `$$`, so concurrent runs do not collide. `-p 127.0.0.1::5432` keeps the DB off external interfaces.
- `set -e` inside `cleanup` must not mask the real exit code: `cleanup` ends with `|| true`, and the EXIT trap does not change `$?` because it does not call `exit`.
- On macOS, `docker port` output is `5432/tcp -> 127.0.0.1:PORT`. If Docker also reports an IPv6 line (`[::]:PORT`), `head -n1` picks the first, and the `sed` strips up to the last colon, so both forms work.
