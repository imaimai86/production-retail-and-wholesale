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

## Logging

The server logs with pino. Requires Node 22 or later.

- **JSON output (Kubernetes/GKE):** one JSON object per line on stdout with `severity` (pino `trace`/`debug` → `DEBUG`, `info` → `INFO`, `warn` → `WARNING`, `error` → `ERROR`, `fatal` → `CRITICAL`), `message`, an ISO `timestamp`, `serviceContext` and `httpRequest` for requests. The GKE logging agent reads it as `jsonPayload` with `severity`. Query problems with `severity>=WARNING`.
- **Pretty output locally:** human-readable lines. `LOG_FORMAT=json|pretty` forces a format; otherwise JSON is used when `KUBERNETES_SERVICE_HOST` is set or `NODE_ENV=production`, else pretty.
- **`LOG_LEVEL`:** `trace`, `debug`, `info` (default) or `warn`. The level never goes below `warn`: `error`, `fatal`, `silent` and unknown values fall back to `warn`.
- **`X-Request-Id`:** every response carries it. A valid incoming value is reused, otherwise a UUID is generated. Error entries carry the same id.
- **Trace correlation:** set `GOOGLE_CLOUD_PROJECT` in the Deployment so `X-Cloud-Trace-Context` is linked to the entry.
- **Tests:** logs are discarded under Jest unless `LOG_IN_TESTS=1`.
- Request bodies, headers, cookies and query strings are never logged.

## Graft setup (required for the SDLC workflow)

The Plan stage of the SDLC pipeline and the `/plan` and `/triage` commands use a code indexer to find the files a change touches: [graft](https://www.npmjs.com/package/@nanonets/graft) (set up below), [graphify](https://github.com/safishamsi/graphify), or one declared in `sdlc.config.json`. One is recommended, none is required: without one they search with Grep and Glob, the pipeline prints a note, and the graft hooks do nothing. `ai-sdlc-helper code-search --list` shows what is available and `--use <graft|graphify|auto|none>` chooses. Each developer who wants graft installs and builds it once.

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

## SDLC pipeline

The SDLC pipeline (Spec, Plan, Red tests, Implement, Test repair, Review, Ship, each checked before the next starts) comes from the [ai-sdlc-helper](https://github.com/imaimai86/ai-sdlc-helper) package. This repository only holds its settings (`sdlc.config.json`), the backlog (`Docs/backlog/`), the integration command (`scripts/sdlc-integration.sh`), the slash commands, and the control pane and guard plugins in `.claude/plugins/`. The package's README lists every command and setting; `ai-sdlc-helper help` prints them.

**Install** (Node 18 or newer, git, and Claude Code's `claude` on PATH). Until the package is on npm, pack it from GitHub and install the tarball, or install the tarball attached to a GitHub release:

```bash
npm pack github:imaimai86/ai-sdlc-helper && npm i -g ./ai-sdlc-helper-*.tgz
npm i -g <tarball URL from a GitHub release>
```

Once it is published: `npm i -g ai-sdlc-helper`. (`npm i -g github:imaimai86/ai-sdlc-helper` does not work; see the package README.) Then check the project from the repo root:

```bash
ai-sdlc-helper doctor     # Node, git, claude, the settings, the code indexer, the backlog
ai-sdlc-helper show       # what sdlc.config.json resolves to
```

**Settings** (`sdlc.config.json`, committed; a run's worktree only sees what is committed): the `server` Jest suite (`npm test`, tests in `server/__tests__/`), the integration command `bash scripts/sdlc-integration.sh` (skipped in CI, below), lint `npm run lint --prefix server`, the commands the stage agents may also run (`npm run generate-spec`, `npm run lint`), the worktree folder `../<repo>-sdlc` with links to `server/node_modules`, `node_modules`, `graft` and `.env`, the backlog `Docs/backlog`, branches `sdlc/<slug>` (`-10001`, `-10002`... on a conflict) and times in `Asia/Dubai`.

**Run a backlog item** in its own git worktree and branch (at most 2 at once, `SDLC_MAX_PARALLEL`; exit 3 when full):

```bash
ai-sdlc-helper start <slug>            # start or resume; worktree at ../<repo>-sdlc/<slug>, branch sdlc/<slug>; --from <stage> resumes at a stage
ai-sdlc-helper watch <slug>            # its status.json line, run state, uncommitted files and the end of run.out (--follow keeps refreshing)
ai-sdlc-helper stop <slug>             # interrupt the pipeline and everything it started
ai-sdlc-helper status                  # one line per run
ai-sdlc-helper changes <slug> [--json] # files changed in the pipeline's worktree: "<changed> <uncommitted>"
ai-sdlc-helper discard <slug> [--yes] [--stop]   # delete its worktree, branch and run record (without --yes: show what would go, exit 6)
ai-sdlc-helper restart <slug> [--yes]  # stop it if running, discard it, start again from Spec
ai-sdlc-helper permit <slug> allow|always|deny [n|all]   # decide the actions a stage agent was refused, then start it again to resume
ai-sdlc-helper pipeline <slug>         # run the pipeline in the current checkout instead of a worktree
ai-sdlc-helper triage --report "<text>"   # turn a report into backlog items (brief.md and the index line)
```

`discard` and `restart` throw away the item's worktree, its local branch `sdlc/<slug>` (including unpushed commits and uncommitted files) and its run record, but first save the branch tip in `.git/sdlc-runs/<slug>.discarded`; the command it prints, `git branch sdlc/<slug> <sha>`, brings the work back. Run records live in `.git/sdlc-runs/`.

When the Spec stage has questions, the run pauses (exit 2): answer them on the `**Answer:**` lines of `Docs/backlog/<slug>/questions.md` in the run's worktree and start it again. A stage agent runs headless, so an action outside its allowed tools is refused; the run pauses and `watch` and the pane list the refusals (`always` saves the rule in `.claude/sdlc-permissions.json` of the main working tree).

**Models and providers.** Each stage has a default model and effort; `MODEL_<STAGE>` and `EFFORT_<STAGE>` (`SPEC`, `PLAN`, `RED_TESTS`, `IMPLEMENT`, `TEST_REPAIR`, `TEST_AUDIT`, `REVIEW`), or `SDLC_MODEL` and `SDLC_EFFORT` for every stage, override them, for example `MODEL_IMPLEMENT=opus EFFORT_IMPLEMENT=high ai-sdlc-helper start <slug>`. A non-Anthropic model goes through a provider (an Anthropic-compatible endpoint such as a LiteLLM or OpenRouter gateway), selected as `<provider>/<model>`. Providers live in a user-level registry that holds the NAME of the variable carrying the key, never the key (export that variable in your shell profile):

```bash
ai-sdlc-helper model list [--json]   # the providers, their models and whether each key variable is set
ai-sdlc-helper model add <provider> --endpoint <url> --key-env <VAR> --models a,b [--effort]
ai-sdlc-helper model add-model|remove-model <provider> <model>
ai-sdlc-helper model remove <provider>
ai-sdlc-helper model test <provider>/<model>   # one request: "ok", or the failure line
```

For CI and headless runs, the `SDLC_PROVIDERS` and `SDLC_PROVIDER_<NAME>_*` keys in the repo-root `.env` are still read as a fallback (see `.env.example`).

**New dependencies:** the Plan stage confirms a package's API from its published docs (WebFetch, WebSearch, `ai-sdlc-helper fetch <https-url>`, or context7) and lists exact versions under `## Dependencies` in `plan-1.md`; the pipeline installs them at the start of Implement, in the run's own `server/node_modules`.

**Flaky tests:** before the Test repair pre-check, every failing test that `test-issues.md` does not claim is run once more; one that passes is reported (`WARNING: flaky test passed on re-run, not rejected: <key>`) and listed in `Docs/backlog/<slug>/logs/flaky-tests.md` instead of being rejected.

**What Ship commits:** only the files the cycle created, changed or deleted since the snapshot in `Docs/backlog/<slug>/logs/baseline.json`, in one `feat(<slug>)` commit, then the backlog tick in a second commit. Skipped files (pre-existing local changes, `.env` and other secrets, `.vscode/`, `.idea/`, `.claude/`, `node_modules/`, files over 1 MiB) are listed in `Docs/backlog/<slug>/logs/ship-skipped.md`. Keys added to `.env` during the run are copied to `.env.example` with the value `change-me`. Everything under `Docs/backlog/<slug>/logs/` is git-ignored.

**Slash commands** (`.claude/commands/`): `/spec`, `/interview`, `/plan`, `/red-tests`, `/implement`, `/review`, `/ship`, `/tdd-loop`, `/sdlc` and `/triage` each print the package's skill for this project (`ai-sdlc-helper skill <name>`); `/backlog-list` runs `ai-sdlc-helper backlog`.

## SDLC pipeline: integration tests

Integration tests (`npm run test:integration`) are a required part of the pipeline locally. The pipeline runs them through `scripts/sdlc-integration.sh` (`integration.cmd` in `sdlc.config.json`) after the unit tests, at the Implement, Test repair and Review checks. The database is chosen in this order, first match wins:

1. `DATABASE_URL` set in your shell.
2. `DATABASE_URL` in the repo-root `.env` (the file the server reads), if its host is this machine and it answers. This is the fast path: no container to start.
3. A throwaway `postgres:16` container started with Docker and removed afterwards.

`SDLC_DB=docker` skips 1 and 2. A non-local host in `.env` is ignored with a warning unless `SDLC_ALLOW_REMOTE_DB=1`. The suite creates and drops its own `prw_test_*` databases, so several runs can share one server (the database user needs `CREATEDB`). `server/.env` is not read by anything; use the repo-root `.env`.

CI skips them temporarily, with a visible warning (`integration.ci` is `"skip"`). To enable them in CI, set the CI/CD variable `SDLC_INTEGRATION_CI=run` and provide `DATABASE_URL` (for example from a `postgres:16` service). No code change is needed.

## Interactive SDLC: control pane and guard

Two Claude Code plugins in `.claude/plugins/` add the interface and the guard rails. They stay in this repository until the package ships them as a plugin. The pane runs its actions through `scripts/sdlc-mod.sh`, a thin compatibility wrapper that maps each subcommand to `ai-sdlc-helper` (`run` is `start`, `FROM=<stage>` becomes `--from <stage>`, `watch` follows unless `--once`; `stop`, `restart`, `discard`, `status`, `changes`, `permit`, `model` and `backlog` keep their names). Without `ai-sdlc-helper` on PATH it says how to install it.

**Control pane (`sdlc-monitor` plugin).** Start Claude with `claude --plugin-dir .claude/plugins/sdlc-monitor`, then press the **SDLC** or **CONFIG** button above the prompt, or type `/sdlc-monitor` or `/sdlc-config`.

- **Overview:** the pending backlog items with checkboxes, a **Run selected** button (extra items wait in a queue until a slot frees), and one row per pipeline with its state: running, paused, done, failed, interrupted. Each row ends with how many files the pipeline has changed (`N files changed (M uncommitted)`, or `no changes yet` while running); the pipeline view shows the same in a `Files` line.
- **Open a pipeline:** stage chips, progress bar, the current agent with its model, elapsed time and attempt, test progress, artifacts, the files changed per stage and recent output.
- **Paused for answers:** a toast appears, the row shows **Answer**, and the pipeline view lists each Spec question with its suggested answer. Press **Use suggested** or type your own, then **Submit answers and resume**.
- **Interrupt:** **Stop** (press twice to confirm). A failed or interrupted pipeline offers **Resume** (from Implement if it got past Red tests).
- **Manual input per stage:** a failed, interrupted or stopped pipeline shows one text box per agent stage (Spec, Plan, Red tests, Implement, Review) and a **Resume at <stage>** button. The text goes into `Docs/backlog/<slug>/manual-inputs.md` under `## <stage>` and the pipeline hands it to that stage's agent as binding instructions (it cannot override the rule that the tests are locked). From a terminal: `ai-sdlc-helper start <slug> --from spec|plan|red-tests|implement|test-repair|review`.
- **Discard and start over:** **Discard** (press twice to confirm) stops the pipeline if it is running and deletes its worktree and branch; the pane then shows **Start** and the command that brings the old branch back.
- **Refused actions:** the pane lists each one with **Allow this run**, **Allow always** and **Deny**; when none is left the run resumes at that stage. A path under `.claude/` cannot be opened by an allow rule, so allowing it runs that stage with permission checks off, and the pane says so.
- **CONFIG pane** (**CONFIG** button or `/sdlc-config`): the model registry providers with their endpoint, key variable and `key set` / `key NOT set`, **Edit**, **Test** per model, **Remove**, and a form to add or edit a provider (the key-variable field takes a variable name, never a key).

**Guard (`sdlc-guard` plugin, and `.claude/helpers/sdlc-guard.cjs`).** The plugin is loaded into every pipeline agent. It reads the current stage from `status.json` and refuses writes the stage does not allow: Spec and Plan write only that item's docs, Red tests write no source, Implement and Review never touch `server/__tests__`. It also refuses a doc written before the one it builds on. The helper, run by the hooks in `.claude/settings.json`, protects the tests during `/implement` and `/review` and keeps the session going while `npm test` fails. Both read the test layout from `ai-sdlc-helper layout`, and fall back to `server/__tests__` and `npm test` without it.

## Backlog

`Docs/backlog/index.md` lists the work items. List them with a status filter:

```bash
npm run backlog
npm run backlog -- pending,in-progress
npm run backlog -- blocked --json
```

In Claude Code: `/backlog-list blocked`. Both run `ai-sdlc-helper backlog` (the package must be installed, see "SDLC pipeline").

Markers in `index.md`: `[ ]` pending, `[x]` completed, `[!]` blocked, `[~]` parked (kept for later; the pipeline skips it, and a trailing `(parked: reason)` shows in the NOTE column). A `[ ]` item whose `sdlc/<slug>` branch exists (local or `origin`) is shown as in-progress. Statuses are `pending`, `in-progress`, `blocked`, `parked`, `completed` (aliases `open` and `done`, or `all`). The command only reads, it never changes files.

To stop the inline context injected by the hooks, remove the graft entries under `hooks` in `.claude/settings.json` on your machine (do not commit that change). The MCP server stays available through `.mcp.json`. To turn graft off completely, also remove `graft` from `.mcp.json` locally.
