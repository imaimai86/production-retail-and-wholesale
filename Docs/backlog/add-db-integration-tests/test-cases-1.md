# Test cases: add-db-integration-tests

Based on `specs-1.md` and `plan-1.md`. Unit tests run in `npm test` (no database). Integration tests run with `npm run test:integration` (needs `DATABASE_URL`). Before Implement, all unit tests fail (helper, config and CI file missing). Integration tests cannot pass until the helper exists; the pipeline does not claim they pass (acceptance criterion 11).

Helper API assumed (from plan 3.1): `requireDatabaseUrl`, `scratchName`, `withDatabaseName`, `createScratchDb`, `useScratchEnv`, `openPool`, `closePools` (async), `applyMigrations(url, files?)`, `applySchema(url)`, `dropScratchDb(name)` (async).

## Unit: `server/__tests__/test-utils/scratchDb.test.js` (mocked `pg`)
| ID | Case | Expected | Spec |
|---|---|---|---|
| U1 | `scratchName()` x20 | Matches `^prw_test_[0-9a-f]{8}$`; not all identical | 3.2, 5.1 |
| U2 | `withDatabaseName` on URL with user, encoded password, port, query | Only pathname changes | 3.2, 5.1 |
| U3 | `requireDatabaseUrl` with unset / `''` / `'   '` | Throws exactly `DATABASE_URL is required for integration tests` | 3.2, 5.1 |
| U4 | `requireDatabaseUrl` with padded URL | Returns trimmed URL | 3.2 |
| U5 | `createScratchDb` with unset / whitespace `DATABASE_URL` | Rejects with exact message; no query issued | 3.2, 5.1 |
| U6 | `createScratchDb` success | Issues `CREATE DATABASE <name>`; returned URL has scratch name, query kept | 3.2 |
| U7 | `createScratchDb`, mocked query rejects with message containing URL and password (raw and encoded) | Thrown message contains neither, nor host | 3.3, 5.1 |
| U8 | Missing-URL error | No password in message | 3.3 |
| U9 | `dropScratchDb` with `other_db`, `app`, `postgres`, `prw_testing`, `x_prw_test_...`, `''` | Rejects; no `DROP` issued | 3.2, 3.3, 5.1 |
| U10 | `dropScratchDb('prw_test_abcd1234')` not created here | Rejects; no `DROP` issued | 3.3 |
| U11 | Drop error message | No password | 3.3 |
| U12 | Create then drop | One `DROP DATABASE ... FORCE` with that name; second drop rejects, no second `DROP` | 3.2 |
| U13 | `useScratchEnv` | Sets `DATABASE_URL`, `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` (decoded), `PGDATABASE` | 3.2 |
| U14 | `useScratchEnv` with no port | `PGPORT` is `5432` | 3.2 |

## Unit: `server/__tests__/config/test-setup.test.js`
| ID | Case | Expected | Spec |
|---|---|---|---|
| C1 | `server/package.json` | `test:integration` script has `--runInBand` and targets `__tests__/integration`; `jest.testPathIgnorePatterns` has `/node_modules/` and an entry with `/__tests__/integration/` | 2.1, 5.2 |
| C2 | `server/package.json` `test` | Still `jest` | 2.1 |
| C3 | Root `package.json` | `test:integration` = `npm run test:integration --prefix server`; `test` unchanged | 2.2 |
| C4 | `.gitlab-ci.yml` exists | Jobs `unit:` and `integration:` | 5.2, 6 |
| C5 | CI service | `postgres:16`, `alias: postgres` | 5.2, 6 |
| C6 | CI scripts | `npm test` and `npm run test:integration` | 5.2, 6 |
| C7 | CI image and cache | `node:22`; both lockfiles | 6 |
| C8 | CI variables | `POSTGRES_DB/USER/PASSWORD` = `app`; `DATABASE_URL=postgres://app:app@postgres:5432/app` | 6 |
| C9 | CI comment | Comment mentioning masked variables | 6 |
| C10 | CI has no `apt-get` or `psql` | Absent | 6 |
| C11 | `README.md` | "Running integration tests", docker command, test command | 7 |
| C12 | `AGENTS.md`, `server/README.md` | Mention `test:integration` / "Running integration tests" | 7 |

## Integration: `db.integration.test.js`
| ID | Case | Expected | Spec |
|---|---|---|---|
| D1 | `db.query('SELECT 1 AS n')` | `n === 1` | 4.1 |
| D2 | `transaction` commits | Inserted row visible afterward | 4.1 |
| D3 | `transaction` returns callback result | Returns value | 4.1 |
| D4 | `transaction` callback throws `boom` | Rejects with the same error object; row absent | 4.1 |
| D5 | Pool after rollback | Next query works (client released) | 4.1 |

## Integration: `migrations.integration.test.js`
| ID | Case | Expected | Spec |
|---|---|---|---|
| M1 | Apply all migrations to empty db | No error; `sales.location` and inventory unique constraint exist | 4.2.1 |
| M2 | Apply `001`, seed 2 inventory rows (3, 4) and 2 sales, apply `002` | One inventory row quantity 7; both sales `location='retail'`; duplicate insert fails `23505` | 4.2.2 |
| M3 | Distinct locations before `002` | Both rows kept with original quantities | 4.2.2 |
| M4 | Drift: `001`+`002` vs `schema.sql`, tables `sales`, `inventory` | Column sets (name, type, nullable, default) equal ignoring position; constraints (type, columns, FK target) equal ignoring names; PK, FKs, UNIQUE (`product_id`,`location`) present | 4.2.3 |
| M5 | Drift check sensitivity: `001` only vs `schema.sql` | Inventory constraint sets differ (proves the comparison can fail) | 4.2.3 |

## Integration: `api.integration.test.js`
| ID | Case | Expected | Spec |
|---|---|---|---|
| A1 | Transfer 4 of 10, destination absent | 200; production 6, retail 4 | 4.3 |
| A2 | Transfer, destination has stock | Destination incremented | 4.3 |
| A3 | Transfer entire stock | 200; source 0 | 4.3 |
| A4 | Transfer 11 of 10 | 409 `Insufficient stock`; inventory unchanged | 4.3 |
| A5 | Transfer from location with no row | 409 `Insufficient stock`; no rows created or changed | 4.3 |
| A6 | Sale `sold` qty 3 at retail (retail 10, production 5) | 201; retail 7, production 5; one sale row, `user_id` = seeded user, location retail | 4.3 |
| A7 | Sale `order_created` | 201; stock unchanged | 4.3 |
| A8 | Sale above stock | 409; no sale row; stock unchanged | 4.3 |
| A9 | PATCH `sold` -> `order_created` | 200; retail restored to 10 | 4.3 |
| A10 | PATCH `order_created` -> `sold` | 200; stock decremented | 4.3 |
| A11 | DELETE `sold` sale | 200; stock restored; row removed | 4.3 |
| A12 | DELETE `order_created` sale | 200; stock unchanged; row removed | 4.3 |
| A13 | Sale at `warehouse` (no inventory row) | 404 `Inventory not found for product at location`; no sale row; stock unchanged | 4.3 |

## Not covered by Jest (manual, plan 3.7)
- `npm test` does not list integration files (`npx jest --listTests`); `npm run test:integration -- --listTests` lists exactly three.
- With `DATABASE_URL` unset the integration run fails fast with the spec message (acceptance 3).
- `\l` shows no leftover `prw_test_*` databases after a run (acceptance 4).
- Out-of-scope files unmodified (acceptance 10).
