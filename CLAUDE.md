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
| `ai-sdlc-helper start\|stop\|restart\|discard\|status\|changes\|watch [slug]` | Run the SDLC pipeline for a backlog item in its own worktree (up to 2 at once), stop it, or `restart` it from scratch (`discard` deletes its worktree and branch; both need `--yes`, and the branch tip is saved first). `--from <stage>` resumes at a stage. The pipeline comes from the [ai-sdlc-helper](https://github.com/imaimai86/ai-sdlc-helper) package (install it first, see "SDLC pipeline" in `README.md`); `ai-sdlc-helper help` lists every command, `ai-sdlc-helper doctor` checks the setup. |
| `ai-sdlc-helper permit <slug> allow\|always\|deny [n\|all]` | Decide the actions a stage agent was refused (the pane shows them as buttons), then `ai-sdlc-helper start <slug>` to resume. |
| `ai-sdlc-helper model list\|add\|add-model\|remove-model\|remove\|test` | Manage the user-level model registry (custom providers). |
| `ai-sdlc-helper show` / `ai-sdlc-helper layout` | The resolved pipeline settings from `sdlc.config.json` (test suite, test files, integration command, lint, worktree links, branch prefix, agent commands, timezone). |
| `claude --plugin-dir .claude/plugins/sdlc-monitor`, then `/sdlc-monitor` | Control pane for the pipelines (the **CONFIG** button and `/sdlc-config` manage providers and models). The pane still calls `bash scripts/sdlc-mod.sh`, a thin wrapper that maps its subcommands to `ai-sdlc-helper` (`run` is `start`). |
| `bash scripts/sdlc-integration.sh` | Run the integration suite as the SDLC does (`DATABASE_URL` from the shell or repo-root `.env`, else Docker); `integration.cmd` in `sdlc.config.json` points at it. |
| `/backlog-list [status]`, `ai-sdlc-helper backlog [status]` or `npm run backlog -- [status]` | List the backlog, optionally filtered by status. |

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
- The pipeline runs the integration suite after the unit tests. CI skips it temporarily with a warning; set the CI/CD variable `SDLC_INTEGRATION_CI=run` (or `integration.ci` to `"run"` in `sdlc.config.json`) and provide `DATABASE_URL` to enable it. There is no opt-out switch for local runs.
- **MANDATORY, never optional: show the monitor command.** A run is active from the moment you start or resume it (`ai-sdlc-helper start <slug>`, `ai-sdlc-helper pipeline <slug>` or the pane), or hand work to a background agent or task) until its completion notice arrives. During that whole time, EVERY reply to the user must contain the monitor command in a code block: when you start or resume it, when you report progress, and in any other reply (answers to unrelated questions, other edits, questions to the user). Do not wait to be asked. Put it at the end of the reply, with the slug filled in:
  ```bash
  ai-sdlc-helper watch <slug>
  ```
  The command finds the pipeline's directory itself (its worktree when started with `ai-sdlc-helper start` or the pane, the current directory otherwise; `--follow` keeps refreshing) and prints the `status.json` line, the run state, the uncommitted files and the last lines of `run.out`. In a worktree run, `Docs/backlog/<slug>/logs/status.json` and `run*.out` live in that worktree, not in the main tree.
- Before sending any reply, check whether a run is still active (the background task has not reported completion). If it is, the reply is incomplete without the monitor command.
- **MANDATORY: show the answers, then confirm with AskUserQuestion.** When a run pauses on Spec questions (exit code 2, `Docs/backlog/<slug>/questions.md`), or a Plan agent reports open questions, do these in order:
  1. Print EVERY question in the reply with its full, verbatim `**Suggested:**` answer and why it matters. A summary, a shortened table, or "accept all three suggested answers?" without the answers on screen is not allowed.
  2. Give your own answer for each: say whether you agree with the suggestion and why, check any factual claim against the code, and if you disagree propose a different answer.
  3. Only then confirm with the AskUserQuestion tool, never with a free-text "accept?" line (headless agents cannot ask: you ask for them). One AskUserQuestion question per agent question, up to 4 per call (batch the rest into further calls), with the question's title as the header and these options: **Accept suggested** (put the suggested answer in the description), **Use my alternative** (only when your answer differs; put it in the description), and the automatic Other for the user's own text. This is in addition to steps 1 and 2, never a replacement: the full text must already be printed in the same reply.
  4. Write each choice on its `**Answer:**` line (`accept` for the suggestion, otherwise the chosen or typed text) and resume the run (`ai-sdlc-helper start <slug>`).

- New dependencies: the Plan stage confirms a package's API from its published docs and types (WebFetch, WebSearch, `ai-sdlc-helper fetch <https-url>` for GET-only reads from package-doc hosts, or context7 when installed) and lists exact versions under `## Dependencies` in `plan-1.md`; the pipeline installs them at the start of Implement (in a worktree, into its own `server/node_modules`). No stage before Implement installs anything, and a brief must not require the developer to install first.
- Ship commits only the files changed during the cycle (compared with `Docs/backlog/<slug>/logs/baseline.json`) and lists the skipped ones in `Docs/backlog/<slug>/logs/ship-skipped.md`.

## Git branch and push rule
- Push SDLC work to its own branch `sdlc/<slug>` (not a `claude/...` branch).
- If that branch name already exists on the remote and the push conflicts, push to `sdlc/<slug>-<n>` instead, where `<n>` is a 5-digit number starting with 1 that increments by one per conflict (`10001`, then `10002`, and so on).

## Git worktrees
- Every git worktree lives outside the git root, at `../<repo>-sdlc/<slug>` (for this repo `../production-retail-and-wholesale-sdlc/<slug>`), never inside the repository and never under `.claude/`. `ai-sdlc-helper start` already does this (`worktree.base` in `sdlc.config.json`; `SDLC_WT_BASE` overrides it).
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
- Choose in `sdlc.config.json` with `"agent": { "codeSearch": "auto" | "none" | "<indexer>" }`, or run `ai-sdlc-helper code-search --use <name>`. `auto` takes the first available one (order: `agent.codeSearchOrder`, default graft then graphify). `ai-sdlc-helper code-search --list` shows each one and why it is or is not available.
- Another indexer is declared under `agent.codeIndexers.<name>` with `command` (must be on PATH), optional `index` (must exist), `tools` (MCP tools), `commands` (shell commands the agents may run) and `guide` or `guideFile` (how to search with it). The same fields change a built-in one.
- When an indexer is in use, prefer it over grep and full-file reads when locating code. If graft's `graft/` is missing or `graft check` reports it stale, run `graft build`.
- Skills and pipeline prompts come from the ai-sdlc-helper package and are filled for the indexer in use (or Grep/Glob): the commands in `.claude/commands/` print a skill with `ai-sdlc-helper skill <name>`.

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
