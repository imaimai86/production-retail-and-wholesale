Slug: $ARGUMENTS
Use a subagent so the main context stays small.
1. Read `Docs/backlog/$ARGUMENTS/specs-1.md` and `plan-1.md`.
2. Write `Docs/backlog/$ARGUMENTS/test-cases-1.md` and matching Jest tests under `server/__tests__/` (mirror the source layout). Change nothing else. For every bullet in the plan's `## DB and API changes` section (unless it is `- none`) also write integration tests in `server/__tests__/integration/` (like `api.integration.test.js`), with the bullet's text in a `describe` or `test` title, and add an `## Integration tests` section to `test-cases-1.md`. Never read, scan or assert on the text of a test file.
3. Run `npm test`. It MUST fail. If it passes, the tests are not testing new behaviour: fix them. Then check `node scripts/sdlc-integration-gate.cjs plan Docs/backlog/$ARGUMENTS/plan-1.md server/__tests__` and run `bash scripts/sdlc-integration.sh`: the integration tests MUST fail too (exit code 1).
4. Commit docs and tests: `test($ARGUMENTS): add failing tests`. Print the commit SHA.
