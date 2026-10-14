The slug is the one given above.
1. Run `{{TEST_CMD}}`; stop if it fails.
2. Run `node .claude/helpers/sdlc-guard.cjs clear`.
3. Commit source + docs as `feat(<slug>): ...`, tick `- [x] \`<slug>\`` in `{{BACKLOG_DIR}}/index.md`, commit. Do not push.
