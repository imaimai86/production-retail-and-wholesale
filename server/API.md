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
- `POST /inventory/transfer` – transfer quantity between locations

## Users
- `GET /users` – list users *(requires admin token)*
- `POST /users` – create a user *(requires admin token)*

## Sales
- `GET /sales` – list invoices/sales (supports `page` and `limit` query params)
- `POST /sales` – create a sale invoice
