# API Endpoints

The following REST endpoints support production, inventory and sales workflows.
Authentication is performed using the `x-auth-token` header which contains a user
id. All endpoints require this header.

## Products
- `GET /products` – list products (supports `page` and `limit` query params)
- `POST /products` – create a product
- `GET /products/:id` – get a single product
- `PUT /products/:id` – update a product
- `DELETE /products/:id` – remove a product

## Production Batches
- `GET /batches` – list production batches (supports `page` and `limit` query params)
- `POST /batches` – create a new batch

## Inventory
- `GET /inventory` – list inventory items (supports `page` and `limit`)
- `POST /inventory/transfer` – transfer quantity between locations. Body: `product_id`, `from`, `to` (different, case-sensitive), `quantity` (positive integer). `400` on invalid input, `409` `{"error":"Insufficient stock"}` if the source location lacks the quantity.

## Categories
- `GET /categories` – list categories
- `POST /categories` – create a category with GST percentage

## Users
- `GET /users` – list users *(requires admin token)*
- `POST /users` – create a user *(requires admin token)*

## Sales
- `GET /sales` – list invoices/sales (supports `page` and `limit` query params)
- `POST /sales` – create a sale invoice. `location` is required and stock is taken from that location only. `status` is optional (`order_created` or `sold`, default `sold`). `400` on invalid input, `404` if there is no inventory row for the product at the location, `409` `{"error":"Insufficient stock"}` if a `sold` sale exceeds stock.
- `PATCH /sales/:id/status` – update order status (`order_created` or `sold`). `400` on invalid status, `404` if the sale is missing, `409` `{"error":"Insufficient stock"}` when moving to `sold` without enough stock. Setting the current status is a no-op.
- `DELETE /sales/:id` – revoke a sale; a `sold` sale's quantity is restored to its location (the row is re-created if missing), an `order_created` sale restores nothing
- `GET /sales/:id/invoice` – generate billing lines for a sale
