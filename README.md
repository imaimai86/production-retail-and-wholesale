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

To stop the inline context injected by the hooks, remove the graft entries under `hooks` in `.claude/settings.json` on your machine (do not commit that change). The MCP server stays available through `.mcp.json`. To turn graft off completely, also remove `graft` from `.mcp.json` locally.
