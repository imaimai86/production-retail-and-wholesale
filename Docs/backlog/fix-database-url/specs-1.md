# Spec: fix-database-url

Source: `Engineering/bugs.md` ("Server ignores `DATABASE_URL`"); `Docs/backlog/fix-database-url/brief.md`.

## Problem
`server/models/db.js` creates the pool with `new Pool()` and no arguments, so `pg` reads only `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` and `PGDATABASE`. `DATABASE_URL`, which `AGENTS.md` and `.env` document, is ignored by the server. With only `DATABASE_URL` set, the first query fails with `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string`.

## Behaviour
The pool is created once, when `server/models/db.js` is first required, from `process.env.DATABASE_URL` as it stands at that moment.

| `DATABASE_URL` at require time | Pool construction |
|---|---|
| A string that is non-empty after trimming | `new Pool({ connectionString: <the value of DATABASE_URL> })` |
| Unset | `new Pool()` with no arguments (current behaviour; `PG*` variables apply) |
| Empty string | `new Pool()` with no arguments |
| Whitespace-only | `new Pool()` with no arguments |

- Trimming is only used to decide which branch applies. The value passed as `connectionString` is `process.env.DATABASE_URL` exactly as set, not the trimmed copy.
- The options object contains only `connectionString`. No SSL options, pool-size options or other configuration.
- No new environment variables.
- `PG*` variables remain the fallback, which `pg` handles itself when `DATABASE_URL` is not used.
- The module's export shape is unchanged: `query(text, params)` and `transaction(callback)`, with identical semantics (BEGIN/COMMIT/ROLLBACK and client release).
- The URL must never be logged or printed, because it contains the password. This covers console output and error messages that the module itself produces.
- `server/index.js` already loads `.env` via dotenv before requiring the models, so it needs no change.

## Inputs / outputs
- Input: the `DATABASE_URL` environment variable (and the `PG*` variables when it is not used).
- Output: a `pg` Pool configured as in the table above, used by the existing `query` and `transaction` exports. No change to HTTP endpoints or response shapes.

## Error cases
- `DATABASE_URL` unset, empty or whitespace-only, and no usable `PG*` variables: behaviour is unchanged from today. The pool is created, and the first query fails with the error `pg` produces. This change does not add validation or new error messages.
- Malformed or unreachable `DATABASE_URL`: not validated by this change. Errors come from `pg` on the first query, as for any bad connection configuration. The module must not wrap them in a way that adds the URL to the message.
- Requiring the module must not throw because of `DATABASE_URL`, whatever its value.

## Documentation changes
- `AGENTS.md`, Provisioning section: state that the server reads `DATABASE_URL`, and that the `PG*` variables are the fallback when it is unset or empty.
- `server/README.md`: the same statement. The existing line about `./script/migrate.sh` and `DATABASE_URL` stays accurate and may be kept.

## Tests
New file `server/__tests__/models/db.test.js`, mocking `pg`. Each case calls `jest.resetModules()` first, because the pool is created at require time, and sets `process.env.DATABASE_URL` before requiring `db.js`. The original `DATABASE_URL` value is restored after each case.

1. `DATABASE_URL` set to a URL: the `Pool` constructor is called once with `{ connectionString: <that URL> }`.
2. `DATABASE_URL` unset: the `Pool` constructor is called once with no arguments.
3. `DATABASE_URL` set to `''`: the `Pool` constructor is called once with no arguments.
4. `DATABASE_URL` set to whitespace only (for example `'   '`): the `Pool` constructor is called once with no arguments.

## Acceptance criteria
1. With a non-blank `DATABASE_URL`, the pool is built with `{ connectionString }` holding that exact value and no other options.
2. With `DATABASE_URL` unset, empty or whitespace-only, `new Pool()` is called with zero arguments.
3. A local setup with only `DATABASE_URL` set (the documented `.env`) no longer fails with "client password must be a string". A setup with only `PG*` variables still works as before.
4. `db.js` still exports exactly `query` and `transaction`, unchanged in behaviour.
5. The URL is not logged or printed anywhere.
6. The four test cases above exist in `server/__tests__/models/db.test.js` and pass, and `npm test` from the repo root passes.
7. `AGENTS.md` (Provisioning) and `server/README.md` describe `DATABASE_URL` as read by the server, with `PG*` as the fallback.

## Out of scope
Migrations, `script/*.sh`, `install.sh`, SSL or pool-size options, new environment variables, and any source file other than `server/models/db.js`.
