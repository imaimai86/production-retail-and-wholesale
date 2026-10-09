# fix-pagination-limits

Type: bug
Priority: P3 (nice to have)
Source: triage scan of `server/`; user: "good to have".

## Problem
Six list routes in `server/index.js` (`GET /users`, `/categories`, `/products`, `/batches`, `/inventory`, `/sales`) each repeat `parseInt(req.query.page) || 1` and `parseInt(req.query.limit) || 10`, then `offset = (page - 1) * limit`. Reproduce: `GET /products?page=-1` gives a negative `OFFSET`, and `GET /products?limit=-5` a negative `LIMIT`; Postgres rejects both and the client gets 500. A very large `page` gives an offset beyond the `bigint` range, also 500. `limit` has no upper bound, so `limit=1000000` reads the whole table. Verified from the code; not run against a database.

## Expected behaviour
Bad paging values return 400 with a clear message instead of 500, and one request can never ask for more than 100 rows.

## Decisions
- A new helper `parsePagination(query)` in `server/validation.js` replaces the six copies. It returns `{ limit, offset }` or an error message.
- Absent or non-numeric `page` or `limit` (`parseInt` gives `NaN`) keeps today's defaults: page 1, limit 10.
- `page` that parses to an integer below 1 or above 1000000 returns 400 `{ "error": "page must be an integer between 1 and 1000000" }`. This includes `0`, which today silently falls back to 1.
- `limit` that parses to an integer below 1 returns 400 `{ "error": "limit must be a positive integer" }`.
- `limit` above 100 is clamped to 100, with no error (not breaking for existing clients).
- Order: auth (401, 403) first, then the 400, then the query. The 400 is returned before any database call.
- Response bodies and the SQL in the models do not change.

## Scope
- In: `server/index.js` (the six list routes and their swagger comments), `server/validation.js`, `server/openapi-spec.json` (regenerate).
- Out of scope: total counts, `Link` headers or a new response shape, cursor pagination, sorting, the models.

## Tests
- `server/__tests__/validation.test.js`: `parsePagination` for absent, non-numeric, `0`, negative, `1000001`, `limit=101` (clamped to 100), and the offset arithmetic.
- `server/__tests__/index.test.js` (models mocked): for each of the six routes, `page=-1` and `limit=0` give 400 and the model is not called; `limit=500` calls the model with `limit: 100`; defaults still call it with `limit: 10, offset: 0`.
- `server/__tests__/integration/api.integration.test.js` (real Postgres): `GET /products?page=-1` gives 400, not 500.

## Docs
- Swagger comments and `server/openapi-spec.json` (`limit` maximum 100, 400 response), `server/API.md`.

## Open questions
- none
