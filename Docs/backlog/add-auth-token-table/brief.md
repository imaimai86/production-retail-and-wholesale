# add-auth-token-table

Type: feature
Priority: P1 (blocks use)
Source: triage scan of `server/`; user decisions in the triage conversation (admin user row, `auth_tokens` table with several tokens per user, reject sales without a user id).

## Problem
`Auth.verify` (`server/middleware/auth.js:2-9`) accepts any non-empty `x-auth-token` and stores the raw header in `req.userId`. `POST /sales` (`server/index.js`, `Sales.create({ ...req.body, user_id: req.userId })`) writes that string into `sales.user_id`, which is `INTEGER REFERENCES users(id)` (`server/schema.sql`). Any token that is not the numeric id of an existing user, including `ADMIN_TOKEN`, makes the insert fail and the request returns 500. This is verified from the code and the schema; it was not run against a database.

There is no table that maps a token to a user, and the admin (`ADMIN_TOKEN`, an env value) has no row in `users`, so no request can be attributed to a user id.

## Expected behaviour
- Every request resolves to a user id: a token in the new `auth_tokens` table maps to its user, and `ADMIN_TOKEN` maps to an `admin` user row.
- `POST /sales` records that user id in `sales.user_id` and never fails with 500 because of the token.
- `POST /sales` from a request with no resolved user id is rejected with 401 and changes nothing.
- One user can have several tokens (for example `app` and `web`), so the future login feature can store each issued JWT here.

## Decisions
- New migration `server/migrations/003_auth_tokens.sql` (`BEGIN`/`COMMIT`, idempotent like `002_sales_location.sql`), mirrored in `server/schema.sql`:
  - `auth_tokens(id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, client TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)` and an index on `user_id`.
  - No uniqueness on `(user_id, client)`: a user may hold several tokens, including several for the same client.
  - `client` is free text such as `app` or `web`; no allowed-values list in this item.
- `token_hash` is the lowercase hex SHA-256 of the raw token (Node `crypto`). Raw tokens are never stored, logged or returned.
- The same migration and `schema.sql` insert the admin user once: `INSERT INTO users(name) SELECT 'admin' WHERE NOT EXISTS (SELECT 1 FROM users WHERE name = 'admin')`. The admin user is the lowest-id `users` row named `admin`. `users` gets no new columns.
- `ADMIN_TOKEN` is never stored in the database.
- New model `server/models/authTokens.js` with `findUserIdByHash(hash)` (returns the user id or `null`) and `findAdminUserId()` (returns the id or `null`).
- `Auth.verify` becomes async and still returns 401 `{ "error": "Unauthorized" }` when the header is missing, exactly as today. With a header it sets `req.userId` to an integer or `null`, in this order: (1) if `process.env.ADMIN_TOKEN` is non-empty and equals the header, the admin user id; (2) the `auth_tokens` match for the header's hash; (3) `null`. It never rejects an unknown token itself: every endpoint except `POST /sales` behaves as today (replacing that is the separate JWT login item).
- A database error during the lookup goes to `next(err)` (generic 500 from `errorHandler`).
- `Auth.requireAdmin` is unchanged.
- `POST /sales`: if `req.userId` is `null`, return 401 `{ "error": "Unauthorized" }`. This check runs before body validation (401, then 400, then 404, then 409), and nothing is written.
- Existing `sales` rows are not changed and `sales.user_id` gets no `NOT NULL` constraint in this item.
- No endpoint creates tokens in this item. Until the login feature exists, tokens are added directly in the database, so only the admin can create sales through the API. Note this in the docs.

## Scope
- In: `server/migrations/003_auth_tokens.sql`, `server/schema.sql`, `server/models/authTokens.js`, `server/middleware/auth.js`, `server/index.js` (`POST /sales` and its swagger comment), `server/openapi-spec.json` (regenerate with `npm run generate-spec`).
- Out of scope: login, JWT, passwords, roles and ACL (see `add-jwt-login-acl`); token expiry or revocation; making `sales.user_id` `NOT NULL`; changing other endpoints' auth; `GET /users` and `POST /users`.

## Tests
- `server/__tests__/middleware/auth.test.js`: missing header gives 401; `ADMIN_TOKEN` gives the admin id; a known token gives its user id; an unknown token gives `null` and `next()` is still called; an empty `ADMIN_TOKEN` env value never matches; a lookup error reaches `next(err)`.
- `server/__tests__/models/authTokens.test.js`: both functions with a mocked `db`; the hash is SHA-256 hex.
- `server/__tests__/migrations/003_auth_tokens.test.js` (mirrors `002_sales_location.test.js`): the SQL creates the table, the unique hash, the index and the guarded admin insert.
- `server/__tests__/index.test.js`: `POST /sales` with `userId` `null` returns 401 and `Sales.create` is not called; with an id, `Sales.create` receives that integer as `user_id`.
- `server/__tests__/integration/api.integration.test.js` (real Postgres): a sale with `ADMIN_TOKEN` stores the admin id; a sale with a token from `auth_tokens` stores that user's id; two tokens of one user both work; an unknown token gets 401 and neither the sales table nor the stock changes.
- `server/__tests__/integration/migrations.integration.test.js`: `003` applies twice without error and leaves one `admin` user.

## Docs
- `server/schema.md` (new table, admin user), `server/API.md` (`POST /sales` 401 and the token note), the swagger comment and `server/openapi-spec.json`.

## Open questions
- none
