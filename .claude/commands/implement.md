Slug: $ARGUMENTS
1. Run `git log --oneline -5` and find the `test($ARGUMENTS): add failing tests` commit; its SHA is RED_SHA.
2. Run `node .claude/helpers/sdlc-guard.cjs set implement $ARGUMENTS <RED_SHA>` (turns on the test-protection and green-gate hooks).
3. Read `Docs/backlog/$ARGUMENTS/plan-1.md`. Edit source files only, never `server/__tests__/`, until `npm test` passes. Max 4 attempts; if still red, stop and report.
4. Confirm `git diff --name-only <RED_SHA> -- server/__tests__` is empty.
