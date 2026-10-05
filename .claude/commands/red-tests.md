Slug: $ARGUMENTS
Use a subagent so the main context stays small.
1. Read `Docs/backlog/$ARGUMENTS/specs-1.md` and `plan-1.md`.
2. Write `Docs/backlog/$ARGUMENTS/test-cases-1.md` and matching Jest tests under `server/__tests__/` (mirror the source layout). Change nothing else.
3. Run `npm test`. It MUST fail. If it passes, the tests are not testing new behaviour: fix them.
4. Commit docs and tests: `test($ARGUMENTS): add failing tests`. Print the commit SHA.
