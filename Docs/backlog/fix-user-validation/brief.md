# fix-user-validation

Type: bug
Priority: P2 (normal)
Source: user-pasted server error `null value in column "name" of relation "users" violates not-null constraint` (Postgres code 23502, table `users`, column `name`, from `models/users.js:13` via `index.js:62`); also covers the existing entry "`POST /users` docs list fields the API ignores" in `Engineering/bugs.md`.

## Problem
`POST /users` does no validation. `Users.create` runs `INSERT INTO users(name) VALUES($1)` with whatever `req.body.name` is (`server/models/users.js:12-17`, called from `server/index.js:62`). A request without a usable `name` reaches Postgres, violates `users.name TEXT NOT NULL` (`server/schema.sql:5`) and returns a 500. The OpenAPI JSDoc documents the body as `username`, `password` and `role` (`server/index.js:48-52`, and the response at `:100-102`), which the code ignores, so a client that follows the docs always triggers the 500.

Verified by reading the code and the pasted error: the cause is the missing validation, and the `{"username":...}` body from the docs yields `name = undefined`. Not run against a live server.

## Expected behaviour
`POST /users` with a missing or blank `name` returns 400 `{ "error": "<message>" }` and creates nothing. A valid request is unchanged. The documentation describes the real body (`name`).

## Decisions
- Validation lives in the route handler in `server/index.js`, using the existing `isNonEmptyString` from `server/validation.js`. `Users.create` is not changed.
- `name` must be a string that is non-empty after trimming. Missing, `null`, empty, whitespace-only and non-string values (number, object, array, boolean) return 400 with `{ "error": "name is required" }`. Tests assert the status and a non-empty string `error`, not the exact text.
- The stored value is the trimmed name (the route passes `{ name: name.trim() }` to `Users.create`). Other body fields (`username`, `password`, `role`, anything else) are ignored, as today.
- Order of checks: auth first (`requireAdmin`, 403 as today), then validation (400). A request with a bad token and a bad body still returns 403.
- On 400 nothing is written: `Users.create` is not called.
- Success stays `201` with the created row. `GET /users` is unchanged. No length limit, no uniqueness rule, no schema change, no migration.
- Docs: correct the JSDoc request body to `name` (required string) and the response schema to `id` and `name`; remove `username`, `password` and `role`; add the 400 response. Regenerate `server/openapi-spec.json` with `npm run generate-spec`. Update `server/API.md` if it describes `/users`.
- Mark the matching entry in `Engineering/bugs.md` as fixed (add "Fixed in fix-user-validation." at its end).

## Scope
- In: `server/index.js` (route and JSDoc), `server/openapi-spec.json` (regenerated), `server/API.md`, `Engineering/bugs.md`.
- Out of scope: real authentication, passwords or roles on users, any change to the `users` table, `models/users.js`, mapping Postgres errors to 4xx in general, other endpoints.

## Tests
- Add to `server/__tests__/index.test.js` (the `Users` model is mocked there): `POST /users` with `{}`, `{"name":""}`, `{"name":"   "}`, `{"name":null}`, `{"name":123}`, `{"name":["a"]}` and the old documented body `{"username":"anas","password":"x","role":"user"}` each return 400 with a non-empty string `error` and `Users.create` is not called; `{"name":"  anas  "}` returns 201 and `Users.create` is called with `{ name: "anas" }`; extra fields are not passed to `Users.create`; a wrong `x-auth-token` with a bad body returns 403.
- Add to `server/__tests__/docs/openapi-spec.test.js`: `POST /users` request body has a required `name` property and no `username`, `password` or `role`; the spec has a 400 response for it.

## Docs
- `server/API.md` (if it covers `/users`), the JSDoc in `server/index.js`, `server/openapi-spec.json`, and the bug entry in `Engineering/bugs.md`.

## Open questions
- none
