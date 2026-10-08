# Review 1: require-integration-tests

Reviewed `git diff 5a8dd14` and the new `scripts/sdlc-integration-gate.cjs` against `specs-1.md`.

## Fixed
- **Infrastructure failure counted as a red result (R2).** The "could not determine database container port" error exited 1, which the Red gate reads as "integration tests failed" (pass). It now exits 3. A failing `docker run` (daemon down) also leaked docker's own exit code under `set -e`; it now prints an error and exits 3.
- **Red gate accepted any non-0/non-3 code as red.** Only exit 1 means failing tests. Any other code (for example 130 or 143 from a signal) now stops the run with an error, so an aborted check cannot pass the gate.
- **Renamed files hid source changes.** Git rename detection produced a `diff --git a/old b/new` header the gate could not parse, so a file renamed into a source path was ignored. The gate now uses `--no-renames`.

## Checked, no change needed
- `plan` parsing, `- none` handling, staging before the check, CI skip logic and the verdict table match sections 3 and 4.
- `INT_RED_SHA` uses the latest matching commit and stops the run when none exists.
- The diff gate runs after each Implement attempt and after Review, using the original red commit.

## Remaining notes
- Untracked new source files are not seen by the diff gate (accepted limitation, 5.3).
- Comment filtering is line-prefix based, so a code line beginning with `*` or `--` counts as a comment.
- R1: the container-not-ready exit 3 needs a real container to test.
