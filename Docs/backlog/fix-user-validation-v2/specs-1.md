# Spec: fix-user-validation-v2

Type: bug, P2. Binding decisions: `decisions.md` Round 1 (Q1 to Q5, all accepted).

## Problem
`POST /users` passes the raw request body to the database. A request without a `name` inserts NULL and fails the `users.name` NOT NULL constraint (Postgres 23502), so the client gets a 500. The Swagger docs for the route list `username`, `password` and `role`, which the code ignores and the `users` table does not have (it has only `id` and `name`), so a client following the docs triggers the error.

## Behaviour: `POST /users`
Admin-only (existing `Auth.requireAdmin`, unchanged). The request is validated after the auth checks and before any database call.

### Input
JSON body with one field:
- `name` (string, required).

Unknown fields (for example `username`, `password`, `role`) are ignored: they are not rejected, not stored and not returned.

### Validation rules
1. `name` missing, `null`, an empty string or whitespace-only: `400 { "error": "name is required" }`.
2. `name` present but not a string (number, boolean, object, array): `400 { "error": "name must be a string" }`.
3. Otherwise valid. The name is trimmed of leading and trailing whitespace before it is stored.
4. No maximum length. Only a non-empty string after trimming is required.

A body that is not an object with a `name` (for example `{}` or an empty body) falls under rule 1.

### Success
`201` with the created user as JSON: `{ "id": <integer>, "name": "<trimmed name>" }`. For example, `{"name": "  Bob "}` creates a user named `Bob` and the response returns `Bob`.

### Error cases
| Condition | Status | Body |
|---|---|---|
| Missing, null, empty or whitespace-only `name` | 400 | `{ "error": "name is required" }` |
| Non-string `name` | 400 | `{ "error": "name must be a string" }` |
| Missing or invalid admin token | unchanged (existing auth behaviour) | unchanged |
| Database or other unexpected failure | unchanged (500 via the error handler) | unchanged |

In every 400 case no database call is made and no user row is created. Auth failures take precedence over validation failures.

## Documentation
1. `POST /users` Swagger block in `server/index.js`:
   - Request body: required object with one required string property `name`. Remove `username`, `password` and `role`.
   - Responses: 201 (user created, schema `id` integer and `name` string), 400 (invalid `name`, with the error body above), 500 (server error). Keep the existing auth responses if the other blocks document them.
   - Summary: remove the stray text "Test update.", leaving "Create a new user".
2. `GET /users` Swagger block: the 200 response item schema has the properties `id` (integer) and `name` (string). Remove `username` and `role`. Behaviour of the route is unchanged.
3. `server/openapi-spec.json` is regenerated from the JSDoc comments with `npm run generate-spec` (in `server/`), not hand-edited, so it matches the blocks above.
4. `server/API.md`: expand the `POST /users` entry to state the `name` field, the 201 response and the 400 error messages.
5. `Engineering/bugs.md`: mark the entry "`POST /users` docs list fields the API ignores" as fixed. The other entries are untouched.

## Out of scope
Real authentication, any change to the `users` table or `schema.sql` or migrations, `Users.create`'s query, and the `GET /users` route logic.

## Acceptance criteria
Tests follow the layout in `server/__tests__/` (route tests in `index.test.js` style with `Users` mocked; spec test reads `server/openapi-spec.json`).

1. `POST /users` with `{ "name": "Bob" }` and the admin token returns 201 with the user (`name` `Bob`), and `Users.create` is called once.
2. `{ "name": "  Bob " }` returns 201 and the stored and returned name is `Bob`.
3. A body with a valid `name` plus `username`, `password` and `role` returns 201, and the extra fields are not passed to the database.
4. Each of these returns 400 `{ "error": "name is required" }` and `Users.create` is not called: `{}`, no body, `{ "name": null }`, `{ "name": "" }`, `{ "name": "   " }`, and a body with only the legacy fields `{ "username": "a", "password": "b", "role": "c" }`.
5. Each of these returns 400 `{ "error": "name must be a string" }` and `Users.create` is not called: `{ "name": 5 }`, `{ "name": true }`, `{ "name": {} }`, `{ "name": ["Bob"] }`.
6. A very long name (for example 10,000 characters) is accepted with 201.
7. Without the admin token the route still returns the existing auth error, even when the body is invalid.
8. `server/openapi-spec.json` for `POST /users`: the request body schema has the property `name` (string, required) and no `username`, `password` or `role`; responses include 201 and 400; the summary does not contain "Test update".
9. `server/openapi-spec.json` for `GET /users`: the 200 item schema has `id` and `name` only.
10. The committed `server/openapi-spec.json` equals the output of `npm run generate-spec` (it was regenerated).
11. `Engineering/bugs.md` shows the `POST /users` docs entry as fixed.
12. The existing tests, including "create and list users", still pass, and `npm test` passes from the repo root.
