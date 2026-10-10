# Plan: add-base-branch-dropdown (round 1)

Source: `specs-1.md`. No source edits are made by this document.

## Affected files (found with Graft plus targeted reads)
Graft indexes neither `.sh` nor `.tsx`, so spans were located with grep and read directly.

| File | Why |
|---|---|
| `scripts/sdlc-mod.sh` | usage (l.32), `write_reg` (l.40), `fail_start` (l.48), `pick_base` (l.69), `is_merged` (l.78), `cmd_run` (l.92), `cmd_discard` (l.184), `cmd_restart` (l.216), `cmd_changes` (l.279, reads record `base`, falls back to `pick_base`), header comments (l.6-18), dispatcher at the end of the file (not yet read) |
| `.claude/plugins/sdlc-monitor/hooks/register.tsx` | atoms (l.28-37), `loadPending` (l.178), `collect` (l.259 maps `reg.base`), `launch` (l.293), `startRun` (l.308), `runSelected` (l.327), `drainQueue` (l.342), pending rows (l.548), Start page (l.609), the other `launch` callers (resume, l.368/679/775: no change), pipeline view (l.750) |
| `.claude/plugins/sdlc-monitor/types/index.d.ts` | `Run` (has or needs `base`), `Snapshot` (add `branches`), `PendingItem` |
| `server/__tests__/scripts/sdlc-mod.test.js` | wrapper tests. It already has `changes` base tests (l.645-656) that must keep passing. |
| `.claude/plugins/sdlc-monitor/**/register.test.ts` | pane tests (locate the existing file; create it if missing) |
| `README.md`, `CLAUDE.md` | docs |

Callers (Graft `find_all`): `pick_base`, `is_merged`, `fail_start` are referenced only in `sdlc-mod.sh`; the test file only names `pick_base` in a test title. `launch` callers in `register.tsx` other than `runSelected`, `drainQueue` and `startRun` are resume paths and stay unchanged. `scripts/sdlc.sh` is out of scope.

## Order of work
Tests come first in each part (Red tests stage). Part A (wrapper) is independent of part B (pane) except for the `--base` contract.

### A. Wrapper (`scripts/sdlc-mod.sh`)
1. **Usage and header comments.** Add `[--base <name>]` to `run` and `restart`. Update the `SDLC_BASE` comment (default `main`, then origin/HEAD, then HEAD).
2. **`valid_base_name <name>`** (new, exit 2). Regex `^[A-Za-z0-9._/-]+$`, not starting with `-`, no `..`, non-empty. The message names the bad value. It runs first, for `--base` and for `SDLC_BASE`.
3. **`fetch_base <name>`** (new). `git fetch --quiet origin <name>` limited to 20 s. Use a portable approach: run in the background and kill it after 20 s with a polling loop, or perl `alarm`. Never use `timeout`. A failure is logged only (`fetch of <name> failed or timed out`) and returns 0. Skip silently when there is no `origin` remote.
4. **`resolve_base <name>`** (new). Prints `origin/<name>` when that ref exists and local `<name>` is absent or an ancestor of it (`git merge-base --is-ancestor`). Otherwise prints local `<name>`. Exit 7 when neither exists, with `base branch '<name>' not found (local or origin)`.
5. **Rewrite `pick_base [flag-value]`.**
   - Precedence: flag > non-empty `SDLC_BASE` > default.
   - Default: `main` if it exists locally or on origin, else `git symbolic-ref refs/remotes/origin/HEAD` stripped of `origin/`, else the current `HEAD`.
   - An explicit name never falls back.
   - Order: validate, optional fetch (a parameter that only `cmd_run` and `cmd_restart` set, and only when a new branch/worktree will be created), then resolve.
   - Output is the resolved ref, plus a way to tell the caller whether the name was explicit (global variable `BASE_EXPLICIT`).
   - It must not break `cmd_changes` (l.298: record base first, `pick_base` fallback).
6. **Argument parsing helper `parse_flags`** (new). Handles `--base <name>` (missing or repeated value gives usage, exit 2), `--yes`, `--stop`, in any order after the slug. Use it in `cmd_run` and `cmd_restart` (replaces `yes="${2:-}"`). `cmd_discard` keeps its own loop and gets no `--base`. Update the dispatcher `case` at the end of the file to pass all remaining args (`"$@"` after the slug).
7. **`cmd_run`.**
   - Order: `check_slug`, open log, validate the name (2), "already running" (4), then decide whether the branch and worktree are new (`[ ! -e "$wt/.git" ]` and no `refs/heads/sdlc/<slug>`).
   - Fetch only when new. Then `resolve` (7 via `fail_start`, nothing created). Then capacity (3) and merged (5), which need the resolved base.
   - Moving the capacity check after resolution is required by spec 2.7.
   - When `sdlc/<slug>` or its worktree already exists: skip the fetch, still validate and check existence, and log `base ignored: sdlc/<slug> already exists`.
   - Brief lookup uses the resolved `$base` (already so at l.119).
   - `git worktree add ... -b "$branch" "$base"` uses the resolved ref.
8. **`write_reg`.** Add a `base` field (new final parameter after `message`, or an exported `RUN_BASE`). Write it on every call from `cmd_run`, including resume, and from `fail_start` (the requested name, or empty). Escape it like `message`. Check that every existing `write_reg` call (l.52, 146, 163, 165) keeps working.
9. **`cmd_discard`.** Call `pick_base` with no flag and no fetch. An unknown `SDLC_BASE` exits 7 to stderr and nothing is deleted. The check runs before any deletion and before the `--yes` prompt output.
10. **`cmd_restart`.** Use `parse_flags`. Resolve the base once (validate, existence 7, merged guard 5) before discarding anything. Do the discard half without fetch. Then call `cmd_run "$slug" --base "$base_name"` so the fetch happens when the fresh branch is created. Keep the `SDLC_ALLOW_MERGED` behaviour.
11. **Red/green tests** in `server/__tests__/scripts/sdlc-mod.test.js`, one block per criterion 1-13. Use throwaway git repos, a stub `sdlc.sh` and a local bare repo as `origin`. Cover the exact exit 7 message, the exit 2 cases (`--evil`, `a..b`, spaces, empty), the record's `base` on resume, the `base ignored` log line, and the fetch cases (new commit on origin, unreachable origin, no fetch on reuse, bounded wait).

### B. Control pane
12. **`types/index.d.ts`.** Add `branches: string[]` to `Snapshot`. Confirm `Run.base: string` exists (`collect` already maps `reg?.base`).
13. **`register.tsx` state.** Add the atom `bases` (`Record<string,string>`, key `bases`). Change the `queue` atom from `string[]` to `{slug, base}[]`. Update its readers: `drainQueue`, the pending count at l.462/513/532, the `waiting.includes` check at l.550, and the queued rows at l.587.
14. **`loadBranches($, now)`** (new, beside `loadPending`, same 10 s cache). One `git for-each-ref --format=%(refname) refs/heads refs/remotes/origin` call, no network. Strip `refs/heads/` and `refs/remotes/origin/`, drop `HEAD`, dedupe, sort with `main` first. On error return `['main']`. Call it from `collect` (l.289) and put the result in the snapshot.
15. **`defaultBase(branches, originHead)`** (new, pure). `main`, else the origin/HEAD branch (read once with `git symbolic-ref --short refs/remotes/origin/HEAD`), else `branches[0]`.
16. **`launch($, slug, from, base?)`.** When `base` is given, run `bash -c 'nohup bash WRAPPER run "$0" --base "$1" </dev/null >/dev/null 2>&1 &' slug base` (separate positional args, never interpolated). Resume callers (l.368, 679, 775) pass no base.
17. **`startRun`, `runSelected`, `drainQueue`.**
    - `startRun` reads `bases[slug] ?? default` and passes it.
    - `runSelected` launches `free` slugs, each with its own base, and queues the rest as `{slug, base}`.
    - `drainQueue` launches `next.slug` with `next.base`.
    - Clear the `bases` entry on launch and on queueing.
18. **Pending rows (l.548).** Add `<Select key={`base-${p.slug}`} label="from" options value onSelect={(v) => update($, bases, m => ({...m, [p.slug]: v}))} />` after the checkbox `Button`. Keep `sel-<slug>`. Add a dim note "base ignored: branch exists" when `sdlc/<slug>` is in `branches`.
19. **Start page (l.609).** Same `Select`, and `startRun` passes the value.
20. **Pipeline view.** Show `from <run.base>` only when `run.base` is non-empty (near l.750). Show the recorded `message` for a refused start (exit 7) as the pane already does for other refusals. Verify this path when implementing.
21. **Pane tests** (`register.test.ts`, stubbed `$.process.run`), criteria 14-18.

### C. Docs
22. `README.md` (SDLC control section): the dropdown, `--base`, the resolution rule, base ignored on resume, exit 7. `CLAUDE.md` sdlc-mod command row: `run|restart [--base <name>]`.

### D. Verification
23. Run `npm test` from the repo root. Run `bash scripts/sdlc-integration.sh` as the pipeline does. The `Select` rendering and keyboard use are a manual check in Review.

## Risks and notes
- Moving the capacity check (3) after base resolution changes the order of refusals. This is as the spec says (2.7), but check the existing capacity tests.
- The `queue` atom shape change touches several readers (step 13). Missing one would break the queue display.
- `Select` is available as a pane component per spec 3.2. Confirm its import and props against the plugin's types before use.
- `write_reg` has a fixed `printf` format. Add the field in one place and keep the JSON valid for `json_get` and `collect`.
- Open questions: none. The spec's Round 1 and Round 2 decisions cover the open points.
