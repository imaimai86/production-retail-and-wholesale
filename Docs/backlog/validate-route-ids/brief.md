# validate-route-ids

Type: bug
Priority: P2 (normal)
Source: triage scan of `server/`; user decision: an invalid id returns 404, not 500.

## Problem
The routes that take an `:id` pass `req.params.id` straight to a query on an `INTEGER` column (`products.id`, `sales.id`), in `server/index.js`: `GET`, `PUT` and `DELETE /products/:id`, `PATCH /sales/:id/status`, `DELETE /sales/:id` and `GET /sales/:id/invoice`. An id such as `abc`, `1.5` or `99999999999` makes Postgres raise an invalid-input or out-of-range error and the client gets 500. Also, `DELETE /products/:id` on a product still referenced by `inventory`, `batches` or `sales` raises a foreign-key error (code `23503`) and returns 500. Verified from the code and the schema; not run against a database.

## Expected behaviour
- An id that cannot be a row id returns 404 (empty body, like the existing not-found responses), never 500.
- Deleting a product that is still referenced returns 409 `{ "error": "Product is in use" }`.

## Decisions
- A valid id matches `/^[1-9][0-9]*$/` and is <= 2147483647 (the `INTEGER` maximum). Anything else (`abc`, `0`, `-1`, `1.5`, `007`, `1e3`, empty, too large) is invalid. The predicate `isValidId` lives in `server/validation.js`.
- An invalid id returns `res.status(404).end()` before any database query, so nothing changes.
- Order for `PATCH /sales/:id/status`: body check (400) first, then id (404), then the lookup (404), then stock (409).
- `DELETE /products/:id` with a valid id that does not exist still returns 204 (unchanged, out of scope).
- `DELETE /products/:id` maps a Postgres `23503` error to 409 `{ "error": "Product is in use" }`; other errors go to `next(err)`.
- `DELETE /sales/:id` already maps stock errors; only the id check is added.

## Scope
- In: `server/index.js` (the six routes and their swagger comments), `server/validation.js`, `server/openapi-spec.json` (regenerate).
- Out of scope: create-input validation (`validate-create-inputs`), pagination (`fix-pagination-limits`), changing 204 for a missing product, any `/inventory` route.

## Tests
- `server/__tests__/validation.test.js`: `isValidId` for the valid and invalid forms above.
- `server/__tests__/index.test.js` (models mocked): each of the six routes with `abc` and `99999999999` returns 404 and the model is not called; `PATCH /sales/abc/status` with a bad status returns 400; `DELETE /products/1` with a model error of code `23503` returns 409.
- `server/__tests__/integration/api.integration.test.js` (real Postgres): `GET /products/abc` gives 404; deleting a product that has an inventory row gives 409 and the product is still there.

## Docs
- Swagger comments and `server/openapi-spec.json` (404 on the six operations, 409 on `DELETE /products/{id}`), `server/API.md`.

## Open questions
- none
