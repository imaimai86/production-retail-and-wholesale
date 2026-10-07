# Spec: fix-user-validation-v2

Type: bug (P2). Source: brief.md and the binding answers in decisions.md (Q1-Q6, all accepted).

## Problem
`POST /users` returns `500` (Postgres `23502`, null `name`) when the body has no usable `name`. The OpenAPI docs describe `username`, `password` and `role`, which the code ignores (`Users.create` reads only `name`), so a request written from the docs triggers the error.

## Scope
- In: the `POST /users` route and its docs (the swagger comment in `server/index.js`, `server/API.md`), `server/openapi-spec.json`, `Engineering/bugs.md`, tests.
- Out: real authentication, any change to the `users` table, `GET /users`, database error handling.

## Behaviour

### Order of checks
1. Authentication runs first (existing `Auth.verify` / `Auth.requireAdmin`). A missing token returns the existing `401 {"error":"Unauthorized"}` and a non-admin token returns `403 {"error":"Forbidden"}`, regardless of the body.
2. Only for an authorized caller, the body is validated.
3. Only if validation passes is `Users.create` called.

### Input
JSON body with one field:
- `name` (string, required): must contain at least one non-whitespace character (same rule as `isNonEmptyString` in `server/validation.js`). No maximum length. Duplicate names are allowed.

Other fields (`username`, `password`, `role`, anything else) are ignored: they are not stored, not echoed, and never cause a rejection when `name` is valid.

### Validation outcomes (authorized caller)
| Request body | Response | Database call |
|---|---|---|
| `{"name":"Asha"}` | `201` with `{id, name}` | insert |
| `{"name":"  Asha  "}` | `201`, stored and returned `name` is `"Asha"` (trimmed) | insert |
| `{"name":"Asha","username":"a","password":"p","role":"admin"}` | `201` with `{id, name}` only; extra fields ignored | insert |
| missing `name`, `{}`, `{"username":"a"}` | `400 {"error":"name is required"}` | none |
| `{"name":null}` | `400 {"error":"name is required"}` | none |
| `{"name":""}` or whitespace-only | `400 {"error":"name is required"}` | none |
| `{"name":123}`, `{"name":{}}`, `{"name":[]}`, `{"name":true}` | `400 {"error":"name must be a string"}` | none |
| no body, empty body, or a non-object JSON body (`[]`, `"text"`, `null`) | `400 {"error":"name is required"}` | none |
| malformed JSON | `400 {"error":"Bad Request"}` (existing behaviour, unchanged) | none |

Note: `null` is treated as "no name", not as a non-string.

### Error handling
- Real database failures keep returning `500 {"error":"Internal server error"}` through the existing error handler. No Postgres error-code mapping is added. `Users.create` is not called when validation fails.
- A valid request keeps returning `201` with the inserted row `{id, name}`.

## Documentation changes
- The swagger comment for `POST /users` in `server/index.js`: summary becomes "Create a new user" (drop "Test update."); request body is `name` (string, required) only; responses are `201`, `400`, `401`, `403` and `500`. Note that other fields are ignored.
- `server/openapi-spec.json` is regenerated with `npm run generate-spec`, never edited by hand.
- `server/API.md`: the `POST /users` line states that `name` is required, lists the `400` messages, and says other fields are ignored.
- `Engineering/bugs.md`: the entry "`POST /users` docs list fields the API ignores" is marked as fixed.

## Acceptance criteria
1. With a valid admin token, each row of the validation table returns the stated status and body.
2. For every `400` case, `Users.create` is not called and no row is created.
3. A valid request returns `201` with `{id, name}` and the name is the trimmed value; extra fields are absent from the response and are not passed to the insert.
4. A request with no token returns `401` and one with a non-admin token returns `403`, even with an invalid body, and the model is not called.
5. A simulated database failure on a valid request returns `500 {"error":"Internal server error"}`.
6. `server/openapi-spec.json` for `POST /users` documents the request body as `name` (string, required) with no `username`, `password` or `role`, responses `201`, `400`, `401`, `403`, `500`, and the summary "Create a new user". It matches the output of `npm run generate-spec`.
7. `server/API.md` and the `Engineering/bugs.md` entry are updated as described.
8. New tests live in `server/__tests__/` (valid and invalid `POST /users` requests, and the OpenAPI spec); `npm test` passes from the repo root.
