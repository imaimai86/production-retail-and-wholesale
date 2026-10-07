# Review 1: retry-unclaimed-failing-test

Reviewed `git diff 573be52` against `specs-1.md`. The flow in `sdlc.sh` and the docs match the spec. Two real problems were found and fixed in `scripts/sdlc-testcheck.cjs`.

## Fixed
1. **False flaky verdicts (correctness).** `merge-retry` treated a retried key as flaky when it was merely present in the re-run JSON and not failed. With `-t`, tests that do not match the pattern come back as `pending` (skipped). If the pattern missed the test, for example because `norm` collapsed whitespace in the name, the test counted as flaky and a real failure was waved through. A key is now flaky only when its status in the re-run is `passed` (new `passed` set in `collect`).
2. **`retry-plan` key split (edge case).** It split `<file>::<name>` on the last `::`, so a test name containing `::` produced a wrong file and name. It now splits on the first `::`, since file paths never contain it.

## Checked, no change needed
- Claimed keys are never in the retry set, so they are never marked flaky.
- `<suite failed to run>` keys re-run the whole file and are flaky only if the file's status is `passed`.
- Unreadable or missing re-run JSON is treated as having no results, so the keys stay failing.
- The empty retry set returns early with no jest run and no files.
- Stale `retry-*.json` files are removed before each run.
- `flaky-tests.md` lives under the git-ignored `Docs/backlog/*/logs/`.

## Not changed
- `package-lock.json` and `server/package-lock.json` are modified in the working tree (about 900 lines removed). They are unrelated to the spec and probably come from `npm install` in the session hook. They should not be committed with this feature. I could not revert them here because the command needed approval.
- I did not run the tests: the guard blocked running the `server/__tests__` suite in this stage.
