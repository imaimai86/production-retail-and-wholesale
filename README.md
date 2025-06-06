# production-retail-and-wholesale
Supports production, sales, billing and inventory management

## Implementation Plan

1. **Define Scope and Requirements**
   - Inventory tracking for items and batches across the production unit and retail shop.
   - Production workflow management to track raw materials and manufacturing batches.
   - Sales management with invoices and receipts.
   - GST-compliant accounting and tax calculations.
   - Wholesale and retail pricing with discount handling.
   - Movement of products between production and retail locations, plus warranty/repair tracking.
2. **Select Technology Stack**
   - Node.js with Express for building REST APIs.
   - MIT License for open-source distribution.
3. **Database Design**
   - Tables/collections for products, production batches, inventory locations, customers, invoices, payments, discounts and GST rates.
   - Movement tracking for stock transfers and support for wholesale vs. retail pricing tiers.
4. **API Design**
   - REST endpoints for products, production, inventory movement and sales.
   - GST calculations within invoices.
   - Authentication and authorization (e.g., OAuth2 or JWT).
   - User management APIs for future enablement of admin, sales and production staff accounts.
5. **Implementation Steps**
   - Build endpoints incrementally with unit tests for GST and discount logic.
   - Provide sample scripts or a minimal UI for demonstration.
6. **Testing and QA**
   - Automated tests for endpoints and workflows: production completion, inventory transfer and sales invoices.
   - Validate GST and discount calculations.
7. **Deployment**
   - Offer open-source deployment scripts so the system can be run easily in various environments.

## Provisioning

Run `./install.sh` to install dependencies, apply database migrations (if `DATABASE_URL` is set) and start the server.

## Docker Deployment

The repository includes a `Dockerfile` for the server and a `docker-compose.yml`
that starts both the server and a PostgreSQL database. The database persists
its data in the `db-data` volume and automatically restores from `backup/dump.sql`
if present. When the database container stops, it exports the data back to this
file.

Use the provided `Makefile` targets to manage the environment:

```
make up       # build images and start containers in the background
make stop     # stop containers
make backup   # manually backup the database to backup/dump.sql
make restore  # restore the database from backup/dump.sql
make logs     # follow container logs
```

The server will be available on `http://localhost:3000` once started.

## Continuous Integration

GitHub Actions builds the Docker image defined in `server/Dockerfile` and runs
the test suite inside that container. See `.github/workflows/ci.yml` for the
workflow configuration.
