# add-db-integration-tests

Type: feature
Priority: P2 (normal)
Source: user request: "test cases to verify db connection is working" and "run the db test in gitlab". Every existing test mocks the database (`jest.mock('../../models/db')`), so SQL, migrations and transactions have never run against Postgres; `server/migrations/002_sales_location.sql` (duplicate merge + UNIQUE constraint) is unverified.

## Problem
Nothing in the repo proves that the models, the migrations or the API work against a real PostgreSQL, and there is no CI configuration that provides a database.

## Expected behaviour
`npm run test:integration` runs a separate suite against a real Postgres, using a throwaway scratch database that it creates and drops itself. `npm test` is unchanged and still needs no database. A `.gitlab-ci.yml` runs both with a Postgres service.

## Decisions
- Location: integration tests in `server/__tests__/integration/` (`db.integration.test.js`, `migrations.integration.test.js`, `api.integration.test.js`). Shared helper in `server/test-utils/scratchDb.js`, OUTSIDE `__tests__/` (Jest treats every file under `__tests__/` as a test).
- Separation: add to `server/package.json` a Jest `testPathIgnorePatterns` containing `/node_modules/` and `/__tests__/integration/`, so `npm test` never runs them. Add script `"test:integration"` that runs only the integration folder with `--runInBand`. Add root script `"test:integration": "npm run test:integration --prefix server"`.
- Connection: the helper reads `DATABASE_URL` as the admin connection. If it is unset or empty after trim, the suite fails immediately with the message `DATABASE_URL is required for integration tests` (no skipping). A connection failure fails with a message that does NOT contain the URL or password.
- Scratch database: each test file creates `prw_test_<8 random hex chars>` in `beforeAll` and drops it in `afterAll` (`DROP DATABASE ... WITH (FORCE)`), closing every pool first. The helper only ever drops a database whose name starts with `prw_test_` and that it created itself; it throws otherwise.
- The helper exports the scratch URL and, before any model is required, sets `process.env.DATABASE_URL` and the `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` variables from it (parsed with `new URL`), so `models/db.js` connects to the scratch database whether or not it reads `DATABASE_URL`. Use `jest.resetModules()` where a fresh pool is needed.
- Migrations are applied from Node with the `pg` package (no `psql` needed): read `server/migrations/*.sql` sorted by filename and run each file in the scratch database.
- Cases:
  1. Connection: `SELECT 1` through `models/db.js` returns 1; `transaction` commits on success and rolls back and rethrows on error.
  2. Migrations: all migrations apply to an empty database. Apply only `001`, insert two `inventory` rows with the same product and location (quantities 3 and 4) and two `sales` rows, then apply `002`: one inventory row with quantity 7 remains, old sales rows have `location = 'retail'`, and inserting another duplicate (product, location) fails with Postgres code `23505`.
  3. Schema drift: the columns of `sales` and `inventory` and the UNIQUE constraint produced by the migrations match those from applying `server/schema.sql` to an empty database (compare `information_schema.columns` and `pg_constraint`).
  4. API (supertest against `../../index`, real models, header `x-auth-token` set): transfer succeeds and moves quantity; transfer with too little stock returns 409 `{ "error": "Insufficient stock" }` and changes no row; sale with status `sold` decrements only its own location; PATCH `sold` -> `order_created` and DELETE of a sold sale restore stock to that location; unknown location returns 404.
- Tests insert their own seed rows and truncate tables between tests. `jest.setTimeout(30000)` for the suite.
- Unit-level tests that run in `npm test` (needed because the pipeline's red/green gate runs `npm test`, and the pipeline cannot start Postgres):
  - `server/__tests__/test-utils/scratchDb.test.js` with `pg` mocked: builds the scratch name with the `prw_test_` prefix, refuses to drop any other name, throws the exact message when `DATABASE_URL` is unset or whitespace, rewrites the database name in a URL, and never puts the password in a thrown message.
  - `server/__tests__/config/test-setup.test.js`: reads `server/package.json` and the root `package.json` and asserts the `test:integration` scripts and the `testPathIgnorePatterns` entry exist, and reads `.gitlab-ci.yml` as text and asserts it defines jobs `unit` and `integration`, a `postgres:16` service with alias `postgres`, and runs `npm test` and `npm run test:integration`.
- The pipeline CANNOT run the integration suite (no database in its sandbox). Agents must not claim it passed; the Review stage checks the SQL and queries by reading them, and the integration suite is run by the developer locally and in CI.
- `.gitlab-ci.yml` at the repo root: image `node:22`, stage `test`, cache keyed on `package-lock.json` and `server/package-lock.json`. Job `unit`: `npm ci`, `npm ci --prefix server`, `npm test`. Job `integration`: service `postgres:16` with alias `postgres`; variables `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` all `app` and `DATABASE_URL=postgres://app:app@postgres:5432/app` (throwaway values for the job's own container, not real credentials; document that real secrets must be masked CI/CD variables); `npm ci --prefix server` then `npm run test:integration`. No `apt-get install` of `psql`.
- Assumes `fix-database-url` may or may not be merged; the helper works either way (see above). Does not depend on `add-db-health-check`.

## Scope
- In: `server/__tests__/integration/*` (new), `server/test-utils/scratchDb.js` (new), the two unit tests above (new), `server/package.json`, root `package.json`, `.gitlab-ci.yml` (new), docs below.
- Out of scope: any change to application source (`server/index.js`, `server/models/*`, `server/validation.js`), the migrations themselves, `/health`, GitHub Actions, test coverage reporting, Dockerfile or docker-compose.

## Tests
- As listed in Decisions: three integration files (run by `npm run test:integration` only) and two unit tests (run by `npm test`).

## Docs
- `README.md`: a short "Running integration tests" section with this command, then `DATABASE_URL=postgres://app:app@localhost:5432/app npm run test:integration`:
  `docker run -d --name prw-db -e POSTGRES_USER=app -e POSTGRES_PASSWORD=app -e POSTGRES_DB=app -p 5432:5432 postgres:16`
- `AGENTS.md` Development Guidelines: one line that `npm test` needs no database and `npm run test:integration` needs `DATABASE_URL`.
- `server/README.md`: one line pointing to the README section.

## Open questions
- none
