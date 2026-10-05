# fix-stock-checks

Source: Engineering/bugs.md.

- `Inventory.transfer` (server/models/inventory.js) must abort inside its transaction when the source location has less than the requested quantity, or no row. Quantity must never go negative.
- `Sales.create` and `Sales.updateStatus` (server/models/sales.js) must refuse a sale that would take stock below zero when the status is `sold`.
- Sales currently decrement every inventory row for a product; they should decrement a specific location.
- API: insufficient stock returns HTTP 409 with `{ "error": "Insufficient stock" }` from POST /inventory/transfer and POST /sales, PATCH /sales/:id/status.
- Tests live in server/__tests__ mirroring the code layout.

## Decisions (answers to questions.md)
- POST /sales takes a required `location` field; the sale stores it in a new `sales.location` column (new migration, e.g. 002_sales_location.sql, and schema.sql updated).
- Existing sales rows backfill to location `retail`.
- Missing `location` -> 400. Unknown location (no inventory row for product+location) -> 404. Insufficient stock -> 409 `{ "error": "Insufficient stock" }`.
- Sales create/updateStatus decrement only that location. updateStatus and remove restore stock to the sale's own location.
- order_created handling: unchanged (does not decrement), but remove must not restore stock for an order_created sale that never decremented it. Restore only for `sold`.
- PATCH to the same status (e.g. sold -> sold) is a no-op with no stock check.
- Inventory.transfer: from == to -> 400; quantity missing, non-integer or <= 0 -> 400 (same validation for sale quantity); transferring exactly the available quantity is allowed. Source with no row or too little stock -> 409.
- Atomicity: use a conditional `UPDATE ... WHERE quantity >= $n` inside the transaction (no separate read). No concurrency test required.
- A failed request persists nothing (no sale row, no status change, no stock move).
- Insufficient stock is signalled to routes by an error with `code = 'INSUFFICIENT_STOCK'`; planner may decide the rest.
- Update server/openapi-spec.json (regenerate), server/API.md and README to document the 409/400/404 responses.

## Decisions round 2 (answers to questions.md)
1. POST /sales: `location` is required (400) and must exist for the product (404) for EVERY status, including `order_created`.
2. PATCH to `sold` when the stored location has no inventory row for the product -> 409 Insufficient stock.
3. Restoring stock (sold -> order_created via PATCH, or DELETE of a sold sale) when the location's inventory row no longer exists: re-create the row with the restored quantity.
4. `status` must be `order_created` or `sold`; any other value -> 400 on POST /sales and PATCH /sales/:id/status. Missing `status` on PATCH -> 400. On POST, missing status keeps the existing default (`sold`).
5. PATCH sold -> order_created restores stock to the sale's own location. Confirmed.
6. Validation order: all 400 validation first, then 404, then 409.
7. Inventory.transfer: missing or empty `product_id`, `from` or `to` -> 400.

## Decisions round 3 (answers to questions.md)
1. Add a UNIQUE constraint on `inventory(product_id, location)` in the same migration `002_sales_location.sql` (alongside `sales.location` and the `retail` backfill), and update `schema.sql` to match. Before adding it, the migration merges existing duplicate (product_id, location) rows by summing quantities.
2. PATCH /sales/:id/status validates `status` first: invalid or missing status -> 400 even if the sale id does not exist (400 before 404 before 409).
3. `location` must be a non-empty string after trimming; empty, whitespace-only or non-string -> 400. Matching is exact and case-sensitive (`Retail` does not match `retail`).
