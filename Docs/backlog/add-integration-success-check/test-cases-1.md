# Test cases 1: add-integration-success-check

Covers `specs-1.md` and `plan-1.md`. These tests are expected to fail (Red tests) until the Implement stage creates `scripts/sdlc-integration.sh` and edits `scripts/sdlc.sh`, `README.md` and `CLAUDE.md`.

Approach: `sdlc-integration.test.js` runs the helper with `bash` in a temp dir, with a clean env and a `PATH` containing only shims (`docker`, `npm`, `node`, `openssl`, `sleep`) plus symlinks to `sed`, `head`, `tr`, `cat`, `rm`, `env`, `dirname`, `basename`, `grep`. Shims log every call to `calls.log`. The executable bit of the repo script is not asserted.

## `server/__tests__/scripts/sdlc-integration.test.js`
| # | Scenario | Env / shim | Expected | Spec ref |
|---|---|---|---|---|
| 1 | CI skip | `CI=true` | exit 0; output has `TEMPORARY` and `SDLC_INTEGRATION_CI=run`; no shim called | AC3, step 1 |
| 1b | Skip is strict | `CI=1`, `SDLC_INTEGRATION_CI=RUN`, `DATABASE_URL` set | still skips, no shim called | step 1 |
| 1c | Empty CI | `CI=''`, `DATABASE_URL` set | not a skip; npm called | step 1 |
| 2 | CI enabled | `CI`, `SDLC_INTEGRATION_CI=run`, `DATABASE_URL` | npm called, docker not, no TEMPORARY | AC4 |
| 3 | Opt-out inert | `SDLC_INTEGRATION=off`, `DATABASE_URL` | npm called, exit 0 | AC2 |
| 4 | No script | node shim rc 1 | exit 1; `no test:integration script`; npm not called | E1, AC5 |
| 5 | Provided DB | `DATABASE_URL` | npm sees that URL; docker never called | step 3 |
| 6 | Docker DB | no URL | `docker run` with `postgres:16`, `127.0.0.1::5432`, `--name prw-sdlc-db-<pid>`; `pg_isready -h 127.0.0.1`; npm gets URL on port 54321; `docker rm -f` after npm | step 4 |
| 6b | Suite fails | npm rc 1 | exit 1; container removed | E5, AC6 |
| 6c | Exit code passthrough | npm rc 7 | exit 7; container removed | E5 |
| 6d | Never ready | docker exec rc 1 | non-zero; exactly 60 `docker exec`; npm not called; container removed | E3 |
| 7 | No DB, no docker | no docker shim | exit 1; `DATABASE_URL or docker` | E2, AC5 |
| 8 | Password secrecy | success, npm fail, not-ready | password and `postgres://app:` never in output | AC6 |
| 8b | Provided URL secrecy | URL with secret, npm rc 1 | secret not in output | AC6 |

Not covered by automated tests (manual): INT/TERM trap (E6), `docker run` / `docker port` failure (E4), real Docker.

## `server/__tests__/scripts/sdlc-gates.test.js`
| Case | Expected | Spec ref |
|---|---|---|
| defines `success_check` | present | step 2 |
| Red gate line (`RED GATE FAILED`) | uses `tests_pass`, not `success_check` | AC7 |
| Implement green gate (line with `GREEN=1` after the `GREEN=0` init) | `success_check` on that line or the one before | AC1 |
| post-Test-repair (`audited repair`) | line uses `success_check` | AC1 |
| post-Review (`after review`, case-insensitive) | line uses `success_check` | AC1 |
| call sites | exactly three non-comment uses | step 2 |
| Test repair pre-check (`$CHECK precheck`) | no `success_check` within 3 lines before | AC7 |
| file contents | contains `integration.log`, `SDLC_INTEGRATION_CI`; no `SDLC_INTEGRATION=` | step 2, AC9 |
| `bash -n` | passes for both scripts | AC8 |
| `README.md`, `CLAUDE.md` | contain `SDLC_INTEGRATION_CI=run`, not `SDLC_INTEGRATION=off` | AC9, step 3 |

Notes for Implement: the post-Review line must contain `after review` and `success_check` together, e.g. `success_check || { echo "Checks broke after review. See $FAIL_LOG"; exit 1; }`. The post-repair `reject` line must keep `audited repair`. The Implement gate's `success_check` must sit on the `GREEN=1` line or the line before it. The three-call-sites test counts non-comment lines mentioning `success_check` other than its definition, so do not mention it in extra echo or prompt lines.
