# Server API Reference

This directory contains the backend server for the production, inventory, and sales management system. It is built with **Node.js** and **Express**.

Below is a list of the main REST APIs derived from the project requirements outlined in the root `README.md`.

## Authentication and Users
- `POST /api/auth/login` – authenticate a user
- `POST /api/auth/logout` – end a user session
- `POST /api/users` – create an account (admin, sales staff, production worker)
- `GET /api/users` – list users
- `GET /api/users/:id` – retrieve a user
- `PUT /api/users/:id` – update a user
- `DELETE /api/users/:id` – remove a user

## Products
- `POST /api/products` – create a product or SKU
- `GET /api/products` – list products
- `GET /api/products/:id` – fetch a single product
- `PUT /api/products/:id` – update product details
- `DELETE /api/products/:id` – delete a product

## Production Batches
- `POST /api/batches` – create a production batch
- `GET /api/batches` – list batches
- `GET /api/batches/:id` – fetch batch info
- `PUT /api/batches/:id` – update batch status or quantities
- `DELETE /api/batches/:id` – remove a batch record

## Inventory Management
- `GET /api/inventory/levels` – view stock levels by location (production unit vs. retail shop)
- `POST /api/inventory/transfers` – move products between locations

## Sales and Invoicing
- `POST /api/invoices` – create an invoice or receipt (retail or wholesale)
- `GET /api/invoices` – list invoices
- `GET /api/invoices/:id` – retrieve invoice details
- `PUT /api/invoices/:id` – update an invoice
- `DELETE /api/invoices/:id` – delete or void an invoice

## Discounts and Pricing
- `POST /api/discounts` – define a discount
- `GET /api/discounts` – list active discounts
- `PUT /api/discounts/:id` – update a discount
- `DELETE /api/discounts/:id` – remove a discount

## GST and Accounting
- `GET /api/gst/rates` – fetch GST rates
- `POST /api/gst/rates` – update GST rates
- `GET /api/gst/summary` – report GST totals for compliance

## Warranty and Repairs
- `POST /api/repairs` – log a warranty or repair request
- `GET /api/repairs` – list repairs and warranty claims

These endpoints provide a foundation to implement the features listed in the root project README: inventory tracking, production management, sales with GST and discount handling, and product movement between locations.
