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
| `./scripts/sdlc.sh [slug]` | Run the automated SDLC pipeline for a backlog item. It reads `sdlc.config.json` (completed by detection): test command and files, backlog folder, branch prefix, integration command, worktree links and agent commands; tests run through `scripts/sdlc-runners.cjs`. |
| `bash scripts/sdlc-mod.sh run\|stop\|restart\|discard\|status\|changes\|watch [slug]` | Run the SDLC pipeline for a backlog item in its own worktree (up to 2 at once), stop it, or `restart` it from scratch (`discard` deletes its worktree and branch; both need `--yes`, and the branch tip is saved first). Control pane: `claude --plugin-dir .claude/plugins/sdlc-monitor`, then `/sdlc-monitor` (the **CONFIG** button and `/sdlc-config` manage providers and models). `bash scripts/sdlc-mod.sh permit <slug> allow\|always\|deny [n\|all]` decides the actions a stage agent was refused (the pane shows them as buttons). `bash scripts/sdlc-mod.sh model list\|add\|add-model\|remove-model\|remove\|test` manages the user-level model registry (custom providers). |
| `bash scripts/sdlc-integration.sh` | Run the integration suite as the SDLC does (`DATABASE_URL` from the shell or repo-root `.env`, else Docker). |
| `node scripts/sdlc-config.cjs detect\|show\|env [dir]` | Pipeline settings: `sdlc.config.json` (suites, test command and files, integration, worktree links, git, agent commands, timezone), completed by test runner detection (jest, vitest, mocha, node:test) and defaults. `detect` shows what detection finds, `show` the resolved settings, `env` the same as shell variables. Not used by the pipeline scripts yet. For a Node/TypeScript project without tests, `suggest [dir]` lists the supported frameworks best first, and `init-tests [dir]` confirms the detected language, lets the user pick a framework and sets it up (script, config, example test, install, one test run; `--language`, `--runner`, `--yes`, `--dry-run`, `--no-install`). `--test-dir <folder>` puts the tests in a folder given from `[dir]` (`__tests__`, `server/__tests__`, `client/_test`) and sets up the package that holds it; without it a terminal asks. |
| `node scripts/sdlc-runners.cjs run [dir] --out <file> [--suite <name>] [--file <f>]... [--test <name>]...` | Run a suite from `sdlc.config.json` (or only some files and tests) through its runner's adapter (jest, vitest, mocha, node:test, generic-junit) and write one result shape: `{ ok, tests: [{ file, name, status }], suiteErrors }`. `parse <runner> <report>` converts a runner's own report. `scripts/sdlc-testcheck.cjs` reads these results as well as Jest's JSON. `layout` prints the test, source and backlog folders, test patterns and test command (used by the guard hook and plugin). Skills in `scripts/skills/` get `{{TEST_FILES}}`, `{{TEST_CMD}}`, `{{TEST_FRAMEWORK}}`, `{{BACKLOG_DIR}}` and `{{BRANCH_PREFIX}}` from it. |
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
- Tests verify the real code, never documentation: a test must import or run the code under test, and no test may read, grep or assert on README.md, CLAUDE.md, AGENTS.md, any other `.md` file or comments. Documentation is checked in the Review stage. A test that passes while the feature code is missing is a defect.
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

- New dependencies: the Plan stage confirms a package's API from its published docs and types (WebFetch, WebSearch, `bash scripts/sdlc-fetch.sh <url>` for GET-only reads from package-doc hosts, or context7 when installed) and lists exact versions under `## Dependencies` in `plan-1.md`; the pipeline installs them at the start of Implement (in a worktree, into its own `server/node_modules`). No stage before Implement installs anything, and a brief must not require the developer to install first.
- Ship commits only the files changed during the cycle (compared with `Docs/backlog/<slug>/logs/baseline.json`) and lists the skipped ones in `Docs/backlog/<slug>/logs/ship-skipped.md`.

## Git branch and push rule
- Push SDLC work to its own branch `sdlc/<slug>` (not a `claude/...` branch).
- If that branch name already exists on the remote and the push conflicts, push to `sdlc/<slug>-<n>` instead, where `<n>` is a 5-digit number starting with 1 that increments by one per conflict (`10001`, then `10002`, and so on).

## Git worktrees
- Every git worktree lives outside the git root, at `../<repo>-sdlc/<slug>` (for this repo `../production-retail-and-wholesale-sdlc/<slug>`), never inside the repository and never under `.claude/`. `scripts/sdlc-mod.sh` already does this (`SDLC_WT_BASE` overrides the base folder).
- When you need a worktree yourself, including one for a sub agent, create it with `git worktree add -b <branch> ../<repo>-sdlc/<slug> <base>` and give the agent that folder to work in. Do not use the sub agent `isolation: "worktree"` option: it puts the worktree in `.claude/worktrees/agent-<id>`, which shows up as untracked in `git status`.
- Git has no setting for a default worktree location: the path is the argument of `git worktree add`, so this rule is how the location is kept.
- Remove a worktree you created when its work is merged or discarded (`git worktree remove <path>`).

## Working with the user
- **Times in GST.** Show every time mentioned to the user in GST (Gulf Standard Time, UTC+4), written like `17:21 GST`. Convert UTC timestamps from logs, GitHub, `status.json` and schedulers before showing them.
- **Status check-ins every minute.** When asked to report on a running SDLC pipeline, schedule the check-ins (`send_later`) every 1 minute until the run is done, failed or paused for questions. With several pipelines running, one check-in covers all of them.
- **Questions need context.** Whenever you ask the user a question (AskUserQuestion or in text), first name the task it is about (backlog slug, PR number or branch), say in one line what that task does, what the question decides and what happens with each answer. Put the slug in the AskUserQuestion header or question text as well, because several pipelines can run in parallel.

## Merging pull requests
- **MANDATORY, never optional: confirm with AskUserQuestion before merging any pull request.** This applies in every case: PRs you opened in this session, PRs raised from an SDLC pipeline run, and PRs where the user earlier said "merge when CI passes". A green CI run, an earlier instruction, or a subscription event never replaces the confirmation.
  - When the PR is ready (CI green, no conflict), ask with the AskUserQuestion tool, never a free-text "merge?" line, with at least the options **Merge** and **Do not merge**, naming the PR number and its CI status in the question. Merge only after the user picks Merge. Any other answer means do not merge.
  - Creating a PR, pushing to it and watching its CI do not need this confirmation; only the merge does.

## Code indexing (graft, graphify or none)
A code indexer is recommended for the SDLC workflow, not required. The agents use one when it is installed and the repo has its index, else they search with Grep and Glob and the pipeline prints a note.
- Built in: **graft** (`npm install -g @nanonets/graft`, then `graft build`; index `graft/`; see "Graft setup" in `README.md`) and **graphify** (`uv tool install graphifyy`, then `/graphify .`; index `graphify-out/graph.json`).
- Choose in `sdlc.config.json` with `"agent": { "codeSearch": "auto" | "none" | "<indexer>" }`, or run `node scripts/sdlc-config.cjs code-search --use <name>`. `auto` takes the first available one (order: `agent.codeSearchOrder`, default graft then graphify). `node scripts/sdlc-config.cjs code-search --list` shows each one and why it is or is not available.
- Another indexer is declared under `agent.codeIndexers.<name>` with `command` (must be on PATH), optional `index` (must exist), `tools` (MCP tools), `commands` (shell commands the agents may run) and `guide` or `guideFile` (how to search with it). The same fields change a built-in one.
- When an indexer is in use, prefer it over grep and full-file reads when locating code. If graft's `graft/` is missing or `graft check` reports it stale, run `graft build`.
- Skills that search code have a version per indexer and a Grep/Glob version: their text is in `scripts/skills/<name>.md` (the commands in `.claude/commands/` print it with `node scripts/sdlc-config.cjs skill <name>`) and pipeline prompts are in `scripts/prompts/`; `{{CODE_SEARCH}}` in both is filled from `scripts/prompts/parts/code-search.<indexer>.md` (or the indexer's own guide) or `code-search.md`.

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
