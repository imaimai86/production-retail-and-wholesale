# Review 1: add-integration-success-check

Reviewed `git diff 92c5e33` against `specs-1.md`. No source changes were needed.

## Checked and correct
- Helper order matches the spec: CI skip (no other command called), script presence, provided `DATABASE_URL`, Docker, then run.
- The Docker container is removed on EXIT, and the INT/TERM traps call `exit`, which fires the EXIT trap. This covers test failure, readiness timeout, `docker run`/`docker port` failure and interrupt.
- The helper exits with the `npm` exit code (`|| rc=$?`).
- The password and URL are never echoed. Error paths print fixed messages only. `docker run` stdout is discarded.
- `pg_isready -h 127.0.0.1` checks over TCP, so the temporary init-time server (unix socket only) is not mistaken for ready.
- `success_check` is used at the Implement green gate, after an accepted Test repair and after Review. The Red tests gate and the Test repair pre-check still use `tests_pass`.
- `FAIL_LOG` is set to the log of whichever check failed, so the exit messages point at the right file.
- The Implement prompt mentions `integration.log` and tells agents not to start Docker.
- No `SDLC_INTEGRATION=` opt-out appears in the code or docs.

## Minor notes (not changed)
- `integration.log` from an earlier attempt stays on disk until overwritten. This is harmless, since the helper truncates it on every run.
- The password is visible in the `docker run` arguments (`ps`) for the life of the throwaway local container. The spec mandates this form.
- The helper assumes it is run from the repo root, as documented.
- I did not run `bash -n` on the two scripts in this review (the command needed approval).
