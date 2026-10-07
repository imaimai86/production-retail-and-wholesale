# Review 1: fix-user-validation-v2

Reviewed `git diff 194364b` against `specs-1.md`. No source changes were needed.

- Check order matches the spec: `Auth.verify` and `Auth.requireAdmin` run first, then body validation, then `Users.create`.
- Every row of the validation table is handled. `null`, `''`, and a missing name give `name is required`. Non-strings give `name must be a string`. Whitespace-only names give `name is required`. Non-object bodies are coerced to `{}`.
- The name is trimmed, and only `{ name }` is passed to the insert, so extra fields are ignored.
- `express.json({ strict: false })` lets top-level primitives such as `"text"` and `null` parse, so they reach the route handler as 400s. Malformed JSON still goes to the existing error handler and returns `400 Bad Request`.
- The swagger comment, `bugs.md` and `API.md` match the spec. I did not check `openapi-spec.json` against `npm run generate-spec`.
- `npm test`: 22 suites and 438 tests pass.

Security: no new issues. Authentication is unchanged, and no user-controlled fields reach the database beyond the trimmed `name`.
