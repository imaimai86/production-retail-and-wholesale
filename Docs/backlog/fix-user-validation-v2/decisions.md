
## Round 1 (2026-10-07)

### Q1: What counts as a valid `name`?
The brief says "no name" gives a 500 but not what makes a name invalid. Today `Users.create` reads only `name`. Existing routes use `isNonEmptyString` (a string with non-whitespace content) and return `400 {"error":"<field> is required"}`. The rule must be fixed so tests and docs agree: missing, `null`, empty or whitespace-only, and non-string values (number, object, array) are candidates for rejection. Also undecided: whether to trim the stored name, and whether to cap its length (the column is unbounded `TEXT`).
**Suggested:** `name` must be a string with at least one non-whitespace character (`isNonEmptyString`). Anything else (missing, null, empty, whitespace-only, non-string) returns `400 {"error":"name is required"}` (same shape as the other routes), except non-strings, which return `400 {"error":"name must be a string"}`. The stored name is the trimmed value. No maximum length.
**Answer:** accept

### Q2: How are the documented-but-ignored fields (`username`, `password`, `role`) handled in a request?
The brief says the docs will be fixed to match the API, which reads only `name`. It does not say what happens when a client still sends `username`, `password` or `role`, possibly alongside a valid `name`. Silently ignoring a `password` is risky because the client may think it was stored. Rejecting breaks clients that follow the old docs but also send `name`.
**Suggested:** Ignore unknown fields: a request with a valid `name` succeeds with `201` and the extra fields are not stored or echoed. A request without a valid `name` returns `400` as in Q1, even if `username` is present. The docs list only `name` and state that other fields are ignored.
**Answer:** accept

### Q3: What is the response for a valid request, and are duplicate names allowed?
The brief says a valid request "keeps working". Currently it returns `201` with the inserted row (`{id, name}`). The `users` table has no unique constraint on `name`, and the table must not change (out of scope), so two users can share a name.
**Suggested:** Keep `201` with the created row `{id, name}` (name as stored, trimmed per Q1). Duplicate names stay allowed; no `409`.
**Answer:** accept

### Q4: How should a non-object or missing JSON body be handled?
`POST /users` with no body or a body such as `[]`, `"text"` or `null` makes `req.body` empty or not an object. Malformed JSON already returns `400 {"error":"Bad Request"}` (see `server/API.md`). Whether these cases get the same `name is required` message as Q1 or their own message affects the tests.
**Suggested:** An empty, missing or non-object body (array, string, null) is treated as having no `name` and returns `400 {"error":"name is required"}`. Malformed JSON keeps its existing `400 {"error":"Bad Request"}`.
**Answer:** accept

### Q5: How is the order of authentication and validation defined, and what status codes does the OpenAPI spec document?
`POST /users` is guarded by `Auth.requireAdmin`. The brief does not say whether validation runs before or after the auth check, and which responses the regenerated spec lists. The spec currently lists only `201` and `500`.
**Suggested:** Auth runs first: a missing or wrong token still returns its existing `401`/`403` regardless of the body, and an invalid body returns `400` only for an authorized caller. The spec for `POST /users` documents the request body as `name` (string, required), and responses `201`, `400`, `401`/`403` (as the existing auth middleware returns them) and `500`. The odd summary "Create a new user. Test update." is replaced by "Create a new user". `server/openapi-spec.json` is regenerated with `npm run generate-spec`, not edited by hand.
**Answer:** accept

### Q6: Should the DB unique/other constraint errors or other database failures change?
The brief limits the fix to validation before the database. A genuine database failure (connection down, for example) should presumably stay a `500 {"error":"Internal server error"}`, and a `23502` on `name` should no longer be reachable. Confirming avoids adding error-code mapping that is not wanted.
**Suggested:** No change to database error handling: real DB failures still return the existing `500 {"error":"Internal server error"}`. No mapping of Postgres error codes is added; the only fix is validating before the insert, and `Users.create` is not called when validation fails.
**Answer:** accept
