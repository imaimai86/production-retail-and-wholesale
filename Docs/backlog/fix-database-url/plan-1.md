# Plan: fix-database-url

Spec: `Docs/backlog/fix-database-url/specs-1.md`

## Affected files (from graft + reads)
- `server/models/db.js` (the only source file to change). Line 3 is `const pool = new Pool();`. Exports are `query` and `transaction(callback)` (L7-L20). The pool is created at module level, and nothing else in the file reads env.
- Callers: no source file depends on `db.js`'s internals. Only tests reference it (`server/__tests__/models/{batches,inventory,products,sales,users}.test.js`), and all of them mock `../../models/db`. The pool change cannot affect them.
- `server/index.js` already loads dotenv before requiring models, so it needs no change (per spec).
- Docs: `AGENTS.md` (Provisioning section) and `server/README.md` (L27 mentions `DATABASE_URL` only for `./script/migrate.sh`).
- New test: `server/__tests__/models/db.test.js`. It does not exist yet, and it mirrors `server/models/db.js`.

## Order of work

### 1. Red tests: `server/__tests__/models/db.test.js` (new)
- `jest.mock('pg', ...)` with a `Pool` mock constructor (`jest.fn()` returning an object with `query`, `connect`).
- Before each case: `jest.resetModules()`, then clear the `Pool` mock calls. Save `process.env.DATABASE_URL` once and restore it in `afterEach` (delete the key if it was originally unset).
- Because `resetModules` discards the mock instance, `require('pg')` must be re-run after the reset and before `require('../../models/db')`, so the test asserts on the same `Pool` mock that `db.js` uses.
- Cases:
  1. `DATABASE_URL='postgres://u:p@h:5432/d'` → `Pool` called once with `{ connectionString: <exact value> }`.
  2. Key deleted → `Pool` called once with zero arguments (`mock.calls[0]` has length 0).
  3. `''` → zero arguments.
  4. `'   '` → zero arguments.
- Cases 1 and 4 should also assert that the argument is exactly `{ connectionString }`, with no extra keys, and that the untrimmed value is passed through. Case 1 can use a value with surrounding whitespace, or add a fifth check for that. The spec only requires the four cases, so a padded value may go into case 1 as long as the exact value is asserted.
- At this point case 1 fails and cases 2-4 pass against the current code.

### 2. Implement: `server/models/db.js`
Replace line 3 with this logic:
```js
const url = process.env.DATABASE_URL;
const pool = url && url.trim() !== ''
  ? new Pool({ connectionString: url })
  : new Pool();
```
- Pass `url` untrimmed; trim only for the decision.
- The options object contains only `connectionString`.
- Do not log or print the URL, and do not wrap errors.
- `module.exports` stays unchanged (`query`, `transaction`).
- The module cannot throw at require time for any env value, because `url` is a string or `undefined` and `.trim()` is only called on a truthy string.

### 3. Docs
- `AGENTS.md`, Provisioning section: after the `.env` block, add a sentence saying the server reads `DATABASE_URL`, and that the `PG*` variables (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`) are the fallback when it is unset or empty.
- `server/README.md`: add the same statement near L27. Keep the existing migrate line.

### 4. Verify
- `npx jest server/__tests__/models/db.test.js` from the `server` directory, then `npm test` from the repo root. All must pass.
- Confirm that `grep` finds no logging of `DATABASE_URL` in `db.js`.
- `git diff --stat` should show only `server/models/db.js`, `server/__tests__/models/db.test.js`, `AGENTS.md` and `server/README.md`. `Engineering/bugs.md` already has an uncommitted change, so do not touch it in this stage.

## Risks
- `jest.resetModules()` combined with `jest.mock('pg')` can give the test and `db.js` different `Pool` mock instances. The mitigation is to use a `jest.mock` factory and to re-require `pg` after each reset, as in step 1.
- Out of scope, per the spec: migrations, scripts, SSL or pool options, and new env vars.
