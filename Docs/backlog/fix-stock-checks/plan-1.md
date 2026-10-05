# Plan: fix-stock-checks

Implements `specs-1.md`. No source edits were made while writing this plan.

## 1. Affected code (from graph and reads)

| File | Symbol / lines | Role |
|---|---|---|
| `server/models/inventory.js` | `transfer` L3-15 | Unconditional decrement, so stock can go negative. Its `ON CONFLICT (product_id, location)` has no matching unique constraint today. |
| `server/models/sales.js` | `create` L16-32, `updateStatus` L34-54, `remove` L56-70 | Decrement and restore stock by `product_id` only, which hits every location. `remove` also restores stock for `order_created` sales. |
| `server/models/db.js` | `transaction` | Rolls back on throw and rethrows. This is what gives atomic aborts, so no change is needed. |
| `server/index.js` | `POST /inventory/transfer` L541, `POST /sales` L638, `PATCH /sales/:id/status` L678, `DELETE /sales/:id` L709 | Routes with no validation. The Swagger JSDoc blocks sit above each route (L515-717). |
| `server/schema.sql`, `server/migrations/001_initial.sql` | `inventory` L29, `sales` L36 | Schema. `001` is not edited. |
| `server/__tests__/index.test.js` | `jest.mock` of inventory (L26) and sales (L51) | Hand-written model mocks. They must learn the new errors and the location rules. |
| `server/__tests__/models/{inventory,sales}.test.js` | | Existing model tests. They assert on the old SQL and are updated. |
| `server/scripts/generate-openapi-spec.js`, `server/openapi-spec.json`, `server/API.md`, `README.md` | | Docs. |

Callers: graft shows `Inventory.transfer`, `Sales.create`, `Sales.updateStatus` and `Sales.remove` are called only from `server/index.js` and the tests. `Sales.getById` (invoice route, L764) and the `getAll` functions are untouched. No other module depends on these functions, so the blast radius is limited to the files above.

## 2. Design decisions

- **Error signalling.** A small helper in a new file `server/models/errors.js` exports `insufficientStock()`. It returns `Object.assign(new Error('Insufficient stock'), { code: 'INSUFFICIENT_STOCK' })`. The models throw it. `db.transaction` rolls back and rethrows, so no extra cleanup is needed.
- **Validation placement.** Validation lives in `server/validation.js`, a new pure module with no DB access. It has `isNonEmptyString`, `isPositiveInt` and `isValidStatus`. Routes call it and return 400 before touching the model. This keeps 400 first and lets the model tests stay free of validation cases.
- **404 for a missing inventory row (POST /sales).** `Sales.create` selects the inventory row by `(product_id, location)` inside the transaction. If it is missing, it throws an error with `code: 'INVENTORY_NOT_FOUND'`, which the route maps to 404. Stock is never read for the sufficiency check. The `sold` path uses only the conditional `UPDATE ... WHERE quantity >= $n RETURNING id`, and zero rows returned means 409. The existence check is a separate step, so spec ordering (404 before 409) holds. For `sold` the order is: existence SELECT, then conditional UPDATE, then INSERT.
- **Trimming.** Validation trims only to test emptiness. The stored and matched value is the original string, because matching is exact and case-sensitive.
- **Route error mapping.** A shared helper `handleStockError(err, res, next)` in `server/index.js` maps `INSUFFICIENT_STOCK` to 409 `{error:'Insufficient stock'}` and `INVENTORY_NOT_FOUND` to 404 `{error:'...'}`. Anything else goes to `next(err)`. `index.js` has no error middleware today, so the helper stays local to it.
- **Restore with re-create.** Both restore paths (`updateStatus` to `order_created`, `remove` of a `sold` sale) use `INSERT INTO inventory(product_id, location, quantity) VALUES($1,$2,$3) ON CONFLICT (product_id, location) DO UPDATE SET quantity = inventory.quantity + EXCLUDED.quantity`. This needs the unique constraint from the migration.

## 3. Steps, in order

### Step 1: Migration and schema
1. Create `server/migrations/002_sales_location.sql`, as a single transaction, in this order:
   1. `ALTER TABLE sales ADD COLUMN IF NOT EXISTS location TEXT;`
   2. `UPDATE sales SET location = 'retail' WHERE location IS NULL;`
   3. Merge duplicates. Set the kept row (`MIN(id)` per group) to the summed quantity, then delete the other rows in the group:
      ```sql
      UPDATE inventory i SET quantity = s.total
        FROM (SELECT MIN(id) AS keep_id, SUM(quantity) AS total FROM inventory GROUP BY product_id, location) s
        WHERE i.id = s.keep_id;
      DELETE FROM inventory i USING (SELECT MIN(id) AS keep_id, product_id, location FROM inventory GROUP BY product_id, location) k
        WHERE i.product_id = k.product_id AND i.location = k.location AND i.id <> k.keep_id;
      ```
   4. `ALTER TABLE inventory ADD CONSTRAINT inventory_product_location_key UNIQUE (product_id, location);`
2. Update `server/schema.sql` to the final schema:
   - add `location TEXT` to `sales`
   - add `UNIQUE (product_id, location)` to `inventory`
3. Check `./script/migrate.sh` (called by `install.sh`) for how migration files are picked up. It is not in the repo glob results, so confirm it exists and that it applies `002` in order. If it is missing, note that as an open question rather than creating it.

### Step 2: Shared helpers
- Create `server/models/errors.js` with `insufficientStock()` and `inventoryNotFound()`.
- Create `server/validation.js` with `isNonEmptyString(v)` (`typeof v === 'string' && v.trim() !== ''`), `isPositiveInt(v)` (`Number.isInteger(v) && v > 0`) and `isValidStatus(v)`.
- `product_id` is "missing or empty" if it is `undefined`, `null` or `''`. Reuse a `isPresent(v)` helper for that.

### Step 3: `Inventory.transfer` (`server/models/inventory.js`)
Within `db.transaction`:
1. `UPDATE inventory SET quantity = quantity - $1 WHERE product_id=$2 AND location=$3 AND quantity >= $1 RETURNING id`.
2. If `rowCount === 0`, throw `insufficientStock()`. This covers both a missing row and a short row, and nothing has been written yet.
3. Run the existing upsert into the destination and return `rows[0]`.
The destination write happens only after the source succeeds, and the rollback also protects it. `getAll` is untouched.

### Step 4: `Sales` model (`server/models/sales.js`)
- `create(sale)`:
  - destructure `location`
  - if `status` is undefined, default it to `sold`
  - in the transaction: SELECT the inventory row by `(product_id, location)`. If it is missing, throw `inventoryNotFound()`.
  - if `status === 'sold'`: run the conditional UPDATE. If `rowCount === 0`, throw `insufficientStock()`.
  - then INSERT into `sales`, with `location` added to the column list. The conditional UPDATE comes before the INSERT, so a 409 leaves no sale row.
- `updateStatus(id, status)`:
  - SELECT the sale. If it is missing, return `null`.
  - if `sale.status === status`, return `sale` with no writes.
  - `order_created` to `sold`: conditional UPDATE on `(sale.product_id, sale.location)`. If `rowCount === 0`, throw `insufficientStock()`. Do this before the `UPDATE sales SET status`, so the status stays unchanged on failure.
  - `sold` to `order_created`: upsert restore of `sale.quantity` into `sale.location`.
  - then set the status and return `{ ...sale, status }`.
  - Legacy sales whose `location` was backfilled to `retail` follow the same path.
- `remove(id)`:
  - SELECT the sale. If it is missing, return `null`.
  - DELETE the sale.
  - restore with the upsert only when `sale.status === 'sold'`. `order_created` no longer restores.

### Step 5: Routes (`server/index.js`)
- `POST /inventory/transfer`:
  - validate `product_id`, `from` and `to` present and non-empty, `from !== to`, and `quantity` a positive integer. Return 400 `{error}`.
  - call `Inventory.transfer`, with `catch` calling `handleStockError`.
- `POST /sales`:
  - validate `product_id`, `location`, `quantity`, and `status` (only if present, so a missing `status` is allowed).
  - 400 on failure. The model signals 404 and 409.
  - the success response stays 201.
- `PATCH /sales/:id/status`:
  - validate `status` first, even when the id does not exist.
  - then call the model. A `null` result gives the unchanged empty 404, and the stock errors map to 409.
- `DELETE /sales/:id`: no validation change. Keep the empty 404. Wrap with `handleStockError` for consistency.
- Update the Swagger JSDoc for the four routes. Add `location` (required) to the `POST /sales` body and `status` to its properties. Add 400, 404 and 409 responses, and add `location` to the `GET /sales` item schema.

### Step 6: Tests (`server/__tests__/`, mirroring the code layout)
- `models/inventory.test.js`: assert the conditional SQL, that a `rowCount` of 0 throws with `code INSUFFICIENT_STOCK` and the destination upsert is not called, and that an exact-quantity transfer succeeds.
- `models/sales.test.js`: cover `create` (sold with location, `order_created` with no stock write, 409 with no INSERT, 404 on a missing row), `updateStatus` (same-status no-op, both directions, 409 leaves the status unchanged), and `remove` (sold restores and re-creates, `order_created` does not restore). The existing mock-client style in those files is the pattern to follow.
- `validation.test.js` (new, at `server/__tests__/validation.test.js`): unit tests for the helpers.
- `index.test.js`: extend the inventory and sales `jest.mock`s so they throw the coded errors (conditional decrement, per-location rows). Add route tests for the 400, 404 and 409 paths, the 400-before-404 ordering on PATCH, the case-sensitive location, and the `{ error }` bodies. The existing mock inventory `transfer` decrements unconditionally, so it must change.
- Migration check: no DB is available in Jest, so the migration is verified by review and, if a local Postgres exists, by a manual run (see risks).

### Step 7: Docs
1. Run `npm run generate-spec --prefix server` to regenerate `server/openapi-spec.json`, after the JSDoc changes. Note that the root README mentions `tools/openapi-spec.json`, which is stale.
2. Update `server/API.md` with the required `location`, the new error table, and the 400/404/409 bodies.
3. Update `README.md` (the root file, and `server/README.md` if it documents these endpoints). Correct the stale `tools/` path while there.
4. Update `server/schema.md` if it lists the `inventory` and `sales` columns.

### Step 8: Verify
Run `npm test` from the repo root. Then check the acceptance criteria in section 10 of the spec against the tests, one by one.

## 4. Risks and open questions
- `./script/migrate.sh` is referenced by `install.sh` but was not found in the file listing. The migration runner behaviour (ordering, re-runs) is unconfirmed.
- Duplicate rows with `product_id` NULL are not merged by `GROUP BY` into a unique violation, because Postgres treats NULLs as distinct in UNIQUE. The spec does not cover this case. It is accepted as is.
- The existing mocked tests do not exercise real SQL. Only the migration and the conditional UPDATE semantics rely on Postgres, so a manual run against a local database is advised before Ship.
- `POST /sales` price, discount and gst validation is out of scope and unchanged.
