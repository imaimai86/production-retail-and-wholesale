# Repository Guide

This project provides a Node.js/Express backend for production, sales and inventory management.

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
   - Tables for products, production batches, inventory locations, customers, invoices, payments, discounts and GST rates.
   - Movement tracking for stock transfers and support for wholesale vs. retail pricing tiers.
4. **API Design**
   - REST endpoints for products, production, inventory movement and sales.
   - GST calculations within invoices.
   - Authentication and authorization (e.g., OAuth2 or JWT).
   - User management APIs for admin, sales and production staff accounts.
5. **Implementation Steps**
   - Build endpoints incrementally with unit tests for GST and discount logic.
   - Provide sample scripts or a minimal UI for demonstration.
6. **Testing and QA**
   - Automated tests for endpoints and workflows: production completion, inventory transfer and sales invoices.
   - Validate GST and discount calculations.
7. **Deployment**
   - Offer open-source deployment scripts so the system can be run easily in various environments.

## Provisioning
Create a `.env` file in the project root with the following keys:

```
PORT=3000
DATABASE_URL=postgres://user:pass@localhost:5432/app
ADMIN_TOKEN=secret
```

Run `./install.sh` to install dependencies, apply database migrations (if `DATABASE_URL` is set) and start the server.

## Development Guidelines
- Run `npm test` from the repository root before committing changes. This executes Jest tests within the `server` directory.
- Use the provided Express server structure when adding new endpoints or features.
