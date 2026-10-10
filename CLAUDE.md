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
| `bash scripts/sdlc-mod.sh run\|stop\|restart\|discard\|status\|changes\|watch [slug]` | Run the SDLC pipeline for a backlog item in its own worktree (up to 2 at once), stop it, or `restart` it from scratch (`discard` deletes its worktree and branch; both need `--yes`, and the branch tip is saved first). Control pane: `claude --plugin-dir .claude/plugins/sdlc-monitor`, then `/sdlc-monitor`. `bash scripts/sdlc-mod.sh model list\|add\|add-model\|remove-model\|remove\|test` manages the user-level model registry (custom providers). |
| `bash scripts/sdlc-integration.sh` | Run the integration suite as the SDLC does (`DATABASE_URL` from the shell or repo-root `.env`, else Docker). |
| `/backlog-list [status]` or `npm run backlog -- [status]` | List the backlog, optionally filtered by status. |

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
- **MANDATORY, never optional: show the monitor command.** A run is active from the moment you start or resume `./scripts/sdlc.sh` (or hand work to a background agent or task) until its completion notice arrives. During that whole time, EVERY reply to the user must contain the monitor command in a code block: when you start or resume it, when you report progress, and in any other reply (answers to unrelated questions, other edits, questions to the user). Do not wait to be asked. Put it at the end of the reply, with the slug filled in:
  ```bash
  bash scripts/sdlc-mod.sh watch <slug>
  ```
  The command finds the pipeline's directory itself (its worktree when started through `scripts/sdlc-mod.sh` or the pane, the current directory otherwise) and prints the `status.json` line, the run state, the uncommitted files and the last lines of `run.out`. In a worktree run, `Docs/backlog/<slug>/logs/status.json` and `run*.out` live in that worktree, not in the main tree.
- Before sending any reply, check whether a run is still active (the background task has not reported completion). If it is, the reply is incomplete without the monitor command.
- **MANDATORY: show the answers, then confirm with AskUserQuestion.** When a run pauses on Spec questions (exit code 2, `Docs/backlog/<slug>/questions.md`), or a Plan agent reports open questions, do these in order:
  1. Print EVERY question in the reply with its full, verbatim `**Suggested:**` answer and why it matters. A summary, a shortened table, or "accept all three suggested answers?" without the answers on screen is not allowed.
  2. Give your own answer for each: say whether you agree with the suggestion and why, check any factual claim against the code, and if you disagree propose a different answer.
  3. Only then confirm with the AskUserQuestion tool, never with a free-text "accept?" line (headless agents cannot ask: you ask for them). One AskUserQuestion question per agent question, up to 4 per call (batch the rest into further calls), with the question's title as the header and these options: **Accept suggested** (put the suggested answer in the description), **Use my alternative** (only when your answer differs; put it in the description), and the automatic Other for the user's own text. This is in addition to steps 1 and 2, never a replacement: the full text must already be printed in the same reply.
  4. Write each choice on its `**Answer:**` line (`accept` for the suggestion, otherwise the chosen or typed text) and rerun.

- Ship commits only the files changed during the cycle (compared with `Docs/backlog/<slug>/logs/baseline.json`) and lists the skipped ones in `Docs/backlog/<slug>/logs/ship-skipped.md`.

## Git branch and push rule
- Push SDLC work to its own branch `sdlc/<slug>` (not a `claude/...` branch).
- If that branch name already exists on the remote and the push conflicts, push to `sdlc/<slug>-<n>` instead, where `<n>` is a 5-digit number starting with 1 that increments by one per conflict (`10001`, then `10002`, and so on).

## Working with the user
- **Times in GST.** Show every time mentioned to the user in GST (Gulf Standard Time, UTC+4), written like `17:21 GST`. Convert UTC timestamps from logs, GitHub, `status.json` and schedulers before showing them.
- **Status check-ins every minute.** When asked to report on a running SDLC pipeline, schedule the check-ins (`send_later`) every 1 minute until the run is done, failed or paused for questions. With several pipelines running, one check-in covers all of them.
- **Questions need context.** Whenever you ask the user a question (AskUserQuestion or in text), first name the task it is about (backlog slug, PR number or branch), say in one line what that task does, what the question decides and what happens with each answer. Put the slug in the AskUserQuestion header or question text as well, because several pipelines can run in parallel.

## Merging pull requests
- **MANDATORY, never optional: confirm with AskUserQuestion before merging any pull request.** This applies in every case: PRs you opened in this session, PRs raised from an SDLC pipeline run, and PRs where the user earlier said "merge when CI passes". A green CI run, an earlier instruction, or a subscription event never replaces the confirmation.
  - When the PR is ready (CI green, no conflict), ask with the AskUserQuestion tool, never a free-text "merge?" line, with at least the options **Merge** and **Do not merge**, naming the PR number and its CI status in the question. Merge only after the user picks Merge. Any other answer means do not merge.
  - Creating a PR, pushing to it and watching its CI do not need this confirmation; only the merge does.

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
