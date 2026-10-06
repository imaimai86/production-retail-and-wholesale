# add-pipeline-change-counts

Type: feature
Priority: P2 (normal)
Source: report: "each sdlc pipeline run in its own worktree so multiple tasks can run parallel, all files change counts or status check in any UI or plugin should check the worktree" (the change-count part).

## Problem
The control pane shows a pipeline's stage, agent, attempt, test progress, artifacts and recent output, but not how many files the pipeline has changed. `loadRun` (`.claude/plugins/sdlc-monitor/hooks/register.tsx:165`) reads everything from the pipeline's worktree (`root = worktree || '.'`) and makes no git call. Nothing else in the repo counts a pipeline's changed files: `git status` and `git diff` are used only inside `scripts/sdlc.sh` (in its own working directory), in `cmd_discard` (`scripts/sdlc-mod.sh:194`, `git -C "$wt" status --porcelain`), and in the documented monitor command (see `fix-monitor-worktree-path`). A count taken from the main working tree would be wrong for wrapper pipelines, because each one's files live in its own worktree (registry field `worktree`). Verified by reading the code and a read-only reproduction on 2026-10-06 (the running pipeline `fix-ship-commit-scope` had 6 uncommitted files in its worktree while `git status` in the main tree showed 1 unrelated file); nothing was changed.

## Expected behaviour
Each pipeline in the pane shows how many files it has changed, counted inside its own worktree: in the overview row ("6 files changed, 6 uncommitted") and in the pipeline view. `bash scripts/sdlc-mod.sh changes <slug>` prints the same numbers for scripts.

## Decisions
- New wrapper subcommand `changes <slug> [--json]`. It finds the worktree from the run record (registry `worktree`), falling back to `$WT_BASE/<slug>` when that folder exists. Plain output is one line, `<changed> <uncommitted>` (two integers). `--json` prints `{"slug":"<slug>","worktree":"<path>","changed":N,"uncommitted":M,"files":["<path>", ...]}` with at most 50 paths. Exit 1 with `No pipeline for <slug>` when there is no record and no worktree. It makes no network call.
- `uncommitted` = the number of lines of `git -C "<worktree>" status --porcelain --untracked-files=all`. Untracked files count; ignored and locally excluded files (the linked `server/node_modules`, `graft` and `.env`) do not.
- `changed` = the number of distinct paths in the union of `git -C "<worktree>" diff --name-only <merge-base>..HEAD` and the uncommitted paths, so a file that was committed and edited again counts once. `<merge-base>` = `git merge-base HEAD <base>`, where `<base>` is the registry field `base` when present (added by `add-base-branch-dropdown`), else `pick_base`. If no merge-base can be computed the committed part counts 0; the command never fails because of it.
- Every git call uses `git -C "<worktree>"` and never depends on the current directory. A pipeline whose worktree is gone (discarded, never started) shows no counts.
- Pane: `loadRun` calls `bash scripts/sdlc-mod.sh changes <slug> --json` for pipelines in `running`, `paused` and `starting` on every refresh (2 s); for `done`, `failed`, `interrupted` and `stopped` at most every 10 s. Pipelines started by hand (no run record, `managed: false`) show no counts: their changes cannot be told apart from the developer's own work in the shared tree.
- `Run` gains `changes: { changed: number; uncommitted: number } | null` (null when unavailable). Overview row: `<oneLine> · N files changed (M uncommitted)`, nothing when both are 0 and the pipeline is not running, `no changes yet` when both are 0 and it is running. Pipeline view: a line `Files  N changed since <base> · M uncommitted`, where `<base>` is the registry `base` when present, else the word `base`.

## Scope
- In: `scripts/sdlc-mod.sh` (`changes`, usage text); `.claude/plugins/sdlc-monitor/hooks/register.tsx`, `register.test.ts`, `types/index.d.ts`; `server/__tests__/scripts/sdlc-mod.test.js`; `README.md` (control pane section); `CLAUDE.md` (the sdlc-mod command row).
- Out of scope: `scripts/sdlc.sh`; listing the changed files in the pane (only counts; `--json` carries paths for later); the guard plugin; the status-line helpers; the monitor command in the docs (`fix-monitor-worktree-path`).

## Tests
- `server/__tests__/scripts/sdlc-mod.test.js` (throwaway git repos, stub `sdlc.sh`): a worktree with committed plus uncommitted changes gives the right `changed` and `uncommitted`; a file committed and then edited counts once in `changed`; untracked files count, the linked `server/node_modules` symlink does not; `--json` has exactly the listed fields and caps `files` at 50; the numbers are the same when the command runs from another directory; dirtying the main working tree with an unrelated file changes neither number; unknown slug exits 1 with the message; a worktree deleted by hand exits 1; with no merge-base the committed part is 0 and the exit code is 0; the base falls back to `pick_base` when the record has no `base`.
- `.claude/plugins/sdlc-monitor/hooks/register.test.ts` (stub `process.run`): an overview row for a running pipeline shows the counts; `no changes yet` appears for a running pipeline with 0/0; an unmanaged run and a discarded run show none; the pipeline view shows both numbers; a finished pipeline's counts are not recomputed within 10 s while a running one's are on every refresh.

## Docs
- `README.md` (control pane section): the counts, and `changes <slug> [--json]` in the wrapper command list.
- `CLAUDE.md`: add `changes` to the sdlc-mod command row.

## Open questions
- none
