# Review 1: add-test-repair-resume

Reviewed `git diff c2b77d3` against `specs-1.md`. The diff covers `scripts/sdlc.sh`, `scripts/sdlc-testcheck.cjs`, `scripts/sdlc-mod.sh` and `README.md`, plus lockfile churn.

## Matches the spec
- `FROM` validation is the first thing in `sdlc.sh`, before any git call or `mkdir`. Stage ordering and the error text match.
- `FROM=test-repair` skips Implement and keeps `test-issues.md`.
- The Implement WARNING line is printed before the `rm -f`.
- `resumecheck` runs checks 1-4 and the already-repaired check, and reports every failure together.
- The pre-check runs before any agent, and the hint is limited to non-verdict failures.

## Fixed
- `scripts/sdlc-testcheck.cjs` (`resumecheck`): the slug was escaped for the `--grep` pattern with an extended-regex escape set. `git log --grep` uses basic regex by default, so escaping `+ ? | ( ) { }` turns them into GNU operators. The escape now covers only the basic-regex specials `. * ^ $ [ ] \`. This matches how `sdlc.sh` greps, where `(` is literal.

## Noted, no change
- The hint after a repair-agent failure usually stays silent, because the agent may have edited tests and nothing restores them before the hint check. This is consistent with the spec (the hint needs the tests-unchanged check to pass).
- `package-lock.json` and `server/package-lock.json` changed substantially. These look like incidental npm churn unrelated to the spec, so confirm that is intended.
- I did not run `npm test` or `bash -n scripts/sdlc.sh` after the edit, because the permission prompt for the combined command was not approved.
