Slug: $ARGUMENTS
Use a subagent so the main context stays small.
1. Read `Docs/backlog/$ARGUMENTS/specs-1.md` and `plan-1.md`.
2. Write `Docs/backlog/$ARGUMENTS/test-cases-1.md` and matching Jest tests under `server/__tests__/` (mirror the source layout). Change nothing else.
   Tests verify the real code: every test must import or run the code under test (a function, a script, an endpoint, a plugin handler). NEVER write a test that reads, greps or asserts on the text of documentation (README.md, CLAUDE.md, AGENTS.md, any *.md, Docs/, API docs, comments). Documentation is checked in the Review stage, not by a test. A test that still passes when the feature code is missing is a defect.
3. Run `npm test`. It MUST fail. If it passes, the tests are not testing new behaviour: fix them.
4. Commit docs and tests: `test($ARGUMENTS): add failing tests`. Print the commit SHA.
