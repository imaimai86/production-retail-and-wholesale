# Spec: fix-stock-checks

## 1. Goal
Stop inventory quantity from ever going negative. Inventory transfers and sales must check stock atomically, and sales must act on a single, specific inventory location instead of every row for a product.

## 2. Scope
- `Inventory.transfer` (`server/models/inventory.js`) and `POST /inventory/transfer`.
- `Sales.create`, `Sales.updateStatus`, `Sales.remove` (`server/models/sales.js`) and `POST /sales`, `PATCH /sales/:id/status`, `DELETE /sales/:id`.
- Database: new migration `002_sales_location.sql`, and `schema.sql` updated to match.
- Docs: `server/openapi-spec.json` (regenerated), `server/API.md`, README.
- Out of scope: concurrency tests, changes to `order_created` decrement behaviour, other endpoints.

## 3. Common rules
- **Error body.** Every new 400, 404 and 409 returns JSON `{ "error": "<message>" }`. The 409 message is exactly `Insufficient stock`. For 400 and 404 only the status and a non-empty string `error` are specified, not the exact text. Existing sale-not-found 404s (empty body) are unchanged.
- **Validation order.** All 400 validation first, then 404, then 409.
- **Atomicity.** A failed request persists nothing: no sale row, no status change, no stock movement. Stock is checked and decremented with a single conditional `UPDATE ... WHERE quantity >= n` inside the transaction, with no separate read.
- **Signalling.** The model layer signals insufficient stock with an error whose `code` is `INSUFFICIENT_STOCK`. Routes map it to 409. The rest of the design is left to the plan.
- **Location matching.** Exact and case-sensitive (`Retail` does not match `retail`).
- **Location validity.** `location`, `from` and `to` must be non-empty strings after trimming. Empty, whitespace-only, missing or non-string values return 400.
- **Quantity validity.** `quantity` must be an integer greater than 0. Missing, non-integer or <= 0 values return 400. The same rule applies to transfers and to sales.

## 4. Database changes (`002_sales_location.sql`)
1. Add column `sales.location` (text).
2. Backfill all existing sales rows with `retail`.
3. Merge existing duplicate `(product_id, location)` rows in `inventory` by summing quantities into one row.
4. Add a UNIQUE constraint on `inventory(product_id, location)`.
5. `schema.sql` reflects the final schema: `sales.location`, and the unique constraint on inventory.

The merge must run before the constraint is added.

## 5. POST /inventory/transfer
**Input (JSON):** `product_id`, `from`, `to`, `quantity`.

**Validation (400):**
- `product_id`, `from` or `to` missing or empty.
- `from === to`.
- `quantity` missing, non-integer or <= 0.

**Behaviour:**
- Within one transaction, conditionally decrement the source row (`quantity >= n`).
- If the source row does not exist or has less than `quantity`, abort with 409 `Insufficient stock`. Nothing is changed, including the destination.
- Transferring exactly the available quantity is allowed. The source row then has quantity 0.
- On success, upsert the destination row (create it if missing, otherwise add the quantity). The success response is unchanged: the destination row.

## 6. POST /sales
**Input:** `product_id`, `location` (required), `quantity`, `price`, `discount`, `gst`, `status`, `user_id`.

**Validation (400):**
- `product_id` missing or empty.
- `location` missing, non-string or empty after trim.
- `quantity` invalid (see section 3).
- `status` present but not `order_created` or `sold`. A missing `status` defaults to `sold`.

**Existence (404):** if the product has no inventory row at `location`, return 404. This applies to every status, including `order_created`.

**Behaviour:**
- Store `location` on the sale row.
- `status = sold`: conditionally decrement only that location's row (`quantity >= n`). If the stock is insufficient, return 409 and create no sale row.
- `status = order_created`: create the sale and do not touch stock, as today.
- No inventory row at any other location is changed.

## 7. PATCH /sales/:id/status
**Input:** `status`.

**Validation (400):** `status` missing, or not `order_created` or `sold`. This is checked first, so it returns 400 even if the sale id does not exist.

**Then:**
- Sale not found: 404 (unchanged empty body).
- New status equals the current status (e.g. `sold` -> `sold`): no-op. Return the sale, with no stock check and no stock change.
- `order_created` -> `sold`:
  - Conditionally decrement the sale's own location row.
  - If the row is missing or has too little stock, return 409 `Insufficient stock`. The status is not changed.
- `sold` -> `order_created`:
  - Restore `sale.quantity` to the sale's own location.
  - If that inventory row no longer exists, re-create it with the restored quantity.
- A failed request leaves the sale status and stock unchanged.

## 8. DELETE /sales/:id
- Sale not found: 404 (unchanged).
- A `sold` sale: delete it and restore its quantity to the sale's own location. If the inventory row no longer exists, re-create it with the restored quantity.
- An `order_created` sale: delete it and do not restore stock, because it never decremented stock.

## 9. Error summary
| Condition | Status | Body |
|---|---|---|
| Any validation failure in sections 5-7 | 400 | `{ "error": "..." }` |
| POST /sales: no inventory row for product+location | 404 | `{ "error": "..." }` |
| Sale id not found | 404 | unchanged |
| Transfer: source row missing or short | 409 | `{ "error": "Insufficient stock" }` |
| Sale `sold` (create, or PATCH to `sold`): row missing or short | 409 | `{ "error": "Insufficient stock" }` |

## 10. Acceptance criteria
1. A transfer with sufficient stock moves the quantity, and the source plus destination totals are conserved.
2. A transfer of exactly the available quantity succeeds and leaves the source at 0.
3. A transfer that exceeds the source stock, or has no source row, returns 409. Source and destination are unchanged and no quantity is negative.
4. A transfer with `from === to`, a missing or empty `product_id`/`from`/`to`, or an invalid quantity returns 400.
5. A sold sale at a location decrements only that location. Other locations of the same product are unchanged.
6. A sold sale for more than the location's stock returns 409 and creates no sale row.
7. POST /sales with missing, empty or whitespace `location`, or missing `product_id`, returns 400. An unknown product+location returns 404 for both `sold` and `order_created`.
8. Location matching is case-sensitive.
9. An invalid or missing `status` returns 400 on POST (invalid only) and PATCH. PATCH with an invalid status on a non-existent id returns 400.
10. PATCH `order_created` -> `sold` decrements the sale's location, and returns 409 if there is not enough stock or no row. The status stays `order_created` on failure.
11. PATCH `sold` -> `sold` is a no-op even when stock is zero.
12. PATCH `sold` -> `order_created` and DELETE of a `sold` sale restore stock to the sale's location, re-creating the row if it is missing.
13. DELETE of an `order_created` sale does not change stock.
14. The migration adds `sales.location`, backfills `retail`, merges duplicate inventory rows by summing, and adds the unique constraint. `schema.sql` matches.
15. `server/openapi-spec.json` (regenerated), `server/API.md` and README document the 400/404/409 responses and the required `location`.
16. Tests live in `server/__tests__/`, mirroring the code layout. `npm test` passes from the repo root.
