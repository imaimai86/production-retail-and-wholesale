# Repository Guide

Node.js/Express backend for production, sales and inventory management, used by a production unit and its retail and wholesale shop.

## Tech stack
- Node.js with Express (REST APIs), PostgreSQL, Jest for tests.
- MIT licensed (open source).

## Commands
| Command | Purpose |
|---|---|
| `npm test` | Run the Jest tests (in `server/`). Run it from the repo root before committing. |
| `./install.sh` | Install dependencies, apply database migrations (if `DATABASE_URL` is set) and start the server. |
| `./scripts/sdlc.sh [slug]` | Run the automated SDLC pipeline for a backlog item. |
| `bash scripts/sdlc-integration.sh` | Run the integration suite as the SDLC does (Docker or `DATABASE_URL`). |

## Setup
Create a `.env` file in the project root with these keys:

```
PORT=3000
DATABASE_URL=postgres://user:pass@localhost:5432/app
ADMIN_TOKEN=secret
```

## Development guidelines
- Run `npm test` from the repo root before committing changes.
- Use the existing Express server structure when adding endpoints or features.
- Tests live in `server/__tests__/`, mirroring the code layout.
- Spec, plan and test docs live in `Docs/backlog/<slug>/`.

## SDLC pipeline
- Refer to SDLC stages by name (Spec, Plan, Red tests, Implement, Review, Ship), never by number.
- The pipeline runs the integration suite after the unit tests. CI skips it temporarily with a warning; set the CI/CD variable `SDLC_INTEGRATION_CI=run` and provide `DATABASE_URL` to enable it. There is no opt-out switch for local runs.
- Whenever you start the pipeline or hand a task to a background agent, immediately show the user the command to monitor it, for example:
  ```bash
  watch -n3 'cat Docs/backlog/<slug>/logs/status.json; git status --short | head -15'
  ```
  `status.json` is the single-line live status. The run output is `Docs/backlog/<slug>/logs/run*.out`.

## Graft
Graft must be installed for the SDLC workflow (the Plan stage and `/plan` use it).
- Before running `./scripts/sdlc.sh` or any SDLC stage, check `command -v graft` and `graft --version`.
- If graft is missing, stop and tell the user to follow "Graft setup" in `README.md` (`npm install -g @nanonets/graft`, then `graft build`). Do not guess file locations without it.
- If `graft/` is missing, or `graft check` reports it stale, run `graft build` first.
- Prefer graft (`graft ask`, `graft grep`, `graft callers`, or the graft MCP tools) over grep and full-file reads when locating code.

## Implementation plan
1. **Scope and requirements**
   - Inventory tracking for items and batches across the production unit and retail shop.
   - Production workflow management to track raw materials and manufacturing batches.
   - Sales management with invoices and receipts.
   - GST-compliant accounting and tax calculations.
   - Wholesale and retail pricing with discount handling.
   - Movement of products between production and retail locations, plus warranty and repair tracking.
2. **Database design**
   - Tables for products, production batches, inventory locations, customers, invoices, payments, discounts and GST rates.
   - Movement tracking for stock transfers, and support for wholesale vs. retail pricing tiers.
3. **API design**
   - REST endpoints for products, production, inventory movement and sales.
   - GST calculations within invoices.
   - Authentication and authorization (e.g. OAuth2 or JWT).
   - User management APIs for admin, sales and production staff accounts.
4. **Implementation steps**
   - Build endpoints incrementally, with unit tests for GST and discount logic.
   - Provide sample scripts or a minimal UI for demonstration.
5. **Testing and QA**
   - Automated tests for endpoints and workflows: production completion, inventory transfer and sales invoices.
   - Validate GST and discount calculations.
6. **Deployment**
   - Offer open-source deployment scripts so the system can run easily in various environments.
