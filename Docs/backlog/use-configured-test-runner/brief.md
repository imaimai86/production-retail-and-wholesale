# use-configured-test-runner

Type: feature
Priority: P2 (normal)
Source: user request in the triage conversation: "extend support for multiple test framework other than jest ... use them dynamically. Also the test path should be configurable". Second of three items; depends on `add-test-framework-registry` (run it after that item is merged into `main`).

## Problem
The pipeline's gates are Jest-specific: `tests_pass` runs `$TEST_CMD` (`scripts/sdlc.sh:202`), `jest_json_at` and `jest_json_now` run `npx jest --json` in `server/` (`:211-226`), `retry_unclaimed` runs `npx jest <file> -t <pattern>` (`:235-236`), the guards diff `$TEST_DIR` (`:240`, `:334`, `:350`, `:368`, `:392`), `scripts/sdlc-testcheck.cjs` parses Jest JSON (`collect`, `fileOf`) and hard-codes `server/__tests__` (`:16`), and the prompts say "Jest tests" (`scripts/prompts/prompt-red-tests.md:2`). Another framework or another test path cannot be used. Verified by reading these files; nothing was run.

## Expected behaviour
The pipeline reads the effective config from `add-test-framework-registry` (`node scripts/sdlc-frameworks.cjs list --json`) and runs every gate through the configured framework and path. With no `.sdlc/test-frameworks.json` the behaviour, logs and gate decisions are identical to today.

## Decisions
- What a framework must give each gate, all supplied by the catalog and its adapter:
  - Red tests gate ("new tests fail before implementation", `sdlc.sh:302`): the exit code of `runAll`.
  - Implement green (`success_check`): the same `runAll` exit code for every configured entry, then the unchanged integration suite.
  - Test repair (`jest_json_at`, `jest_json_now`, `precheck`, `namecheck`, `redcheck`): a raw JSON file produced by `runAll`, passed through `normalize`; `sdlc-testcheck.cjs` reads only the neutral shape (`tests[]`, `suiteErrors[]`), never a framework's raw JSON.
  - Flaky retry (`retry_unclaimed`, `retry-plan`, `merge-retry`): the `runFile` and `runName` argv templates; the test name is escaped for the framework's pattern option (regex-escaped) and passed as one argv element.
- Several entries: every entry runs; a gate passes only when all entries pass; the neutral results are merged into one (file paths are repo-relative, so entries never collide). `TEST_DIR` becomes the list of configured paths: the guards (`GUARD FAILED`, `git checkout "$RED_SHA" -- <paths>`, `src_hash`, the `testcheck` diffs) work on all of them.
- `scripts/sdlc.sh` replaces the constants `TEST_CMD` and `TEST_DIR` with values read once at startup from the helper. `TEST_CMD` for the default Jest entry stays `npm test`, so the default run is the same command. `{{TEST_DIR}}` expands to the paths joined by a space; `{{TEST_CMD}}` to the entry commands joined by ` && `; a new placeholder `{{TEST_FRAMEWORK}}` expands to the framework labels. The Red tests prompt says "{{TEST_FRAMEWORK}} tests" instead of "Jest tests" and tells the agent to put each new test under the entry whose path matches the code under test, and the first configured entry when unsure.
- Config errors stop the pipeline before any stage: invalid or overlapping config, a framework not installed (the message names `sdlc-mod.sh framework install <id> --yes`), or a configured path that does not exist, exit 1 with the helper's message. The pipeline never installs anything by itself.
- `scripts/sdlc-testcheck.cjs` takes the test directories from the environment variable `SDLC_TEST_PATHS` (space-separated) set by `sdlc.sh`, defaulting to `server/__tests__`; `rel` and `fileOf` no longer assume `server/`.
- `scripts/sdlc-integration.sh` and the integration suite are unchanged: they run the repo's own `test:integration` script, whatever framework it uses.
- The weak-assertion and skip detectors in `sdlc-testcheck.cjs` (`WEAK`, `SKIP`) stay as they are (they match `expect`-style and `.skip`/`.only` text used by all three catalog frameworks); frameworks with other syntax are out of scope.

## Scope
- In: `scripts/sdlc.sh`, `scripts/sdlc-testcheck.cjs`, `scripts/prompts/*.md` (placeholders and wording only), and `scripts/sdlc-frameworks.cjs` only if a small read command for `sdlc.sh` is missing.
- Out of scope: the registry, config file and install command (`add-test-framework-registry`); the pane; the integration suite; the source directory (`server`, in `src_hash`), which stays fixed; frameworks outside the catalog.

## Tests
- `server/__tests__/scripts/sdlc-testcheck.test.js` and `server/__tests__/scripts/sdlc-gates.test.js` (extend): the checks accept the neutral result for jest, vitest and mocha inputs; `precheck`, `namecheck`, `redcheck`, `unclaimed` and `merge-retry` give the same verdicts as before for Jest inputs; `SDLC_TEST_PATHS` with two directories is honoured by the diff and untracked-file checks; the default when unset is `server/__tests__`.
- `server/__tests__/scripts/sdlc-test-runner.test.js` (new): run the pipeline's run and retry command builders against a temp git repo with a stub framework bin on `PATH` and a config for each of the three catalog frameworks: the exact argv for `runAll`, `runFile`, `runName` (a name with quotes, spaces and regex characters stays one escaped argument); two disjoint entries both run and the gate fails when either fails; the default config runs `npm test`; a missing framework, a missing path and an overlapping config exit 1 before any stage with the helper's message.
- `server/__tests__/scripts/sdlc-manual-input.test.js` (extend): the placeholders `{{TEST_DIR}}` (several paths), `{{TEST_CMD}}` and `{{TEST_FRAMEWORK}}` expand in the rendered prompts.
- Every case runs the real code. Integration tests: none, there is no database or API change.

## Docs
- `README.md`: how the pipeline picks its framework and test paths from the config, and the errors above.
- `CLAUDE.md`: replace "Jest" wording where it describes the pipeline's tests, keeping `npm test` as the repo's own command.

## Open questions
- With several entries, should the Red tests agent choose the entry, or should the Spec stage name it? Recommended (used above): the agent chooses by the code under test, first entry when unsure; this avoids an extra Spec question round.
