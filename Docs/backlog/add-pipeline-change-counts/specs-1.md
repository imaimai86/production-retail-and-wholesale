# Spec: add-pipeline-change-counts (round 1)

Binding inputs: `brief.md` and `decisions.md` (Q1: distinct "worktree is gone" message; Q2: accepted).

## 1. Purpose
Show, per SDLC pipeline, how many files it has changed, counted inside the pipeline's own worktree (never the main working tree). Provide the numbers to scripts through a new wrapper subcommand and to the control pane (overview row and pipeline view).

## 2. Subcommand `bash scripts/sdlc-mod.sh changes <slug> [--json]`

### 2.1 Resolving the worktree
1. If the run record `<git common dir>/sdlc-runs/<slug>.json` exists and its `worktree` folder exists, use it.
2. Otherwise, if `$WT_BASE/<slug>` exists as a folder, use it (this also covers a missing record).
3. Otherwise it is an error (see 2.6).

### 2.2 Definitions
- `<worktree>`: the folder resolved above. Every git call is `git -C "<worktree>" ...`; results never depend on the current directory and never on the main working tree's state.
- **uncommitted** (`M`) = number of lines printed by `git -C "<worktree>" status --porcelain --untracked-files=all`. Untracked files count one each. Ignored and locally excluded files (the linked `server/node_modules`, `graft`, `.env`) do not count.
- **base** = the record's `base` field when present (added by `add-base-branch-dropdown`), else the output of `pick_base`.
- **merge-base** = `git -C "<worktree>" merge-base HEAD <base>`.
- **committed paths** = `git -C "<worktree>" diff --name-only <merge-base>..HEAD`. If the merge-base cannot be computed (no common ancestor, unknown base), committed paths are empty; this never causes a failure or a non-zero exit.
- **uncommitted paths** = the paths named by the porcelain lines above (for a rename, the new path).
- **changed** (`N`) = number of distinct paths in the union of committed paths and uncommitted paths. A file committed and edited again counts once.
- No network call is made (no fetch, no remote query).

### 2.3 Plain output
One line on stdout: `<changed> <uncommitted>` (two integers separated by a single space), exit 0.

### 2.4 `--json` output
One JSON object on stdout, exit 0, with exactly these fields:
`{"slug":"<slug>","worktree":"<path>","changed":N,"uncommitted":M,"files":["<path>", ...]}`
- `files` lists the distinct paths of the union (relative to the worktree root, as git reports them), in sorted order, capped at 50 entries. `changed` is the true total and is not capped.
- `worktree` is the resolved folder path.
- `--json` may appear before or after `<slug>`.

### 2.5 Usage text
The wrapper's usage/help text lists `changes <slug> [--json]`. A missing `<slug>` follows the wrapper's existing convention for other subcommands that need a slug.

### 2.6 Errors
| Case | stdout | stderr | Exit |
|---|---|---|---|
| No run record and no `$WT_BASE/<slug>` folder | nothing | `No pipeline for <slug>` | 1 |
| Run record exists, its `worktree` folder and the `$WT_BASE/<slug>` fallback are both missing (deleted by hand, discarded) | nothing (plain and `--json`) | `Worktree for <slug> is gone` | 1 |
| No merge-base | counts with committed part 0 | nothing | 0 |

## 3. Control pane (`.claude/plugins/sdlc-monitor/hooks/register.tsx`, `types/index.d.ts`)

### 3.1 Data
- `Run` gains `changes: { changed: number; uncommitted: number } | null`.
- `loadRun` runs `bash scripts/sdlc-mod.sh changes <slug> --json` through `process.run` and parses `changed` and `uncommitted`.
- `changes` is `null` when: the run is unmanaged (`managed: false`, no record; no call is made), the command exits non-zero (any reason, including both error rows in 2.6), or its output cannot be parsed.
- Refresh policy: for state `running`, `paused`, `starting` the command is called on every refresh (2 s). For `done`, `failed`, `interrupted`, `stopped` it is called at most every 10 s per pipeline; in between, the last result is reused (the cached value, including `null`).

### 3.2 Overview row
`<oneLine> · N files changed (M uncommitted)` appended to the existing one-line summary, where N = changed, M = uncommitted.
- `changes` is `null`: nothing appended.
- N = 0 and M = 0 and state is not `running`: nothing appended.
- N = 0 and M = 0 and state is `running`: `<oneLine> · no changes yet`.

### 3.3 Pipeline view
- `changes` is `null`: no `Files` line.
- Otherwise (including 0/0, any state): a line `Files  N changed since <base> · M uncommitted`, where `<base>` is the record's `base` when present, else the word `base`.

## 4. Documentation
- `README.md` control pane section: describe the counts and add `changes <slug> [--json]` to the wrapper command list.
- `CLAUDE.md`: add `changes` to the `scripts/sdlc-mod.sh` command row.

## 5. Out of scope
`scripts/sdlc.sh`; listing changed files in the pane; the guard plugin; status-line helpers; the monitor command in the docs.

## 6. Acceptance criteria
Script (`server/__tests__/scripts/sdlc-mod.test.js`, throwaway git repos, stub `sdlc.sh`):
1. A worktree with committed plus uncommitted changes prints the right `<changed> <uncommitted>`.
2. A file committed and then edited counts once in `changed`.
3. Untracked files count; the linked `server/node_modules` symlink does not.
4. `--json` has exactly the fields `slug`, `worktree`, `changed`, `uncommitted`, `files`; with more than 50 changed files `files` has 50 entries and `changed` is the full total.
5. Numbers are identical when run from another directory.
6. Dirtying the main working tree with an unrelated file changes neither number.
7. Unknown slug: exit 1, stderr `No pipeline for <slug>`, empty stdout.
8. Record present but worktree deleted by hand: exit 1, stderr `Worktree for <slug> is gone`, empty stdout (plain and `--json`).
9. No merge-base: committed part is 0 and exit code is 0.
10. With no `base` in the record, the base is `pick_base`; with `base` present, it is used.

Pane (`register.test.ts`, stubbed `process.run`):
11. A running pipeline's overview row shows `N files changed (M uncommitted)`.
12. A running pipeline with 0/0 shows `no changes yet`; a non-running 0/0 pipeline shows nothing.
13. An unmanaged run (no call made) and a run whose `changes` call exits non-zero (discarded or worktree gone) show no counts and no `Files` line.
14. The pipeline view shows `Files  N changed since <base> · M uncommitted`, with the word `base` when the record has no `base`, and shows it for 0/0 when `changes` is not null.
15. A finished pipeline's counts are not recomputed within 10 s; a running pipeline's are recomputed on every refresh.

Docs:
16. `README.md` and `CLAUDE.md` mention `changes` as described in section 4.
