# Backlog

Pending items are picked top-down by `scripts/sdlc.sh`. Format: `- [ ] \`slug\` - title`.
Each item needs `Docs/backlog/<slug>/brief.md`.
Markers: [ ] pending, [x] completed, [!] blocked, [~] parked (skipped by `scripts/sdlc.sh`; unpark by changing it to [ ]). in-progress is derived from an `sdlc/<slug>` branch (see `npm run backlog`).

- [x] `fix-stock-checks` - Block inventory transfers and sales when stock is insufficient
- [x] `hide-internal-errors` - Return JSON instead of HTML stack traces for unhandled errors
- [x] `fix-ship-commit-scope` - Bug: Ship stage commits only server/ and docs; commit every relevant file the cycle changed
- [ ] `add-auth-token-table` - Feature: auth_tokens table (several tokens per user) and an admin user, so every request has a user id; POST /sales rejects requests without one (fixes the 500 from the raw token in sales.user_id)
- [ ] `add-db-health-check` - Feature: GET /health that checks the database connection
- [x] `add-db-integration-tests` - Feature: integration tests against real Postgres, plus GitLab CI
- [ ] `add-json-logging` - Feature: Logs all errors and warnings: readable console locally, Google Cloud Logging JSON in Kubernetes
- [ ] `fix-user-validation` - Bug: POST /users returns 500 when name is missing; validate and fix the docs
- [x] `fix-user-validation-v2` - Bug: POST /users returns 500 when name is missing; validate and fix the docs (v2: deliberately vaguer brief, for the clarifying-questions demo)
- [ ] `warn-missing-env-config` - Feature: warn at startup when the repo-root .env is missing or ADMIN_TOKEN is not set
- [ ] `add-base-branch-dropdown` - Feature: choose the base branch for each SDLC task from a dropdown, default main
- [x] `add-pipeline-change-counts` - Feature: show how many files each pipeline changed, counted in its own worktree
- [x] `fix-monitor-worktree-path` - Bug: the documented monitor command reads the main tree, not the pipeline's worktree
- [x] `retry-unclaimed-failing-test` - Feature: Test repair re-runs unclaimed failing tests once before rejecting, to filter flaky tests
- [x] `add-test-repair-resume` - Feature: FROM=test-repair resume point that checks Test repair preconditions (claim file, red commit, tests unchanged) first
- [x] `add-backlog-list` - Feature: /backlog-list command that lists backlog items with a status filter (pending, in-progress, blocked, completed)
- [x] `add-integration-success-check` - Feature: integration tests are a required local sdlc check; temporary skip in CI only (SDLC_INTEGRATION_CI=run to enable)
- [ ] `require-integration-tests` - Feature: every DB or API change must come with integration tests that fail first; enforced by pipeline gates
- [~] `sdlc-bg-agents` - Feature: run the SDLC agents as `claude --bg` background sessions so they can ask questions and be monitored (parked: the orchestrator AskUserQuestion rule and stream-json monitoring cover it for now)
- [ ] `run-changed-tests-only` - Feature: in GitHub Actions pull requests, run only the unit and integration tests related to the changed files; full suite on main or when unsure
- [ ] `remove-gitlab-ci` - Feature: remove .gitlab-ci.yml (after run-changed-tests-only adds the GitHub integration job)
- [ ] `validate-create-inputs` - Bug: POST /categories, /products, /batches, /sales and PUT /products/:id return 500 on a bad body or unknown category/product; validate and return 400/404
- [ ] `validate-route-ids` - Bug: invalid :id on products and sales routes returns 500; return 404, and 409 when deleting a product that is in use
- [ ] `add-jwt-login-acl` - Feature: login with JWT (tokens stored in auth_tokens) and role-based access control; depends on add-auth-token-table
- [ ] `fix-pagination-limits` - Bug: negative or huge page/limit on list endpoints returns 500 or reads whole tables; return 400 and cap limit at 100
- [ ] `add-stage-input-gate` - Feature: pipeline waits before each agent stage (Spec, Plan, Red tests, Implement, Review) for the developer's input; opt-in gate with a pane screen
- [ ] `add-stage-stop-with-input` - Feature: stop a running stage from the pane, add input for it, and restart that stage in one action
- [ ] `add-monitor-fullscreen` - Feature: redesign the /sdlc-monitor pane as a large two-column screen (pipeline list, stage rail, input, live output, key hints) and a Files changed view (docs, tests, source) available at any time
