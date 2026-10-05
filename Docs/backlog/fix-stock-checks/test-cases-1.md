# Test cases: fix-stock-checks

Matrix for `specs-1.md` / `plan-1.md`. Red tests: they fail against the current source and pass once the plan is implemented.

Layers:
- **M** model tests with a stateful fake `db` (transaction rollback is simulated, so atomicity is observable).
- **R** route tests (`supertest`, models mocked).
- **V** pure validation/error helper tests.
- **D** static checks (migration SQL, schema.sql, OpenAPI spec, docs).

Files:
- `server/__tests__/models/inventory.test.js`
- `server/__tests__/models/sales.test.js`
- `server/__tests__/models/errors.test.js`
- `server/__tests__/validation.test.js`
- `server/__tests__/index.test.js`
- `server/__tests__/migrations/002_sales_location.test.js`
- `server/__tests__/docs/openapi-spec.test.js`

## Transfer (spec 5; AC 1-4, 8)

| ID | Layer | Case | Expected | AC |
|---|---|---|---|---|
| T-M1 | M | Transfer less than source stock to a new destination | Source decremented, destination created, returns destination row | 1 |
| T-M2 | M | Transfer to an existing destination | Quantity added; source+dest total conserved | 1 |
| T-M3 | M | Transfer exactly the available quantity | Succeeds, source row stays at 0 | 2 |
| T-M4 | M | Transfer more than source stock | Rejects `INSUFFICIENT_STOCK`, source and destination unchanged | 3 |
| T-M5 | M | No source row | Rejects `INSUFFICIENT_STOCK`, destination row not created | 3 |
| T-M6 | M | Source row has quantity 0 | Rejects `INSUFFICIENT_STOCK` | 3 |
| T-M7 | M | Failure never writes the destination | No destination INSERT issued; no negative quantity anywhere | 3 |
| T-M8 | M | `from` differs only by case from the stored location | Rejects `INSUFFICIENT_STOCK` | 8 |
| T-M9 | M | Another product at the same source location | Unchanged | 1 |
| T-R1 | R | Valid body | 200, model called with `(product_id, from, to, quantity)` | 1 |
| T-R2 | R | Missing / empty `product_id` | 400 `{error}`, model not called | 4 |
| T-R3 | R | Missing / empty / whitespace `from` | 400 | 4 |
| T-R4 | R | Missing / empty / whitespace `to` | 400 | 4 |
| T-R5 | R | `from === to` | 400 | 4 |
| T-R6 | R | `quantity` missing, 0, negative, 1.5, string, null | 400 | 4 |
| T-R7 | R | Model rejects `INSUFFICIENT_STOCK` | 409 `{error:'Insufficient stock'}` | 3 |
| T-R8 | R | `from` and `to` differ only by case | Not 400 (exact matching) | 8 |
| T-R9 | R | Unknown model error | 500 | |

## POST /sales (spec 6; AC 5-9)

| ID | Layer | Case | Expected | AC |
|---|---|---|---|---|
| S-M1 | M | `sold` at a location with enough stock | Only that location decremented; sale stores `location`, `status=sold` | 5 |
| S-M2 | M | Same product at two locations | Other location unchanged | 5 |
| S-M3 | M | `status` omitted | Defaults to `sold` and decrements | 6 |
| S-M4 | M | `sold` for exactly the stock | Succeeds, row at 0 | 6 |
| S-M5 | M | `sold` for more than stock | Rejects `INSUFFICIENT_STOCK`, no sale row, stock unchanged | 6 |
| S-M6 | M | `sold`, row exists with quantity 0 | Rejects `INSUFFICIENT_STOCK` | 6 |
| S-M7 | M | `sold`, no inventory row at location | Rejects `INVENTORY_NOT_FOUND`, no sale row | 7 |
| S-M8 | M | `order_created`, no inventory row | Rejects `INVENTORY_NOT_FOUND`, no sale row | 7 |
| S-M9 | M | `order_created` with stock | Sale created with location; stock untouched, no inventory UPDATE | 7 |
| S-M10 | M | `order_created` for more than the stock | Still created (no stock check) | |
| S-M11 | M | Location `Retail` vs stored `retail` | Rejects `INVENTORY_NOT_FOUND` | 8 |
| S-M12 | M | Missing row and short stock are different errors | Missing row gives 404 code, not 409 (404 before 409) | 7 |
| S-M13 | M | `sold` decrement uses a conditional UPDATE | SQL contains `quantity >=` | 6 |
| S-R1 | R | Valid body | 201; model receives `location` unchanged (not trimmed) and `user_id` | |
| S-R2 | R | `status` omitted / `order_created` / `sold` | 201 | |
| S-R3 | R | Missing / empty `product_id` | 400, model not called | 7 |
| S-R4 | R | `location` missing, `''`, whitespace, number, null | 400 | 7 |
| S-R5 | R | `quantity` missing, 0, negative, 1.5, string | 400 | |
| S-R6 | R | `status` `bogus`, `''`, `shipped` | 400 | 9 |
| S-R7 | R | Model rejects `INVENTORY_NOT_FOUND` | 404 `{error}` | 7 |
| S-R8 | R | Model rejects `INSUFFICIENT_STOCK` | 409 `{error:'Insufficient stock'}` | 6 |
| S-R9 | R | Validation failure and a would-be 404 | 400 wins, model not called | |

## PATCH /sales/:id/status (spec 7; AC 9-12)

| ID | Layer | Case | Expected | AC |
|---|---|---|---|---|
| P-M1 | M | Unknown id | Returns `null`, no writes | |
| P-M2 | M | `order_created` -> `sold`, enough stock | Own location decremented, others unchanged, status `sold` | 10 |
| P-M3 | M | `order_created` -> `sold`, short stock | Rejects `INSUFFICIENT_STOCK`; status stays `order_created`; stock unchanged | 10 |
| P-M4 | M | `order_created` -> `sold`, no row | Rejects `INSUFFICIENT_STOCK` (409, not 404); status unchanged | 10 |
| P-M5 | M | `sold` -> `sold`, stock 0 | No-op: returns sale, no writes, no stock check | 11 |
| P-M6 | M | `order_created` -> `order_created` | No-op | |
| P-M7 | M | `sold` -> `order_created` | Quantity restored to the sale's location only; status updated | 12 |
| P-M8 | M | `sold` -> `order_created`, row gone | Row re-created with restored quantity | 12 |
| P-R1 | R | Invalid / missing `status` on an existing id | 400, model not called | 9 |
| P-R2 | R | Invalid / missing `status` on a non-existent id | 400 (not 404) | 9 |
| P-R3 | R | Unknown id, valid status | 404 with empty body | |
| P-R4 | R | Model rejects `INSUFFICIENT_STOCK` | 409 `{error:'Insufficient stock'}` | 10 |
| P-R5 | R | Valid status change | 200 with the sale | |

## DELETE /sales/:id (spec 8; AC 12-13)

| ID | Layer | Case | Expected | AC |
|---|---|---|---|---|
| D-M1 | M | Unknown id | Returns `null` | |
| D-M2 | M | Delete a `sold` sale | Sale removed, quantity restored to its location only | 12 |
| D-M3 | M | Delete a `sold` sale, row gone | Row re-created with restored quantity | 12 |
| D-M4 | M | Delete an `order_created` sale | Sale removed, stock unchanged | 13 |
| D-M5 | M | Delete an `order_created` sale, row gone | No row created | 13 |
| D-R1 | R | Unknown id | 404 with empty body (unchanged) | |
| D-R2 | R | Existing id | 200 with the sale | |

## Helpers (plan step 2)

| ID | Layer | Case | Expected |
|---|---|---|---|
| H-1 | V | `isNonEmptyString` | True only for strings with non-whitespace content |
| H-2 | V | `isPositiveInt` | True only for integers > 0 (not strings, floats, 0, negatives, NaN) |
| H-3 | V | `isValidStatus` | True only for `order_created` and `sold` |
| H-4 | V | `isPresent` | False for `undefined`, `null`, `''` |
| H-5 | V | `insufficientStock()` | `Error`, message `Insufficient stock`, code `INSUFFICIENT_STOCK` |
| H-6 | V | `inventoryNotFound()` | `Error`, non-empty message, code `INVENTORY_NOT_FOUND` |

## Migration, schema, docs (spec 4; AC 14-15)

| ID | Layer | Case | Expected | AC |
|---|---|---|---|---|
| G-1 | D | `002_sales_location.sql` exists | File present | 14 |
| G-2 | D | Adds `sales.location` text | `ALTER TABLE sales ADD COLUMN ... location TEXT` | 14 |
| G-3 | D | Backfills `retail` | `UPDATE sales SET location = 'retail'` | 14 |
| G-4 | D | Merges duplicates by summing | `SUM(quantity)` and a `DELETE FROM inventory` | 14 |
| G-5 | D | Adds UNIQUE `(product_id, location)` | Constraint present | 14 |
| G-6 | D | Order: add column, backfill, merge, then constraint | Constraint comes after the merge | 14 |
| G-7 | D | `schema.sql` | `sales.location`, `UNIQUE (product_id, location)` on inventory | 14 |
| G-8 | D | OpenAPI spec | `POST /sales` requires `location`; 400/404/409 on sales POST, transfer and PATCH | 15 |
| G-9 | D | `API.md` | Mentions `location` and `Insufficient stock` | 15 |

## Not covered
- Real Postgres semantics (conditional UPDATE, `ON CONFLICT`, the migration run). Verify manually against a local database before Ship (plan, risks).
- Concurrency (out of scope per spec).
- README wording (only `API.md` and the OpenAPI spec are asserted).
- `./script/migrate.sh` ordering (open question in the plan).
