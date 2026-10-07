# production-retail-and-wholesale

Supports production, sales, billing and inventory management.

See `AGENTS.md` for the implementation plan, provisioning details and contribution guidelines.

## API Documentation & Swagger UI

API documentation is available via Swagger UI. The OpenAPI specification is generated from JSDoc comments in `server/index.js`.

A pre-commit hook is configured to automatically generate or update the `tools/openapi-spec.json` file whenever changes to `server/index.js` are committed. This ensures the specification is always up-to-date with the code.

To view the Swagger UI locally:

1.  **Ensure the specification is generated:**
    If you haven't made a commit yet or want to manually regenerate:
    ```bash
    npm run generate-spec
    ```
    Alternatively, committing any change to `server/index.js` will trigger the pre-commit hook.

2.  **Start the main API server:**
    This server runs the actual API endpoints.
    ```bash
    cd server
    npm start
    ```
    This usually runs on `http://localhost:3000`.

3.  **Start the Swagger UI server:**
    In a separate terminal, run:
    ```bash
    npm run start:swagger
    ```
    This server is dedicated to serving the Swagger UI and typically runs on `http://localhost:3001`.

4.  **Access the UI:**
    Open your browser and navigate to `http://localhost:3001/docs`.

## Graft setup (required for the SDLC workflow)

The Plan stage of `scripts/sdlc.sh` and the `/plan` command use [graft](https://www.npmjs.com/package/@nanonets/graft), a prebuilt code graph, to find the files a change touches. Each developer needs it installed and built once. If graft is missing, the Claude hooks do nothing silently and the Plan stage loses its code graph.

1. **Install** (needs Node.js and npm):
   ```bash
   npm install -g @nanonets/graft
   graft --version        # confirm it is on your PATH
   ```
   Update later with `graft upgrade`.
2. **Build the graph** from the repo root (free, no API key). The `graft/` folder is git-ignored, so everyone builds their own:
   ```bash
   graft build
   graft check            # exits non-zero if the graph is stale; rerun `graft build` to refresh
   ```
3. **Start Claude Code** in the repo. `.mcp.json` registers the graft MCP server (`graft mcp`). On first use Claude Code asks you to approve project MCP servers; approve `graft`.
4. **Try it:** `graft ask "where is the sales invoice calculated" --source`.

### Two ways Claude uses graft
- **Hooks (default).** `.claude/settings.json` runs `.claude/helpers/graft-hooks.cjs` at session start, after edits and at stop. This injects a repo map into the session and keeps the graph in sync. The helper looks for graft in several places (a machine-specific path first, then local and global `node_modules`), so the path baked into it is harmless on other machines.
- **MCP tools.** Claude can call `graft_find_code`, `graft_find_all`, `graft_trace_calls`, `graft_file_api` and `graft_repo_map` through the server in `.mcp.json`.

## Running integration tests

Start a throwaway Postgres, then run the suite against it:

```bash
docker run -d --name prw-db -e POSTGRES_USER=app -e POSTGRES_PASSWORD=app -e POSTGRES_DB=app -p 5432:5432 postgres:16
DATABASE_URL=postgres://app:app@localhost:5432/app npm run test:integration
```

The suite creates and drops its own `prw_test_*` database, so it never touches the data in `DATABASE_URL`'s database. Without `DATABASE_URL` it fails with `DATABASE_URL is required for integration tests`.

## SDLC pipeline: integration tests

Integration tests (`npm run test:integration`) are a required part of the pipeline locally. `scripts/sdlc.sh` runs them through `scripts/sdlc-integration.sh` after the unit tests, at the Implement, Test repair and Review checks. The database is chosen in this order, first match wins:

1. `DATABASE_URL` set in your shell.
2. `DATABASE_URL` in the repo-root `.env` (the file the server reads), if its host is this machine and it answers. This is the fast path: no container to start.
3. A throwaway `postgres:16` container started with Docker and removed afterwards.

`SDLC_DB=docker` skips 1 and 2. A non-local host in `.env` is ignored with a warning unless `SDLC_ALLOW_REMOTE_DB=1`. The suite creates and drops its own `prw_test_*` databases, so several runs can share one server (the database user needs `CREATEDB`). `server/.env` is not read by anything; use the repo-root `.env`.

CI skips them temporarily, with a visible warning. To enable them in CI, set the CI/CD variable `SDLC_INTEGRATION_CI=run` and provide `DATABASE_URL` (for example from a `postgres:16` service). No code change is needed.

## SDLC pipeline: what the Ship stage commits

At the start of a run (`FROM=spec`) `scripts/sdlc.sh` records every file that is already modified, staged or untracked in `Docs/backlog/<slug>/logs/baseline.json`. The Ship stage (`scripts/sdlc-ship.sh`) then commits exactly the files the cycle created, changed or deleted since that snapshot, anywhere in the repo, in one `feat(<slug>)` commit, and ticks the item in `Docs/backlog/index.md` in a second commit. Anything else the developer had staged is left staged.

Skipped files are never committed; they are listed with the reason in `Docs/backlog/<slug>/logs/ship-skipped.md` and in the DONE message:

| Reason | Files |
|---|---|
| `pre-existing local changes` | files that were already modified before the run and changed again |
| `sensitive file` | `.env`, `.env.*` (not `.env.example`), `*.pem`, `*.key`, `*.p12`, `id_rsa*`, `*.keystore` |
| `local or agent configuration` | `.vscode/`, `.idea/`, `.claude/` |
| `generated` | `node_modules/`, `.DS_Store` |
| `too large` | files over 1 MiB |

Keys added to a git-ignored `.env` during the run are copied, with the placeholder value `change-me` (never the real value), into the sibling `.env.example`, which is committed. If nothing changed, Ship prints `WARNING: nothing to commit` and the run still succeeds. Resuming with any `FROM` other than `spec` reuses the existing baseline, or creates one with a warning (files changed before the resume then count as pre-existing).

## Interactive SDLC: control pane and parallel pipelines

`scripts/sdlc-mod.sh` runs the normal pipeline (`scripts/sdlc.sh`, unchanged) for one backlog item in its **own git worktree**, so several items can run at once. Two Claude Code plugins in `.claude/plugins/` add the interface and the guard rails.

```bash
bash scripts/sdlc-mod.sh run <slug>     # start or resume; worktree at ../<repo>-sdlc/<slug>, branch sdlc/<slug>
bash scripts/sdlc-mod.sh stop <slug>    # interrupt the pipeline and everything it started
bash scripts/sdlc-mod.sh status         # one line per run
bash scripts/sdlc-mod.sh watch <slug>    # live view of one pipeline, read from its worktree (--once prints one frame; WATCH_INTERVAL seconds, default 3)
bash scripts/sdlc-mod.sh changes <slug> [--json]   # files changed in the pipeline's worktree: "<changed> <uncommitted>"
bash scripts/sdlc-mod.sh discard <slug> [--yes] [--stop]   # delete its worktree, branch and run record (without --yes: show what would go, exit 6)
bash scripts/sdlc-mod.sh restart <slug> [--yes]   # stop it if running, discard it, start again from Spec
```

`discard` and `restart` throw away the item's worktree, its local branch `sdlc/<slug>` (including unpushed commits and uncommitted files) and its run record, but first save the branch tip in `.git/sdlc-runs/<slug>.discarded`; the command it prints, `git branch sdlc/<slug> <sha>`, brings the work back. `discard` refuses a running pipeline unless `--stop` is given, which stops it first (after `--yes`); `restart` stops it itself. `restart` refuses an item already merged into the base branch (exit 5).

At most 2 pipelines run at once (`SDLC_MAX_PARALLEL`, exit code 3 when full). Run records live in `.git/sdlc-runs/`. The wrapper links `server/node_modules`, `graft` and `.env` into each worktree.

**Control pane (`sdlc-monitor` plugin).** Start Claude with `claude --plugin-dir .claude/plugins/sdlc-monitor`, then press the **SDLC** button above the prompt or type `/sdlc-monitor`.

- **Overview:** the pending backlog items with checkboxes, a **Run selected** button (extra items wait in a queue until a slot frees), and one row per pipeline with its state: running, paused, done, failed, interrupted. Each row ends with how many files the pipeline has changed (`N files changed (M uncommitted)`, or `no changes yet` while running); the pipeline view shows the same in a `Files` line. Counts refresh with the pane, and every 10 s for finished pipelines.
- **Open a pipeline:** stage chips, progress bar, the current agent with elapsed time and attempt, test progress, artifacts and recent output.
- **Paused for answers:** a toast appears, the row shows **Answer**, and the pipeline view lists each Spec question with its suggested answer. Press **Use suggested** or type your own, then **Submit answers and resume**.
- **Interrupt:** **Stop** (press twice to confirm). A failed or interrupted pipeline offers **Resume** (from Implement if it got past Red tests).
- **Manual input per stage:** a failed, interrupted or stopped pipeline shows one text box per agent stage (Spec, Plan, Red tests, Implement, Review) and a **Resume at <stage>** button. Press Enter to save the text; it goes into `Docs/backlog/<slug>/manual-inputs.md` under `## <stage>` and the pipeline hands it to that stage's agent as binding instructions (it cannot override the rule that the tests are locked). Resume points: `FROM=spec|plan|red-tests|implement|test-repair|review ./scripts/sdlc.sh <slug>`; any other value exits 1 before anything is changed; `plan` and `red-tests` refuse once the red-tests commit exists (restart the run to redo them); `review` resumes from the latest locked tests commit. `FROM=test-repair` resumes at Test repair after a run stopped there for a non-verdict reason (the repair agent or auditor failed to run, or the claims failed the pre-check; the run prints the exact `FROM=test-repair` command when it can resume). It skips Implement and keeps `test-issues.md`, and first checks, reporting every failure together and calling no agent: the red-tests commit exists, the claim file has at least one valid claim, `server/__tests__` is unchanged since the red-tests commit (otherwise the restore command `git checkout <sha> -- server/__tests__ && git clean -fd server/__tests__` is printed, never run), the implementation changed outside `server/__tests__/` and `Docs/`, the repair was not already accepted (then use `FROM=review`), and the claims pass the pre-check. `FROM=implement` deletes `test-issues.md` and prints a warning first. The same file can be edited by hand.
- **Discard and start over:** **Discard** (press twice to confirm) stops the pipeline if it is running and deletes its worktree and branch. The pane stays on the item and shows **Start** (and the command that brings the old branch back). **Start** runs it again from Spec, and the running pipeline shows **Stop** and **Discard** again. Discard is offered for any pipeline the wrapper started.

**Guard (`sdlc-guard` plugin).** Loaded into every pipeline agent by the wrapper. It reads the current stage from `status.json` and refuses writes the stage does not allow: Spec and Plan write only that item's docs, Red tests write no source, Implement and Review never touch `server/__tests__`. It also refuses a doc written before the one it builds on.

## Backlog

`Docs/backlog/index.md` lists the work items. List them with a status filter:

```bash
npm run backlog
npm run backlog -- pending,in-progress
npm run backlog -- blocked --json
```

In Claude Code: `/backlog-list blocked`.

Markers in `index.md`: `[ ]` pending, `[x]` completed, `[!]` blocked, `[~]` parked (kept for later; `scripts/sdlc.sh` skips it, and a trailing `(parked: reason)` shows in the NOTE column). A `[ ]` item whose `sdlc/<slug>` branch exists (local or `origin`) is shown as in-progress. Statuses are `pending`, `in-progress`, `blocked`, `parked`, `completed` (aliases `open` and `done`, or `all`). The command only reads, it never changes files.

To stop the inline context injected by the hooks, remove the graft entries under `hooks` in `.claude/settings.json` on your machine (do not commit that change). The MCP server stays available through `.mcp.json`. To turn graft off completely, also remove `graft` from `.mcp.json` locally.
