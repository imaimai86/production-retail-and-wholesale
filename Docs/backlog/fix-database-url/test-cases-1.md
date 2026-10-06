# Test cases: fix-database-url

Spec: `specs-1.md`. Plan: `plan-1.md`. Tests: `server/__tests__/models/db.test.js` (mocks `pg`; `jest.resetModules()` before each load because the pool is built at require time).

## Matrix

| # | Test | `DATABASE_URL` | Expected | Spec ref | Fails on current code? |
|---|---|---|---|---|---|
| 1 | uses connectionString when set | `postgres://u:p@h:5432/d` | `Pool` called once with `{ connectionString: <value> }`, only that key | AC1, spec test 1 | Yes |
| 2 | passes the untrimmed value through | `'  postgres://u:p@h:5432/d  '` | `connectionString` is the exact padded value | Behaviour bullet 1, AC1 | Yes |
| 3 | unset | key deleted | `Pool` called once, zero arguments | AC2, spec test 2 | No (regression guard) |
| 4 | empty | `''` | zero arguments | AC2, spec test 3 | No (regression guard) |
| 5 | whitespace only | `'   '` | zero arguments | AC2, spec test 4 | No (regression guard) |
| 6 | tab/newline only | `'\t\n '` | zero arguments | AC2 (trim edge) | No (regression guard) |
| 7 | require never throws | unset, `''`, `'   '`, `'not a url'`, valid URL | `require` does not throw | Error cases | No (regression guard) |
| 8 | export shape | valid URL | keys are exactly `query`, `transaction`, both functions | AC4 | No (regression guard) |
| 9 | no logging | URL with password | no `console.*` call at require time | AC5 | No (regression guard) |
| 10 | `query` delegates | valid URL | `pool.query(text, params)` called, result returned | AC4 | No (regression guard) |
| 11 | `transaction` success | valid URL | BEGIN, COMMIT, result returned, client released once | AC4 | No (regression guard) |
| 12 | `transaction` failure | valid URL | BEGIN, ROLLBACK, original error rethrown unchanged (same object, so no URL added), client released once | AC4, AC5, Error cases | No (regression guard) |

## Not covered by automated tests
- AC3 (real connection with only `DATABASE_URL`): needs a live Postgres. Verify manually, or in Review.
- AC7 (docs in `AGENTS.md` and `server/README.md`): documentation check at Review. Existing `server/__tests__/docs` may be extended if it covers these files.
- "No logging anywhere" beyond require time (error messages from `pg`) is out of the module's control. Case 12 covers that the module does not wrap errors.
