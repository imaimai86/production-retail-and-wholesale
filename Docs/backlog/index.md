# Backlog

Pending items are picked top-down by `scripts/sdlc.sh`. Format: `- [ ] \`slug\` - title`.
Each item needs `Docs/backlog/<slug>/brief.md`.

- [x] `fix-stock-checks` - Block inventory transfers and sales when stock is insufficient
- [x] `hide-internal-errors` - Return JSON instead of HTML stack traces for unhandled errors
- [ ] `fix-ship-commit-scope` - Bug: Ship stage commits only server/ and docs; commit every relevant file the cycle changed
- [ ] `add-db-health-check` - Feature: GET /health that checks the database connection
- [x] `add-db-integration-tests` - Feature: integration tests against real Postgres, plus GitLab CI
- [ ] `add-json-logging` - Feature: Logs all errors and warnings: readable console locally, Google Cloud Logging JSON in Kubernetes
- [ ] `fix-user-validation` - Bug: POST /users returns 500 when name is missing; validate and fix the docs
- [ ] `warn-missing-env-config` - Feature: warn at startup when the repo-root .env is missing or ADMIN_TOKEN is not set
- [ ] `add-backlog-list` - Feature: /backlog-list command that lists backlog items with a status filter (pending, in-progress, blocked, completed)
- [x] `add-integration-success-check` - Feature: integration tests are a required local sdlc check; temporary skip in CI only (SDLC_INTEGRATION_CI=run to enable)
