# fix-database-url

Source: Engineering/bugs.md ("Server ignores DATABASE_URL").

`server/models/db.js` creates the pool with `new Pool()` and no arguments, so `pg` reads only PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE. `DATABASE_URL` (documented in AGENTS.md and .env) is ignored by the server, so a local setup with only `DATABASE_URL` fails with "SASL: client password must be a string".

## Decisions
- If `process.env.DATABASE_URL` is a non-empty string (after trim), create the pool with `new Pool({ connectionString: process.env.DATABASE_URL })`.
- If it is unset, empty or whitespace-only, behave exactly as today: `new Pool()` (PG* variables apply).
- No SSL options, pool-size options or other new configuration. No new env variables.
- `server/index.js` already loads `.env` (dotenv) before requiring the models, so no change there.
- Do not log or print the URL (it contains the password).
- The `db.js` export shape (`query`, `transaction`) must not change.
- Tests: new file `server/__tests__/models/db.test.js`, mocking `pg`. Cases: URL set -> Pool called with `{ connectionString }`; unset -> Pool called with no arguments; empty/whitespace -> no arguments. Use `jest.resetModules()` per case because the pool is created at require time.
- Docs: update `AGENTS.md` (Provisioning section) and `server/README.md` to say the server reads `DATABASE_URL`, and that the `PG*` variables are the fallback.
- Out of scope: migrations, `script/*.sh`, any other source file.
