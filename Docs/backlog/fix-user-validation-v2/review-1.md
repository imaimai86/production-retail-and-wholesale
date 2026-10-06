# Review 1: fix-user-validation-v2

Reviewed `git diff 22feb83` against `specs-1.md`.

## Result
No correctness, edge-case or security problems found. No source changes were needed.

## Checked
- `POST /users` (`server/index.js`): the handler runs after `Auth.requireAdmin`, so auth failures take precedence. Validation happens before any `Users.create` call.
  - Missing, null, empty and whitespace-only `name`, and an absent body, return 400 `name is required`. The `req.body || {}` guard covers a missing body.
  - Non-string `name` (number, boolean, object, array) returns 400 `name must be a string`.
  - Only the trimmed `name` is passed to `Users.create`, so `username`, `password` and `role` are never stored. There is no length limit.
- Swagger blocks: `POST /users` now documents the `name` body, 201, 400 and 500, and the summary no longer says "Test update". The `GET /users` item schema has `id` and `name` only.
- `server/openapi-spec.json`, `server/API.md` and `Engineering/bugs.md` are updated as the spec requires.
- `npm test` from the repo root: 21 suites, 436 tests, all passing.

## Not verified
I did not re-run `npm run generate-spec`, so I did not confirm that `openapi-spec.json` matches its output byte for byte. The spec tests pass.
