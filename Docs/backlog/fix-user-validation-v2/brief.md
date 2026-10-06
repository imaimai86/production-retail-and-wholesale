# fix-user-validation-v2

Type: bug
Priority: P2 (normal)
Source: user-pasted server error `null value in column "name" of relation "users" violates not-null constraint` (Postgres code 23502, table `users`, column `name`, from `models/users.js:13` via `index.js:62`); also covers the existing entry "`POST /users` docs list fields the API ignores" in `Engineering/bugs.md`.

## Problem
`POST /users` fails with a 500 when the request has no name. The API docs describe a different request body than the one the code reads, so following the docs triggers the error. Not run against a live server.

## Expected behaviour
Bad requests to `POST /users` get a proper client error instead of a 500, and nothing is created. A valid request keeps working. The docs match what the API really accepts.

## Decisions
- Validate the request before it reaches the database.
- Fix the documentation and regenerate the OpenAPI spec.
- Mark the matching entry in `Engineering/bugs.md` as fixed.

## Scope
- In: the `POST /users` route and its docs, `server/openapi-spec.json`, `Engineering/bugs.md`.
- Out of scope: real authentication and any change to the `users` table.

## Tests
- Add tests for invalid and valid `POST /users` requests, and for the OpenAPI spec.

## Docs
- Update the API docs and the bug entry.

## Open questions
- none
