
## Round 1 (2026-10-06)

### Q1: What `x-auth-token` value do the API integration tests send?
`Auth.verify` sets `req.userId` to the raw token, and `POST /sales` stores it in `sales.user_id`, which is an `INTEGER` foreign key to `users(id)`. A non-numeric token (e.g. `test`) makes the insert fail with a Postgres error and a 500. A numeric token with no matching `users` row fails the foreign key. The brief only says "header `x-auth-token` set", so the value and any seeding are unspecified.
**Suggested:** Each API test seeds a `users` row, reads its id, and sends that id as a string in `x-auth-token`. No `ADMIN_TOKEN` is needed, since no admin-only endpoints are exercised.
**Answer:** accept

### Q2: Which request returns 404 for the "unknown location" API case?
`POST /inventory/transfer` from a location with no stock row returns 409 `Insufficient stock`, not 404. Only `POST /sales` (no inventory row for the product at that location) returns 404, with `{ "error": "Inventory not found for product at location" }`. The brief says only "unknown location returns 404".
**Suggested:** The case is `POST /sales` with a location that has no inventory row for the product. It expects 404 with the body above, no `sales` row created and no inventory change. Transfer from a location with no row is covered by the 409 case.
**Answer:** accept

### Q3: How exactly does the schema-drift comparison treat naming and column order?
Applying `001`+`002` and applying `schema.sql` give different unnamed details. The constraint is named `inventory_product_location_key` by the migration and `inventory_product_id_location_key` by Postgres for `schema.sql`. `sales.location` is added last by `002`, but sits before `user_id` and `created_at` in `schema.sql`, so `ordinal_position` differs. A literal comparison would fail even though the schemas are equivalent.
**Suggested:** Compare `sales` and `inventory` columns as sets of (`column_name`, `data_type`, `is_nullable`, `column_default`), ignoring `ordinal_position`. Compare constraints by type and column list from `pg_constraint`, ignoring constraint names. The PRIMARY KEY, FOREIGN KEYs and the UNIQUE (`product_id`, `location`) must match.
**Answer:** accept
