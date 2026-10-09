# validate-create-inputs

Type: bug
Priority: P2 (normal)
Source: triage scan of `server/` (same class of bug as `fix-user-validation`). Added by the triage run; the user did not name it, so drop it if unwanted.

## Problem
`POST /categories`, `POST /products`, `PUT /products/:id` and `POST /batches` pass `req.body` straight to the model (`server/index.js`), and `POST /sales` validates only `product_id`, `location`, `quantity` and `status`. The columns are `NOT NULL` (`categories.name`, `categories.gst`, `products.name`, `products.price_retail`, `products.price_wholesale`, `batches.quantity`, `sales.price`, `sales.gst` in `server/schema.sql`) and several are foreign keys (`products.category_id`, `batches.product_id`). Reproduce: `POST /products` with `{}` or `{ "name": "x", "price_retail": 1, "price_wholesale": 1, "category_id": 999 }`. The database raises a not-null or foreign-key error and the client gets 500. Verified from the code and the schema; not run against a database.

## Expected behaviour
A bad body returns 400 `{ "error": "<message>" }`; a reference to a category or product that does not exist returns 404; neither returns 500, and a failed request changes nothing.

## Decisions
- A body that is not a plain object (`null`, array, primitive) is treated as `{}`, like `POST /users`.
- Checks run in the order listed per endpoint; the first failure is returned. Messages are `<field> is required` (missing, `null` or empty string) or the type message shown.
- `POST /categories`: `name` non-empty string (stored trimmed); `gst` a JSON number, finite, 0 to 100 (`gst must be a number between 0 and 100`).
- `POST /products` and `PUT /products/:id` (PUT stays a full replace, so the same rules): `name` non-empty string (stored trimmed); `price_retail` and `price_wholesale` finite numbers >= 0 (`<field> must be a non-negative number`); `category_id` optional (absent or `null` stores `NULL`, as today), otherwise a positive integer (`category_id must be a positive integer`).
- `POST /batches`: `product_id` positive integer; `quantity` positive integer (`quantity must be a positive integer`); `completed` optional boolean (`completed must be a boolean`).
- `POST /sales`: after the existing checks, `price` finite number >= 0; `gst` finite number 0 to 100; `discount` optional finite number >= 0 and <= `price * quantity` (`discount must be between 0 and price x quantity`). `discount` is an amount, as the invoice computes `price * quantity - discount`.
- Numbers must be JSON numbers; numeric strings are rejected.
- A foreign-key violation (Postgres code `23503`) on the insert or update returns 404: `{ "error": "category not found" }` for `category_id`, `{ "error": "product not found" }` for `batches.product_id`. Order: 400, then 404.
- `POST /sales` keeps its existing 404 (`Inventory not found for product at location`) and 409.
- Extra fields are ignored (the models already read only the known fields). Validation helpers go in `server/validation.js`.

## Scope
- In: `server/index.js` (the five routes and their swagger comments), `server/validation.js`, `server/openapi-spec.json` (regenerate).
- Out of scope: `/users`, `/inventory/transfer`, route-id handling (`validate-route-ids`), pagination (`fix-pagination-limits`), new columns or migrations.

## Tests
- `server/__tests__/validation.test.js`: each new helper.
- `server/__tests__/index.test.js` (models mocked): per endpoint, each invalid field returns 400 with the message and the model is not called; a valid body trims the name; a model error with code `23503` returns 404 with the right message.
- `server/__tests__/integration/api.integration.test.js` (real Postgres): `POST /products` with `{}` gives 400 and inserts nothing; an unknown `category_id` gives 404; the same for `POST /batches`.

## Docs
- Swagger comments and `server/openapi-spec.json` (400 and 404 responses, field constraints), `server/API.md`.

## Open questions
- none
