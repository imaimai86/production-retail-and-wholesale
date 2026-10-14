The slug is the one given above.
Run `node .claude/helpers/sdlc-guard.cjs set review <slug>`.
Review `git diff` since the red-tests commit against `{{BACKLOG_DIR}}/<slug>/specs-1.md` for correctness bugs, edge cases and security. Fix real problems in source only (never a test file: {{TEST_FILES}}). Write a short summary to `{{BACKLOG_DIR}}/<slug>/review-1.md`. `{{TEST_CMD}}` must pass.
