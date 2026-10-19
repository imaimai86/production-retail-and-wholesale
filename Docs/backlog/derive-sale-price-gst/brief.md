# derive-sale-price-gst

Type: bug
Priority: P0 (security or data loss)
Source: report "POST /sales currently trusts the price and gst sent by the client"

## Problem
`POST /sales` stores whatever `price`, `gst` and `discount` the client sends. Any caller can sell a product at any price, at any GST rate and with any discount. The stored values then flow into `GET /sales/:id/invoice`, which makes the GST invoices wrong.

Reproduce: `POST /sales` with `{ "product_id": 1, "location": "retail", "quantity": 1, "price": 0.01, "gst": 0, "discount": 0 }`. The response is 201, and the sale is stored at 0.01 with 0% GST, whatever `products.price_retail` and `categories.gst` say.

Verified cause, from the code (not run against a database):
- `server/index.js:679-694`: the route checks only `product_id`, `location`, `quantity` and `status`, then calls `Sales.create({ ...req.body, user_id })`.
- `server/models/sales.js:22-40`: `create` takes `price`, `discount` and `gst` from its argument and inserts them unchanged. It never reads `products.price_retail` / `products.price_wholesale` (`server/schema.sql`) or `categories.gst`.

## Expected behaviour
The server sets the sale's price and GST. The price comes from the product and the chosen price tier, and the GST rate comes from the product's category. A client that sends `price`, `gst` or a non-zero `discount` gets a 400 and nothing changes. The 201 response shows the values that were stored.

## Decisions
- New optional body field `price_tier`: `"retail"` or `"wholesale"`, default `"retail"`. Any other value, including a non-string, returns 400 `{ "error": "price_tier must be retail or wholesale" }`.
- `price` is the product's `price_retail` for `retail` and its `price_wholesale` for `wholesale`, read when the sale is created and stored on the row. Later product price changes do not alter existing sales.
- `gst` is the `gst` of the product's category. A product whose `category_id` is `NULL` gets `gst` 0, and the sale is allowed.
- If the body has a `price` or a `gst` key, whatever its value (even `null`), the request returns 400 `{ "error": "price and gst are set by the server" }`.
- Discounts are not allowed for now. If `discount` is present and is anything other than the number `0`, the request returns 400 `{ "error": "discount is not allowed" }`. An absent `discount` or `discount: 0` is accepted. The stored `discount` is always `0`.
- Validation order: the existing checks (`product_id`, `location`, `quantity`, `status`), then `price`/`gst`, then `discount`, then `price_tier`, all 400. After that come product not found, 404 `{ "error": "Product not found" }`; the existing inventory 404 (`Inventory not found for product at location`); and the existing 409 `Insufficient stock`. The first failure is returned.
- The product and category lookup runs inside the existing `db.transaction` in `Sales.create`, before the inventory check, as one query (`products LEFT JOIN categories`). The product-not-found error is a new helper in `server/models/errors.js` (code `PRODUCT_NOT_FOUND`), mapped to 404 by the route's error handling, as `inventoryNotFound` is.
- A failed request (any 400, 404 or 409) changes no inventory row and inserts no sales row.
- New column `sales.price_tier TEXT NOT NULL DEFAULT 'retail' CHECK (price_tier IN ('retail','wholesale'))`, returned in the 201 body and by `GET /sales`. The app is not live yet, so per the product owner there is **no new migration file**: add the column to the `sales` table in both `server/schema.sql` and `server/migrations/001_initial.sql` (`./script/migrate.sh` and `install.sh` build databases from the migrations only, so `schema.sql` alone is not enough). Existing local databases have to be recreated, and that goes in the docs.
- `PATCH /sales/:id/status`, `DELETE /sales/:id` and `GET /sales/:id/invoice` keep using the stored `price`, `gst` and `discount`. No change to them.

## Scope
- In: `POST /sales` in `server/index.js` (route and its swagger comment), `Sales.create` in `server/models/sales.js`, `server/models/errors.js`, `server/validation.js` (a `isValidPriceTier` helper), `server/schema.sql`, `server/migrations/001_initial.sql`, `server/openapi-spec.json` (regenerate).
- Out of scope: role-based discounts or price overrides (`add-jwt-login-acl`), invoice rounding (`fix-invoice-rounding`), null-body handling (`fix-null-body-crash`), validation of `/categories`, `/products` and `/batches` (`validate-create-inputs`), customers and customer-level pricing, `PATCH /sales/:id/status`, the invoice endpoint, and new migration files.

## Tests
- `server/__tests__/validation.test.js`: `isValidPriceTier` accepts `retail` and `wholesale` and rejects other strings, `null`, numbers and `undefined`. The route treats a missing `price_tier` as `retail` before calling the helper.
- `server/__tests__/index.test.js` (models mocked):
  - A body with `price`, with `gst`, or with `price: null` returns 400 `price and gst are set by the server`, and `Sales.create` is not called.
  - `discount: 5` and `discount: "0"` return 400 `discount is not allowed`. `discount: 0` and an absent discount reach `Sales.create`.
  - `price_tier: "vip"` returns 400 with the message. Absent `price_tier` passes `retail`, and `wholesale` passes `wholesale`.
  - A model error with code `PRODUCT_NOT_FOUND` returns 404 `Product not found`.
  - The validation order: a body that fails both `quantity` and `price` gets the `quantity` message.
  - Update the existing `POST /sales` tests that send `price`/`gst` (around lines 144, 290, 358, 393) so they no longer send them.
- `server/__tests__/models/sales.test.js` (db mocked):
  - `retail` stores `price_retail` and `wholesale` stores `price_wholesale`, with the category's gst.
  - A product with a `NULL` category stores gst 0.
  - A product that does not exist throws `PRODUCT_NOT_FOUND` before any inventory query, and nothing is inserted.
  - Values in the input argument (`price`, `gst`, `discount`) are never used. The stored discount is 0.
- `server/__tests__/integration/api.integration.test.js` (real Postgres): with a category at gst 18 and a product with retail 100 and wholesale 80, a retail sale stores price 100 and gst 18, and a wholesale sale stores price 80. A product without a category stores gst 0. A body with `price` gives 400 and leaves inventory and sales unchanged. An unknown `product_id` gives 404 and changes nothing.
- Every case runs the real code. No test reads or asserts on documentation.

## Docs
- `server/API.md`: `POST /sales` takes `price_tier`, rejects `price`/`gst`/`discount`, and has the new 404.
- `server/schema.md`: the `sales.price_tier` column, and a note that local databases need to be recreated.
- Swagger comment on `POST /sales` and `server/openapi-spec.json`: remove `price`, `gst` and `discount` from the request body, add `price_tier`, add the 404.

## Open questions
- `validate-create-inputs` still says `POST /sales` must validate a client `price` (>= 0), `gst` (0-100) and `discount` (0 to price × quantity). That contradicts this item. Whichever item runs second has to drop that `POST /sales` bullet; that brief was left unchanged on purpose.
