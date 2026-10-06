# Review 1: fix-database-url

Reviewed `git diff f686cf0` against `specs-1.md`.

**Result: no source changes needed.**

- `server/models/db.js` matches the spec table. A non-blank `DATABASE_URL` gives `new Pool({ connectionString: url })` with the untrimmed value. Unset, empty or whitespace-only gives `new Pool()` with no arguments.
- The export shape and the `transaction` semantics are unchanged. The module does not log the URL or wrap errors, and requiring it cannot throw because of `DATABASE_URL`.
- `AGENTS.md` and `server/README.md` document `DATABASE_URL` with the `PG*` fallback.
- `npm test`: 12 suites and 148 tests pass, including `models/db.test.js`.

Notes (no action):
- `Engineering/bugs.md` also gained two unrelated entries (HTML stack trace, `POST /users` docs). They are outside this spec's scope but harmless.
- `server/.env` is untracked and holds credentials. Make sure it stays out of the commit.
