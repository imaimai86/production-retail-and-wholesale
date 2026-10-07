# Plan: add-pipeline-change-counts (round 1)

Input: `specs-1.md`. No source edits are made by this document.

## Findings (affected files)

Graft does not index shell, TSX plugin or doc files (no symbols for them), so the spans below were found with Grep and read directly. Graft has no callers for these symbols; the call sites are listed by hand.

| File | Spans | Role |
|---|---|---|
| `scripts/sdlc-mod.sh` | header comment 2-20, `usage` :31, `json_get` :33, `pick_base` :68, `cmd_watch` :256 (worktree lookup :263-268), dispatch `case` :277-285 | Add `cmd_changes`, the usage text, the header doc and the dispatch entry |
| `.claude/plugins/sdlc-monitor/types/index.d.ts` | `Run` :5-24 | New `changes` field |
| `.claude/plugins/sdlc-monitor/hooks/register.tsx` | `PENDING_EVERY_MS` :8, `loadPending` :176 (a cache pattern to copy), `loadRun` :191 (return object :214-231), `collect` :234 (calls `loadRun` at :250 and :255), `oneLine` :366, overview row :544, pipeline view :696-721 | Data load, cache and both render sites |
| `.claude/plugins/sdlc-monitor/hooks/register.test.ts` | `RunSpec` :6, `world()` :43 (the `process.run` handler :97-107 returns `out('')`) | Stub the `changes` call (spec items 11-15) |
| `server/__tests__/scripts/sdlc-mod.test.js` | helpers `git` :29, `mkRepo` :35, `mod` :58 | Script tests (items 1-10) |
| `README.md` | command list :106-111, control pane paragraph :118 | Docs |
| `CLAUDE.md` | `scripts/sdlc-mod.sh` command row | Docs |

Notes from reading the code:
- `write_reg` (:39) writes no `base` field yet. That field comes from `add-base-branch-dropdown`. `cmd_changes` therefore reads `base` with `json_get` and falls back to `pick_base` when it is empty. `json_get` already returns an empty string for a missing key.
- `loadRun` has no clock. `collect` has `now`, so `now` is passed in as a new parameter.
- `WT_BASE` and `REG` are already defined globally. `check_slug` gives the slug validation and exit 2.
- The stub `process.run` handler in `register.test.ts` returns `out('')` for unknown commands. An empty stdout cannot be parsed, so `changes` would be `null` for every existing test. Existing tests therefore stay unchanged in behaviour.

## Order of work

The Red tests stage covers steps 1 and 2. Implement covers steps 3 to 6, and docs go last.

### 1. Script tests: `server/__tests__/scripts/sdlc-mod.test.js`
Add a `describe('changes')` block built on the existing `mkRepo`, `git` and `mod` helpers, with a stub `sdlc.sh`. Cover acceptance items 1-10. Create the worktree with `git worktree add` under `SDLC_WT_BASE`, and write the run record by hand to `<common dir>/sdlc-runs/<slug>.json`. Item 8 deletes the worktree folder. Item 10 writes a `base` into the record and compares it with the value from `pick_base`.

### 2. Pane tests: `register.test.ts`
- Extend `RunSpec` with `changes?: { changed: number; uncommitted: number } | 'fail' | 'garbage'` and `base?: string`. Add `base` to the record JSON in `world()` only when it is set.
- In the `process.run` handler add a branch for `e.argv[1]` ending in `sdlc-mod.sh` with `argv[2] === 'changes'`. It records the call, then returns the JSON, an exit code of 1, or unparseable text.
- Add tests for items 11-15. Item 15 uses `clock` to advance time: under 10 s a finished run makes no new call, and a running run makes one call per refresh.

### 3. `scripts/sdlc-mod.sh`
1. Header comment: add the line `scripts/sdlc-mod.sh changes <slug> [--json]`.
2. `usage` (:31): add `| changes <slug> [--json]` to the string.
3. Add `cmd_changes` before the dispatch `case`. Arguments: slug and optional `--json`, in either order.
   - Parse the arguments: exactly one non-flag slug, `--json` accepted once, anything else calls `usage`. Then run `check_slug`.
   - Resolve the worktree. Read `worktree` from `$REG/$slug.json` with `json_get`; use it if it is a directory. Otherwise use `$WT_BASE/$slug` if it is a directory.
   - If neither is a directory, report the error. When the record file exists, print `Worktree for $slug is gone`. When it does not, print `No pipeline for $slug`. Both go to stderr with exit 1 and empty stdout.
   - Pick the base: `json_get` on `base`, else `pick_base`.
   - Compute `mb` with `git -C "$wt" merge-base HEAD "$base" 2>/dev/null || true`.
   - Committed paths: when `mb` is non-empty, run `git -C "$wt" diff --name-only "$mb"..HEAD 2>/dev/null || true`.
   - Uncommitted: run `git -C "$wt" status --porcelain --untracked-files=all`. `M` is the line count. For paths take `cut -c4-`, and for renames take the part after ` -> `. Use `-z` if quoted paths are a concern: porcelain v1 quotes unusual names, so prefer `status --porcelain -z --untracked-files=all` and have `node` split on NUL. For a rename the new path comes first in `-z` output, followed by the old path as a separate entry that must be skipped.
   - Build the union and the count. Dedupe and sort with a single `node -e` call, consistent with `json_get`. That call reads the committed list from stdin and the porcelain output, and prints `changed`, `uncommitted` and (with `--json`) the capped list of 50 as one JSON object. Plain mode prints `"$changed $uncommitted"`.
   - Do not make any network call. Do not use `fetch`, `ls-remote` or `rev-parse` against remotes.
   - Keep `set -euo pipefail` safe: guard every pipeline that may legitimately return non-zero (an unknown base, an empty diff) with `|| true`.
4. Dispatch: `changes) [ $# -eq 2 ] || [ $# -eq 3 ] || usage; shift; cmd_changes "$@" ;;`. Keep the same shape as the `watch` entry.

### 4. `types/index.d.ts`
Add to `Run`: `changes: { changed: number; uncommitted: number } | null`, with a one-line comment (null: unmanaged, command failed, or output unparseable).

### 5. `register.tsx`
1. Constant `CHANGES_EVERY_MS = 10000` next to `PENDING_EVERY_MS`.
2. Module cache `const changesCache = new Map<string, { at: number; value: Run['changes'] }>()`, next to `pendingCache`.
3. `async function loadChanges($, slug, state, now)`:
   - Return the cached value when the state is `done`, `failed`, `interrupted` or `stopped` and an entry younger than `CHANGES_EVERY_MS` exists. For `running`, `paused` and `starting`, always call.
   - Call `$.process.run(['bash', WRAPPER, 'changes', slug, '--json'])`. Return `null` when `exitCode !== 0`, when the call throws, or when `JSON.parse` fails or `changed` or `uncommitted` are not numbers.
   - Store `{ at: now, value }` in the cache, including `null`.
4. `loadRun`: add a `now: number` parameter and compute `changes = reg === null ? null : await loadChanges(...)` after `state` is decided. Add `changes` to the returned object. Update both callers in `collect` (:250 and :255) to pass `now`.
5. `oneLine` (:366): the summary text cannot be extended inside the existing `if` chain, so rename the current function body to `stateLine` and make `oneLine` call it. Then append according to spec 3.2:
   - `changes` is null: no suffix.
   - `changed === 0 && uncommitted === 0`: a suffix of ` · no changes yet` when the state is `running`, none otherwise.
   - Otherwise: ` · ${changed} files changed (${uncommitted} uncommitted)`.
   The overview call site at :544 needs no change.
6. Pipeline view: after the Tests block (:711-716) and before the document checklist (:718), add `{run.changes && <Text>Files  {run.changes.changed} changed since {base} · {run.changes.uncommitted} uncommitted</Text>}`. `base` is the record's `base` when present, else the word `base`. This needs the record's `base` on `Run`: add `base: string` to `Run` (`String(reg?.base ?? '')`) and use `run.base || 'base'`.
7. Clear the cache entry for a slug in `discardRun` (:275), so a restart does not show a stale count.

### 6. Docs
- `README.md` :106-111: add `bash scripts/sdlc-mod.sh changes <slug> [--json]   # files changed in the pipeline's worktree: "<changed> <uncommitted>"`. In the control pane paragraph (:118) describe the overview suffix, the `Files` line and the 10 s refresh for finished pipelines.
- `CLAUDE.md`: add `changes` to the `scripts/sdlc-mod.sh` command row, in the list `run|stop|restart|discard|status|watch`.

### 7. Verify
- `npm test` from the repo root (covers the script tests).
- Run the pane tests the way the plugin's existing tests run (the `claude-code/testing` harness).
- Manual check of a real worktree: `bash scripts/sdlc-mod.sh changes add-pipeline-change-counts --json`.

## Risks and decisions
- **Rename paths in `status`.** Handled with `-z` and a node splitter (step 3). Without it a quoted or renamed path would be counted wrongly.
- **`base` field not yet written** by `write_reg`. The plan tolerates its absence (spec 2.2). If `add-base-branch-dropdown` ships first, no change to this plan is needed.
- **Cost of the call.** A 2 s refresh times two parallel pipelines is a few git calls per second. The spec accepts this, and the 10 s cache only limits finished pipelines.
- **`loadRun` signature change.** Its only callers are the two sites in `collect`.
- **Unmanaged runs** (`reg === null`) make no call, per spec 3.1.
