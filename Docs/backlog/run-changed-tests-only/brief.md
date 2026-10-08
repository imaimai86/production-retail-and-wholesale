# run-changed-tests-only

Type: feature
Priority: P2 (normal)
Source: user request: "run tests corresponding to changed files only in an mr. Is it possible for integration tests as well? How to identify the exact tests to run". Answered with the user: GitHub Actions only (the repo is pushed to GitHub); `.gitlab-ci.yml` is removed by the separate item `remove-gitlab-ci`.

## Problem
Pull-request CI always runs everything. `.github/workflows/ci.yml` has one job, `build-and-test` (on `pull_request`, Node 18): `./install.sh`, `npm run lint --prefix server`, then `npm run test` (the whole unit suite). It does not run the integration suite at all, and its checkout is shallow (`actions/checkout@v3` default, depth 1), so it cannot compare with the base branch.

Verified on 2026-10-08 by running `npx jest --listTests --findRelatedTests <file>` in `server/` (it lists and runs nothing):
- `jest --findRelatedTests` follows the import graph from the changed files to the tests that load them. `models/users.js` selects `__tests__/index.test.js` and `__tests__/models/users.test.js` (unit), and, with the integration ignore pattern overridden, also `__tests__/integration/api.integration.test.js`.
- `--testPathPattern` does NOT filter the list when `--findRelatedTests` is given: the integration command still returned the two unit tests. The unit and integration tests therefore have to be separated by path after listing.
- It selects NOTHING for files outside the import graph: `migrations/001_initial.sql`, `package.json`, `../scripts/sdlc-mod.sh`, `../scripts/sdlc-testcheck.cjs` (tests reach the scripts through `child_process` or by reading them as text). Several tests also read `README.md`, `CLAUDE.md`, `Engineering/bugs.md` and `server/openapi-spec.json` as text.
- A deleted file cannot be traced after it is gone.
Not verified: behaviour with a large diff, and a real GitHub Actions run (nothing was run there).

## Expected behaviour
On a pull request, CI runs only the unit tests and the integration tests related to the changed files, and prints which tests it chose and why. Whenever it cannot be sure (any changed file outside `server/**/*.js`, a deleted or renamed file, an empty diff), it runs the whole suite instead. On a push to `main` it always runs everything.

## Decisions
- Scope: GitHub Actions only (`.github/workflows/ci.yml`). `.gitlab-ci.yml` is not touched here (item `remove-gitlab-ci` deletes it).
- New script `scripts/test-changed.cjs`, run from the repo root: `node scripts/test-changed.cjs <unit|integration> [--base <ref>] [--list]`. Missing or other kind: usage error, exit 2.
- Base: `--base`, else `origin/$GITHUB_BASE_REF` when that variable is set, else `origin/main`. Changed files = `git diff --name-status <merge-base>..HEAD`, where `<merge-base>` is `git merge-base <base> HEAD`; uncommitted files are not considered. If the base or merge-base cannot be resolved: run everything and print why (never fail on that).
- A path counts as related-selectable only if it matches `server/**/*.js` and exists after the change. Anything else forces the full suite, including: `server/migrations/**`, `server/script/**`, `package.json`, `package-lock.json`, `server/package.json`, `server/package-lock.json`, `.github/**`, `scripts/**`, `*.md`, `Docs/**`, `Engineering/**`, `server/openapi-spec.json`. A deleted file, or the old side of a rename, forces the full suite. An empty diff runs the full suite. The first path that forced "all" is printed.
- Selection: list with `npx jest --listTests --json --findRelatedTests <selectable files>` in `server/`, with `--testPathIgnorePatterns=/node_modules/` so integration tests are listed too, then split the result by path: files under `__tests__/integration/` are integration tests, the rest unit. A changed test file selects itself.
- Running: `unit` runs the unit part with `jest --runTestsByPath <files>`; `integration` runs the integration part with `jest --runInBand --runTestsByPath <files>` (same flags as `npm run test:integration`, and the integration ignore pattern overridden). No selected tests of that kind: print `no <kind> tests related to the changes`, exit 0. Otherwise exit with jest's exit code. In full mode run `npm test` (unit) or `npm run test:integration`.
- `--list` prints `mode: all (<reason>)` or `mode: related` followed by the selected test files, one per line, and runs nothing. The normal run prints the same header before running.
- Root `package.json` gets `"test:changed": "node scripts/test-changed.cjs"` (arguments pass through `npm run test:changed -- unit --base origin/main`).
- Workflow: `actions/checkout` gets `fetch-depth: 0`. Triggers become `pull_request` and `push` to `main`. Keep the existing job named `build-and-test` (lint unchanged, full) and change its test step: on `pull_request` run `node scripts/test-changed.cjs unit`; on `push` run `npm run test`. Add a job `integration` with a `postgres:16` service (throwaway values `app`/`app`/`app`, same as the old GitLab job, `DATABASE_URL=postgres://app:app@localhost:5432/app` with the service port mapped), Node 18, `npm ci --prefix server`; on `pull_request` run `node scripts/test-changed.cjs integration`, on `push` run `npm run test:integration`. No secrets are involved.
- Residual risk, accepted: related-test selection follows static imports only, so a missed dependency can pass on a pull request and fail on `main`. That is why `main` runs everything and why unmappable files force the full suite.

## Scope
- In: `scripts/test-changed.cjs` (new), `.github/workflows/ci.yml`, root `package.json` (script), `server/__tests__/scripts/test-changed.test.js` (new), `server/__tests__/config/` or `server/__tests__/docs/` wiring test for the workflow (new file, see Tests), `README.md`, `CLAUDE.md` (Commands table).
- Out of scope: `.gitlab-ci.yml` (item `remove-gitlab-ci`); `scripts/sdlc.sh`, `scripts/sdlc-integration.sh` and every SDLC gate (they always run the full suite); lint selection; caching, sharding or coverage; branch-protection settings and required-check names (the job name `build-and-test` is kept so any existing requirement keeps working); a test-to-source mapping table.

## Tests
- `server/__tests__/scripts/test-changed.test.js`:
  - classification table (pure function, no git): a `server/**/*.js` change is selectable; each of the "forces all" paths listed above forces all with the right reason; a deletion and a rename force all; an empty list forces all.
  - changed-file computation against a temporary git repository (`git init`, local user config, a `main` branch and a feature branch): added, modified, deleted and renamed files, merge-base used (a later commit on the base branch is not listed), base missing gives "all" with a reason and exit 0.
  - selection against a small fixture project in a temporary directory (`server/package.json` with the same jest ignore pattern, one module, one unit test and one integration test that import it, plus an unrelated unit test): `--list unit` and `--list integration` return only the related tests of that kind. The fixture uses the repo's jest binary (path passed through an environment variable such as `JEST_BIN`).
  - usage errors exit 2.
- Wiring test (text assertions on `.github/workflows/ci.yml`): `fetch-depth: 0`, both triggers, the job `build-and-test` with `node scripts/test-changed.cjs unit` for pull requests and `npm run test` for pushes, a job `integration` with `postgres:16` running `node scripts/test-changed.cjs integration` and `npm run test:integration`; and that root `package.json` has the `test:changed` script.

## Docs
- `README.md`: a short CI section: what is selected on a pull request, when the full suite runs, how to try it locally (`npm run test:changed -- unit --list`).
- `CLAUDE.md`: one row in the Commands table for `npm run test:changed`.

## Open questions
- none
