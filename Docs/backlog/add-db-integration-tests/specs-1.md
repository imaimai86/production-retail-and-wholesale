# Spec: add-db-integration-tests

## 1. Summary
Add a separate Jest integration suite that runs the models, migrations and API against a real PostgreSQL, using a throwaway scratch database the suite creates and drops itself. `npm test` is unchanged and needs no database. A `.gitlab-ci.yml` runs both suites, the integration job with a Postgres service. No application source, migration, `/health`, GitHub Actions, coverage, Dockerfile or docker-compose change.

Binding answers from `decisions.md`: (Q1) API tests seed a `users` row and send its id as a string in `x-auth-token`; no `ADMIN_TOKEN` is needed. (Q2) The "unknown location" API case is `POST /sales`. (Q3) Schema drift compares sets, ignoring `ordinal_position` and constraint names.

## 2. Commands and configuration

### 2.1 `server/package.json`
- Jest config gains `testPathIgnorePatterns` = [`/node_modules/`, `/__tests__/integration/`], so `npm test` never runs integration files.
- New script `test:integration`: runs Jest only on `server/__tests__/integration/`, with `--runInBand`. It must not be affected by the ignore pattern (the folder is targeted explicitly, overriding the ignore pattern for that run).

### 2.2 Root `package.json`
- New script `"test:integration": "npm run test:integration --prefix server"`.
- Existing `test` script unchanged.

### 2.3 Behaviour
| Command | Needs DB | Runs |
|---|---|---|
| `npm test` | No | All existing tests plus the two new unit tests; no integration files |
| `npm run test:integration` | Yes (`DATABASE_URL`) | Only the three integration files, serially |

## 3. Helper: `server/test-utils/scratchDb.js`
Lives outside `__tests__/` so Jest does not treat it as a test.

### 3.1 Inputs
- `DATABASE_URL`: the admin connection URL (a database where the user may `CREATE DATABASE` and `DROP DATABASE`).

### 3.2 Behaviour
- Reads `DATABASE_URL`. If unset, empty, or whitespace-only after trim, it throws an error whose message is exactly `DATABASE_URL is required for integration tests`. No skipping.
- Builds a scratch name `prw_test_<8 random hex chars>` (prefix `prw_test_`, then 8 characters of `[0-9a-f]`).
- Creates the scratch database via the admin connection, and returns/exports the scratch URL (the admin URL with only the database name replaced).
- Exports a function that rewrites the database name in a URL (preserving user, password, host, port and query).
- Before any model is required, sets `process.env.DATABASE_URL` to the scratch URL and `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` from it (parsed with `new URL`), so `models/db.js` connects to the scratch database whether or not it reads `DATABASE_URL`.
- Applies migrations from Node with `pg` (no `psql`): reads `server/migrations/*.sql`, sorted by filename, and runs each file in the scratch database. It also supports applying a chosen subset (needed for the `001`-only step) and applying `server/schema.sql` to a database (needed for drift).
- Drops the scratch database with `DROP DATABASE ... WITH (FORCE)` after closing every pool it opened. Callers close their own pools (including `models/db.js`'s pool) before the drop.
- Drop safety: it only drops a database whose name starts with `prw_test_` AND that it created itself in this process. Any other name throws, and nothing is dropped.

### 3.3 Error cases
| Condition | Result |
|---|---|
| `DATABASE_URL` unset / empty / whitespace | Throws `DATABASE_URL is required for integration tests` |
| Admin connection fails | Throws an error whose message contains neither the URL nor the password |
| Drop requested for a name without the `prw_test_` prefix | Throws; no `DROP` issued |
| Drop requested for a `prw_test_` name this helper did not create | Throws; no `DROP` issued |
| Any thrown message | Never contains the password |

## 4. Integration test files (`server/__tests__/integration/`)
Common rules: each file creates its own scratch database in `beforeAll` and drops it in `afterAll` (pools closed first). Tests insert their own seed rows and truncate tables between tests. `jest.setTimeout(30000)` for the suite. `jest.resetModules()` is used where a fresh pool is needed. The integration suite is never skipped; with no `DATABASE_URL` it fails immediately with the message in 3.2.

### 4.1 `db.integration.test.js` (connection)
- `SELECT 1` through `models/db.js` returns 1.
- `transaction` commits on success: a row inserted inside the callback is visible afterward.
- `transaction` on callback error rolls back and rethrows the same error: the inserted row is absent afterward.

### 4.2 `migrations.integration.test.js`
1. All migrations apply to an empty database without error.
2. Duplicate merge: apply only `001`; insert one product and two `inventory` rows with the same product and location (quantities 3 and 4) and two `sales` rows; apply `002`. Expect: exactly one inventory row for that (product, location) with quantity 7; both old sales rows have `location = 'retail'`; inserting another inventory row with the same (product, location) fails with Postgres error code `23505`.
3. Schema drift: compare a database built from migrations (`001`+`002`) with one built from `server/schema.sql`, for tables `sales` and `inventory`:
   - Columns compared as sets of (`column_name`, `data_type`, `is_nullable`, `column_default`) from `information_schema.columns`, ignoring `ordinal_position`.
   - Constraints compared from `pg_constraint` by type and column list, ignoring constraint names; the PRIMARY KEY, FOREIGN KEYs and UNIQUE (`product_id`, `location`) on `inventory` must match.
   - The test must not fail merely because of the name difference (`inventory_product_location_key` vs `inventory_product_id_location_key`) or because `sales.location` has a different position.

### 4.3 `api.integration.test.js`
Uses supertest against `../../index` with real models. Each test seeds a `users` row (and the products, categories and inventory it needs) and sends that user's id as a string in `x-auth-token`. Request bodies must be valid per `server/validation.js`.
| Case | Request | Expected |
|---|---|---|
| Transfer succeeds | `POST /inventory/transfer` with enough stock at `from` | Success response; source quantity reduced and destination increased by the quantity in the database (destination row created if absent) |
| Transfer, insufficient stock | `POST /inventory/transfer` with quantity above stock (including a `from` with no row) | 409 `{ "error": "Insufficient stock" }`; no inventory row changes |
| Sale `sold` | `POST /sales` status `sold` | Decrements only the sale's location; other locations' quantities unchanged; one `sales` row stored with the user's id |
| Status change | `PATCH /sales/:id/status` from `sold` to `order_created` | Stock restored to the sale's location |
| Delete | `DELETE /sales/:id` of a `sold` sale | Stock restored to the sale's location; sale row removed |
| Unknown location | `POST /sales` for a location with no inventory row for the product | 404 `{ "error": "Inventory not found for product at location" }`; no `sales` row created; no inventory change |

## 5. Unit tests that run in `npm test` (no database)

### 5.1 `server/__tests__/test-utils/scratchDb.test.js` (with `pg` mocked)
- The scratch name has the `prw_test_` prefix followed by 8 hex characters.
- Dropping any name that does not start with `prw_test_` throws and issues no `DROP`.
- Throws exactly `DATABASE_URL is required for integration tests` when `DATABASE_URL` is unset, and when it is whitespace.
- The URL rewrite replaces only the database name.
- No thrown message contains the password (including for a simulated connection failure).

### 5.2 `server/__tests__/config/test-setup.test.js`
- Reads `server/package.json` and root `package.json` and asserts: the `test:integration` script in each, and the `testPathIgnorePatterns` entry (containing `/__tests__/integration/`).
- Reads `.gitlab-ci.yml` as text and asserts: jobs `unit` and `integration`; a `postgres:16` service with alias `postgres`; it runs `npm test` and `npm run test:integration`.

## 6. `.gitlab-ci.yml` (repo root)
- Image `node:22`, stage `test`, cache keyed on `package-lock.json` and `server/package-lock.json`.
- Job `unit`: `npm ci`, `npm ci --prefix server`, `npm test`.
- Job `integration`: service `postgres:16` with alias `postgres`; variables `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` all `app`, and `DATABASE_URL=postgres://app:app@postgres:5432/app`; scripts `npm ci --prefix server` then `npm run test:integration`.
- A comment states that these are throwaway values for the job's own container and that real secrets must be masked CI/CD variables.
- No `apt-get install` of `psql`.

## 7. Documentation
- `README.md`: new short section "Running integration tests" with the command `docker run -d --name prw-db -e POSTGRES_USER=app -e POSTGRES_PASSWORD=app -e POSTGRES_DB=app -p 5432:5432 postgres:16`, then `DATABASE_URL=postgres://app:app@localhost:5432/app npm run test:integration`.
- `AGENTS.md`, Development Guidelines: one line that `npm test` needs no database and `npm run test:integration` needs `DATABASE_URL`.
- `server/README.md`: one line pointing to the README section.

## 8. Out of scope
Changes to `server/index.js`, `server/models/*`, `server/validation.js`, the migrations, `/health`, GitHub Actions, coverage reporting, Dockerfile, docker-compose. The helper must work whether or not `fix-database-url` is merged; there is no dependency on `add-db-health-check`.

## 9. Acceptance criteria
1. `npm test` from the repo root passes with no database and does not run any file in `__tests__/integration/`.
2. `npm run test:integration` (root and `server`) runs only the three integration files with `--runInBand`.
3. With `DATABASE_URL` unset or whitespace, the integration run fails immediately with `DATABASE_URL is required for integration tests`.
4. With a reachable Postgres, each integration file creates and drops its own `prw_test_<8 hex>` database, leaving none behind, and never drops any other database.
5. Connection failures and all thrown helper errors expose neither the URL nor the password.
6. Every case in sections 4.1 to 4.3 exists and passes against Postgres 16.
7. The two unit tests in section 5 pass in `npm test` and fail if the scripts, ignore pattern or CI jobs are removed.
8. `.gitlab-ci.yml` matches section 6.
9. The docs in section 7 are present.
10. No file listed in section 8 as out of scope is modified.
11. The pipeline does not claim the integration suite passed; it is verified by the developer locally and in CI, and Review checks the SQL and queries by reading them.
