Slug: $ARGUMENTS
Run `node .claude/helpers/sdlc-guard.cjs set review $ARGUMENTS`.
Review `git diff` since the red-tests commit against `Docs/backlog/$ARGUMENTS/specs-1.md` for correctness bugs, edge cases and security. Fix real problems in source only (never `server/__tests__/`). Write a short summary to `Docs/backlog/$ARGUMENTS/review-1.md`. `npm test` must pass.
