# Bug Reports

## Inventory transfer ignores available stock
`Inventory.transfer` subtracts the requested quantity from the source location without verifying that enough quantity exists. If the source location has insufficient or no entry, the resulting quantity can become negative.

**Suggested fix:** During the transaction, check the current quantity for the source location and abort with an error when it is less than the requested amount.

## Sales creation bypasses inventory checks
`Sales.create` deducts inventory only when the sale status is `sold`, but it does not verify available quantity. This can leave inventory negative after a sale.

**Suggested fix:** Validate available stock before completing a sale and refuse the operation when stock is insufficient.

## Server ignores `DATABASE_URL`, so a local setup fails with "client password must be a string"
`server/models/db.js` creates the pool with `new Pool()` and no arguments, so `pg` reads only the `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` and `PGDATABASE` variables. `DATABASE_URL` (documented in `AGENTS.md` and `.env`) is read only by `script/migrate.sh` and `script/db.sh`. With the documented `.env` (`PORT`, `DATABASE_URL`, `ADMIN_TOKEN`), the first query fails: `POST /users` with `x-auth-token: secret` and `{"name":"anas"}` returns `Error: SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string` (thrown from `pg-pool`, via `models/users.js:13`).

**Suggested fix:** Pass the URL to the pool: `new Pool({ connectionString: process.env.DATABASE_URL })` (the `PG*` variables still work when it is unset), and add a test for it. Document the variable in `AGENTS.md` and `server/README.md`.

## Unhandled errors return an HTML stack trace
There is no error-handling middleware after the routes, so any error passed to `next(err)` is rendered by Express's default handler as an HTML page that includes the stack trace and absolute file paths. API clients expect JSON, and the paths should not be exposed.

**Suggested fix:** Add a final `app.use((err, req, res, next) => ...)` that logs the error and returns `500 { "error": "Internal server error" }` (no stack outside development), and add a test.

## `POST /users` docs list fields the API ignores (Fixed)
The OpenAPI docs for `POST /users` show `username`, `password` and `role`, but `Users.create` reads only `name`, and the `users` table has only `id` and `name`. A request sent as documented inserts a NULL name and fails (500).

**Suggested fix:** Either align the docs with the real body (`name`), or implement the fields (password hash, role) as part of the authentication work in `AGENTS.md`.

**Fixed:** Docs aligned with the real body (`name`); `POST /users` now validates `name` and returns 400.
