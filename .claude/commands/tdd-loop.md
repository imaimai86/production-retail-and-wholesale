Slug: $ARGUMENTS
1. Read `Docs/backlog/$ARGUMENTS/plan-1.md`; write `test-cases-1.md` and failing Jest tests under `server/__tests__/`, plus failing integration tests in `server/__tests__/integration/` for every bullet of the plan's `## DB and API changes` section (unless `- none`). Run `npm test` and `bash scripts/sdlc-integration.sh` and confirm they fail.
2. Then edit source (never the tests) until `npm test` passes.
