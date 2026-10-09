# remove-gitlab-ci

Type: feature
Priority: P3 (nice to have)
Source: user request (during triage of `run-changed-tests-only`): "remove the gitlab-ci from repo since this is pushed to github".

## Problem
The repo is hosted on GitHub, but `.gitlab-ci.yml` (added by `add-db-integration-tests`) is still in the root. It defines two jobs, `unit` and `integration` (a `postgres:16` service), that no CI system runs. GitHub Actions (`.github/workflows/ci.yml`) is the only CI that runs, and today it runs only the unit tests. Verified by reading both files and `grep -ri gitlab` over `*.md`, `*.sh`, `*.cjs`, `*.yml`, `*.json`, `*.js` (excluding `node_modules`): outside `Docs/backlog/` history, the only reference is `server/__tests__/config/test-setup.test.js:28-32`, which asserts that `.gitlab-ci.yml` exists and checks its content.
Not verified: whether anything outside the repo (a GitLab mirror, project CI/CD variables) still uses the file.

## Expected behaviour
`.gitlab-ci.yml` is gone, no test requires it, and the integration tests still run in CI through GitHub Actions.

## Decisions
- Precondition: start this item only after `run-changed-tests-only` is merged. That item adds the GitHub Actions `integration` job (a `postgres:16` service running `npm run test:integration` or the changed-file selection), which replaces the GitLab `integration` job. If it is not merged, deleting the file would leave the integration tests running nowhere in CI.
- Delete `.gitlab-ci.yml`.
- In `server/__tests__/config/test-setup.test.js`, remove the `describe('.gitlab-ci.yml', ...)` block (lines 28 onward for that block, with its content checks) and add one test asserting that `.gitlab-ci.yml` does not exist. Keep every other test in that file unchanged.
- Add one test (same file) asserting that `.github/workflows/ci.yml` contains a job named `integration` using `postgres:16`, so the coverage the GitLab file provided is still asserted.
- Backlog history (`Docs/backlog/**` briefs, specs and reviews that mention GitLab, and the title of the completed item `add-db-integration-tests` in `Docs/backlog/index.md`) is not edited.
- `README.md`, `CLAUDE.md` and `AGENTS.md` have no GitLab mention (checked), so no doc edit is needed unless the Plan stage finds one.

## Scope
- In: `.gitlab-ci.yml` (delete), `server/__tests__/config/test-setup.test.js`.
- Out of scope: `.github/workflows/ci.yml` (changed by `run-changed-tests-only`), any GitLab project settings or CI/CD variables, the SDLC scripts, backlog history.

## Tests
- `server/__tests__/config/test-setup.test.js`: `.gitlab-ci.yml` does not exist; `.github/workflows/ci.yml` has an `integration` job with `postgres:16`; the remaining existing tests in the file still pass.

## Docs
- none

## Open questions
- none
