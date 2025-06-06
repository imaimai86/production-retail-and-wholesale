# Server Implementation Plan

This directory contains the backend server code for the production, inventory,
and sales management system. It uses **Node.js** with **Express**.

## Action Plan
1. **Define Scope and Requirements**
   - Track production batches, inventory levels, and sales.
   - Support GST-compliant invoicing with wholesale and retail pricing.
   - Handle product movement between the production unit and retail shop.
   - Provide discount functionality and warranty/repair tracking.
2. **Technology Stack**
   - Express-based REST API written in Node.js.
   - Data stored in a database such as PostgreSQL or MongoDB.
3. **API Endpoints**
   - Products: CRUD operations for product catalog.
   - Production: manage manufacturing batches and completion.
   - Inventory: transfer stock between locations.
   - Sales: create invoices and receipts with GST and discounts.
4. **Testing**
   - Use Jest and Supertest for unit and integration tests.
   - Validate GST calculations and inventory workflows.

This plan complements the high-level project plan in the repository root and guides development of the server APIs.

## Database Migrations
Run ./script/migrate.sh after setting the DATABASE_URL environment variable to apply schema updates.

## Docker Usage

The `Dockerfile` and `docker-compose.yml` in this folder provide a simple way to run the server with PostgreSQL. Common tasks are wrapped in the repository root `Makefile`:

```bash
make build    # build images
make up       # start containers in the background
make down     # stop the stack
make migrate  # apply database migrations
make backup   # dump the database to backup/manual_backup.sql
make restore  # restore the dump into the running database
```

The database container automatically imports a previous dump on startup and exports a fresh one on shutdown via `db-entrypoint.sh`.
