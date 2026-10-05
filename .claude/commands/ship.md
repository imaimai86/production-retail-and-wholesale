Slug: $ARGUMENTS
1. Run `npm test`; stop if it fails.
2. Run `node .claude/helpers/sdlc-guard.cjs clear`.
3. Commit source + docs as `feat($ARGUMENTS): ...`, tick `- [x] \`$ARGUMENTS\`` in `Docs/backlog/index.md`, commit. Do not push.
