# Plan: add-db-integration-tests

Based on `specs-1.md` and `decisions.md`. No application source, migration, `/health`, GitHub Actions, Dockerfile or docker-compose change.

## 1. Findings from the code (what the plan relies on)

| Fact | Where | Consequence |
|---|---|---|
| `models/db.js` builds its `Pool` at require time from `DATABASE_URL` (falls back to `PG*` when unset/blank). It exports only `query` and `transaction`; there is no `end()` or exported pool. | `server/models/db.js:3-24` | The scratch env must be set before the first `require` of any model/`index.js`. The test has to capture the pool another way to close it (see 3.3). |
| `index.js` requires every model at load, calls `dotenv.config` (does not override variables already set), exports `app`, and only listens under `require.main`. | `server/index.js:1-14, 826-832` | supertest on `require('../../index')` works. Env set first wins over `.env`. |
| `Auth.verify` sets `req.userId` to the raw header string. `POST /sales` passes it as `user_id` (integer FK to `users.id`). | `server/middleware/auth.js`, `server/index.js:678` | Seed a `users` row and send its id as a string. No `ADMIN_TOKEN`. |
| `POST /sales` validates only `product_id`, `location`, `quantity`, `status`, but `sales.price` and `sales.gst` are `NOT NULL`. | `server/index.js:669-683`, `schema.sql` | Sale request bodies must include `price` and `gst`. |
| `Sales.create` checks the inventory row first (`inventoryNotFound`, 404), then decrements (`insufficientStock`, 409). `updateStatus` and `remove` use `RESTORE` (upsert) only when the sale was `sold`. `Inventory.transfer` decrements the source and upserts the destination, and returns the destination row. | `server/models/sales.js:22-70`, `server/models/inventory.js:4-17` | Matches the spec cases. Both depend on `UNIQUE (product_id, location)` (migration `002`). |
| `001` has no unique constraint and no `sales.location`. `002` adds `sales.location`, backfills `retail`, merges duplicates with `MIN(id)` and `SUM(quantity)`, then adds `inventory_product_location_key`. Both files wrap themselves in `BEGIN`/`COMMIT`. | `server/migrations/*.sql` | Each file can be run with a single parameterless `client.query(sql)`. The drift test needs a set comparison (names differ, `sales.location` position differs). |
| No Jest config exists today (no `jest` key, no `jest.config.*`). Jest 29 and supertest are already devDependencies. `pg` is a dependency. | `server/package.json` | Add a `jest` key. No new dependency. |
| `scripts/sdlc-integration.sh` already calls `npm run test:integration --prefix server` and fails if the script is missing. The root README already has a section "SDLC pipeline: integration tests". | `scripts/sdlc-integration.sh:13-16, 52`, `README.md:62-66` | Nothing to change in the script. The new README section is separate and must not duplicate that one. |

## 2. File list

| File | Action |
|---|---|
| `server/test-utils/scratchDb.js` | New helper |
| `server/__tests__/test-utils/scratchDb.test.js` | New unit test (mocked `pg`, runs in `npm test`) |
| `server/__tests__/config/test-setup.test.js` | New unit test (config asserts, runs in `npm test`) |
| `server/__tests__/integration/db.integration.test.js` | New |
| `server/__tests__/integration/migrations.integration.test.js` | New |
| `server/__tests__/integration/api.integration.test.js` | New |
| `server/package.json` | Add `jest` key and `test:integration` script |
| `package.json` (root) | Add `test:integration` script |
| `.gitlab-ci.yml` | New |
| `README.md` | New section "Running integration tests" |
| `AGENTS.md` | One line in Development Guidelines |
| `server/README.md` | One line pointing to the README section |

Not touched: `server/index.js`, `server/models/*`, `server/validation.js`, `server/migrations/*`, `server/schema.sql`, `scripts/sdlc-integration.sh`, `.github/`.

## 3. Steps, in order

Order follows Red tests then Implement: the two unit tests and the integration files are written against the helper's API first, then the helper and config make them pass.

### 3.1 Step 1: Helper `server/test-utils/scratchDb.js` (CommonJS, uses `pg` and `fs`/`path`)
Lives outside `__tests__/`. Exported API (names fixed here so tests and helper agree):

- `requireDatabaseUrl(env = process.env)`: reads `DATABASE_URL`; if unset, empty or whitespace after trim, throws `new Error('DATABASE_URL is required for integration tests')` (exact text). Returns the trimmed URL.
- `scratchName()`: returns `'prw_test_' + crypto.randomBytes(4).toString('hex')` (8 chars of `[0-9a-f]`).
- `withDatabaseName(url, name)`: parses with `new URL`, sets `pathname = '/' + name`, leaves user, password, host, port and query untouched, returns `url.toString()`.
- `createScratchDb()`: calls `requireDatabaseUrl`, builds the name, opens a short-lived admin `Pool`, runs `CREATE DATABASE "<name>"`, ends the admin pool, adds the name to a module-level `created` Set, returns `{ name, url }` (scratch URL via `withDatabaseName`). Identifier quoting: the name is generated by `scratchName()`, so it matches `/^prw_test_[0-9a-f]{8}$/`; assert that before interpolating, because `CREATE`/`DROP DATABASE` cannot take bind parameters.
- `useScratchEnv(url)`: sets `process.env.DATABASE_URL = url` and `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` from `new URL(url)` (decode user/password with `decodeURIComponent`; port default `5432`; database from the pathname without the leading `/`). Called before any model is required.
- `openPool(url)`: creates a `pg` `Pool`, pushes it to a module-level `pools` array, returns it. Used by the helper's own migration code and by tests that query directly. `closePools()` ends and clears them.
- `applyMigrations(url, files)`: `files` defaults to every `server/migrations/*.sql` sorted by filename; if given, a subset of filenames (for the `001`-only step). Reads each file and runs it with one `pool.query(sql)`; no `psql`.
- `applySchema(url)`: runs `server/schema.sql` the same way (for the drift test).
- `dropScratchDb(name)`: validate first, before any connection: the name must start with `prw_test_` (else throw, no `DROP`), and must be in the `created` Set (else throw, no `DROP`). Then `closePools()`, open an admin pool, run `DROP DATABASE "<name>" WITH (FORCE)`, end the admin pool, delete the name from `created`.
- Error hygiene: one internal `safeError(err, secrets)` wrapper. Admin connection and query failures are rethrown as `new Error('Could not connect to the admin database')` (plus `err.code` when present), not the original message, because `pg`/Node errors can embed host, port or user. Every message thrown by the helper is passed through a scrub that replaces the admin password, the full URL and the URL-encoded password with `***`. Never log the URL.

### 3.2 Step 2: Unit tests that run in `npm test`

`server/__tests__/test-utils/scratchDb.test.js` (`jest.mock('pg')` with a fake `Pool` whose `query` is a `jest.fn()`):
- `scratchName()` matches `/^prw_test_[0-9a-f]{8}$/` (call it several times).
- `dropScratchDb('other_db')` and `dropScratchDb('prw_test_abcd1234')` for a name not created here both throw, and `query` is never called with a `DROP`.
- `requireDatabaseUrl` / `createScratchDb` throw exactly `DATABASE_URL is required for integration tests` for an unset value and for `'   '`.
- `withDatabaseName('postgres://u:p%40ss@h:5433/app?sslmode=disable', 'x')` changes only the database name.
- Password never appears: make the mocked `query`/`connect` reject with an error whose message contains the password and the URL, then assert the message thrown by `createScratchDb()` contains neither (also for the `DATABASE_URL`-missing error).
- Each test restores `process.env.DATABASE_URL`, and uses `jest.resetModules()` so the module-level `created` Set starts empty.

`server/__tests__/config/test-setup.test.js` (reads files with `fs`, paths relative to `__dirname`):
- `server/package.json`: `scripts['test:integration']` exists; `jest.testPathIgnorePatterns` contains an entry including `/__tests__/integration/`.
- Root `package.json`: `scripts['test:integration']` exists.
- `.gitlab-ci.yml` as text: matches `^unit:` and `^integration:` job keys, `postgres:16`, `alias: postgres`, `npm test` and `npm run test:integration`.

### 3.3 Step 3: Integration tests (`server/__tests__/integration/`)

Shared shape for every file: `jest.setTimeout(30000)` at the top. `beforeAll`: `createScratchDb()` (fails right away with the spec message when `DATABASE_URL` is missing; never skip), `applyMigrations(url)`, `useScratchEnv(url)`, `jest.resetModules()`, then require the models/app. `afterAll`: close every pool, then `dropScratchDb(name)`. `beforeEach`: `TRUNCATE ... RESTART IDENTITY CASCADE` on the tables the file touches; each test inserts its own seed rows.

Closing the `models/db.js` pool (no export for it): before requiring models, register
```js
const tracked = [];
jest.doMock('pg', () => {
  const actual = jest.requireActual('pg');
  class TrackedPool extends actual.Pool { constructor(...a) { super(...a); tracked.push(this); } }
  return { ...actual, Pool: TrackedPool };
});
```
and in `afterAll` `await Promise.all(tracked.map(p => p.end()))` before `dropScratchDb`. This does not change source. The helper is required before `doMock`/`resetModules` and kept in a variable, so it keeps the real `pg`.

**`db.integration.test.js`**
- `db.query('SELECT 1 AS n')` returns `rows[0].n === 1`.
- `transaction` commit: insert a `categories` row inside the callback; afterwards `db.query` finds it.
- `transaction` rollback: callback inserts then throws `new Error('boom')`; `await expect(...).rejects.toBe(thatError)` (same error object/message) and the row is absent.

**`migrations.integration.test.js`** (own scratch databases; this file creates extra ones for the steps below, all dropped in `afterAll`)
1. Empty scratch db plus `applyMigrations(url)` resolves without error; `sales.location` and the unique constraint exist.
2. Duplicate merge: scratch db with `applyMigrations(url, ['001_initial.sql'])`; insert a category and product, two `inventory` rows `(product, 'retail')` with quantities 3 and 4, two `sales` rows (provide `price` and `gst`); run `applyMigrations(url, ['002_sales_location.sql'])`. Assert exactly one inventory row with quantity 7, both sales rows `location = 'retail'`, and a further identical-key insert rejects with `err.code === '23505'`.
3. Drift: db A = `001`+`002`; db B = `applySchema`. For tables `sales` and `inventory`, build sets from `information_schema.columns` keyed `column_name|data_type|is_nullable|column_default` (sort or `Set`, never by `ordinal_position`). Compare constraints from `pg_constraint` by `contype` plus the ordered column-name list (join `pg_attribute` on `conkey`), and for foreign keys also the referenced table name; ignore `conname`. Expect equal sets; assert the PK, both FKs on `sales`, the FK on `inventory` and the UNIQUE (`product_id`, `location`) are present in both. The name difference and column position must not fail it.

**`api.integration.test.js`** (supertest against `require('../../index')` after the env and `doMock` setup)
- Seed helper in the file: `seed({ stock })` inserts a `users` row, `categories` row, `products` row, and `inventory` rows, returning ids. Requests send `.set('x-auth-token', String(userId))`.
- Transfer succeeds: stock 10 at `production`, `POST /inventory/transfer` `{product_id, from:'production', to:'retail', quantity:4}` gives 200; DB shows `production`=6, `retail`=4 (row created because absent); also a second case where the destination already has stock increments it.
- Transfer insufficient: quantity 11, and separately a `from` with no row; both 409 `{ error: 'Insufficient stock' }`; inventory rows unchanged (compare before and after).
- Sale `sold`: inventory at `retail`=10 and `production`=5; `POST /sales` `{product_id, location:'retail', quantity:3, price, gst, status:'sold'}` gives 201; `retail`=7, `production` still 5; one `sales` row with `user_id` equal to the seeded user id and `location='retail'`.
- Status change: create the sale via the API, `PATCH /sales/:id/status` `{status:'order_created'}`; `retail` back to 10.
- Delete: create a `sold` sale, `DELETE /sales/:id` gives 200; stock restored, `sales` row gone.
- Unknown location: `POST /sales` for `location:'warehouse'` (no row) gives 404 `{ error: 'Inventory not found for product at location' }`; `sales` count 0; inventory unchanged.

### 3.4 Step 4: Config
- `server/package.json`: add
  ```json
  "jest": { "testPathIgnorePatterns": ["/node_modules/", "/__tests__/integration/"] },
  ```
  and the script
  ```json
  "test:integration": "jest --runInBand --testPathIgnorePatterns=/node_modules/ --testPathPattern=__tests__/integration/"
  ```
  Reason: Jest intersects an explicit path with `testPathIgnorePatterns`, so a bare path argument would find no tests. The CLI flag replaces the config ignore list for this run (only `node_modules`), and `--testPathPattern` selects the folder. `--testPathPattern` is used instead of a positional argument because the array-valued ignore flag would otherwise swallow it. Verify by listing: `npx jest --listTests` (three integration files absent) vs `npm run test:integration -- --listTests` (exactly the three).
- Root `package.json`: `"test:integration": "npm run test:integration --prefix server"`. `test` unchanged.

### 3.5 Step 5: `.gitlab-ci.yml` (repo root)
- `image: node:22`, `stages: [test]`, default `cache` keyed with `key.files: [package-lock.json, server/package-lock.json]` and paths `node_modules/` and `server/node_modules/`.
- `unit`: `script: [npm ci, npm ci --prefix server, npm test]`.
- `integration`: `services: [{ name: postgres:16, alias: postgres }]`; `variables`: `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` all `app`, `DATABASE_URL: "postgres://app:app@postgres:5432/app"`; `script: [npm ci --prefix server, npm run test:integration]`.
- Comment above `variables` that these are throwaway values for the job's own container and real secrets must be masked CI/CD variables. No `apt-get`/`psql`.
- Interaction: CI runs `npm run test:integration` directly, so it is not affected by the `SDLC_INTEGRATION_CI` skip in `scripts/sdlc-integration.sh` (that gate only covers the SDLC script).

### 3.6 Step 6: Docs
- `README.md`: new section "Running integration tests" with the two commands from the spec (placed before "SDLC pipeline: integration tests"; one sentence that the suite creates and drops its own `prw_test_*` database).
- `AGENTS.md` Development Guidelines (after the `npm test` line at `AGENTS.md:47`): one line, `npm test` needs no database; `npm run test:integration` needs `DATABASE_URL`.
- `server/README.md`: one line (after the migrations/`DATABASE_URL` paragraph) pointing to "Running integration tests" in the root `README.md`.

### 3.7 Step 7: Verification (developer and CI, not claimed by the pipeline)
1. `npm test` from the root with no `DATABASE_URL`: all pass, including the two new unit tests, and no `__tests__/integration/` file runs.
2. `npm run test:integration` with `DATABASE_URL` unset: fails fast with `DATABASE_URL is required for integration tests`.
3. With the Docker command from the README: three files pass; `psql -c '\l'` shows no `prw_test_*` left.
4. Remove the `test:integration` script, the ignore pattern or a CI job and confirm `test-setup.test.js` fails.
5. Review reads the SQL and queries, since the pipeline cannot assert the integration run passed (acceptance criterion 11).

## 4. Risks and decisions

- **`models/db.js` has no pool shutdown.** Solved with the `pg` `doMock` wrapper in tests; the alternative, relying on `DROP DATABASE ... WITH (FORCE)` to cut connections, would leave idle clients erroring on a dropped database and hang or crash Jest, so pools are always ended first.
- **Jest ignore pattern versus explicit path.** Handled by the CLI-flag form above. If a Jest version change breaks it, fall back to a second config file (`jest.integration.config.js`) selected with `--config`; the spec fixes the behaviour of the script, not the mechanism, so that fallback needs no spec change.
- **Module-level state in the helper.** `created` and `pools` are per module instance, so tests that call `jest.resetModules()` must keep their reference to the helper (required once at the top of the file) and must not re-require it after resetting.
- **Concurrent suites.** `--runInBand` plus a random name per call prevents collisions; each file drops only what it created.
- **Password safety.** Never interpolate the URL into an error, log, or `console` call; the unit test covers the connection-failure case with a mocked rejection.
- **`NUMERIC` comparisons.** `pg` returns `NUMERIC` as strings; compare quantities (integers) only, and use `Number()` for any price assertions.
- **Dependency note.** No change depends on `fix-database-url` or `add-db-health-check`; `useScratchEnv` sets both `DATABASE_URL` and `PG*`.
