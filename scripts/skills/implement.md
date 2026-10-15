The slug is the one given above.
1. Run `git log --oneline -5` and find the `test(<slug>): add failing tests` commit; its SHA is RED_SHA.
2. Run `node .claude/helpers/sdlc-guard.cjs set implement <slug> <RED_SHA>` (turns on the test-protection and green-gate hooks).
3. Read `{{BACKLOG_DIR}}/<slug>/plan-1.md`. Edit source files only, never a test file ({{TEST_FILES}}), until `{{TEST_CMD}}` passes. Max 4 attempts; if still red, stop and report.
4. Confirm `git diff --name-only <RED_SHA> -- {{TEST_PATHSPECS}}` is empty.
