# fix-monitor-worktree-path

Type: bug
Priority: P2 (normal)
Source: report: "each sdlc pipeline run in its own worktree so multiple tasks can run parallel, all files change counts or status check in any UI or plugin should check the worktree" (the status-check part).

## Problem
The monitor command that `CLAUDE.md` (line 39) and `.claude/commands/sdlc.md` (line 10) require in every reply while a pipeline runs is `watch -n3 'cat Docs/backlog/<slug>/logs/status.json; git status --short | head -15'`. Both halves use the current directory. For a pipeline started through the wrapper or the pane, the status file and every file the pipeline changes are in its worktree (`../<repo>-sdlc/<slug>`, registry field `worktree`), so the command prints `No such file or directory` and the main tree's unrelated status.
Reproduced read-only on 2026-10-06 against the running pipeline `fix-ship-commit-scope`: from the main tree, `cat Docs/backlog/fix-ship-commit-scope/logs/status.json` failed and `git status --short` listed 1 unrelated file; in the worktree the same status file showed stage Red tests and `git status` listed 6 uncommitted files. Cause: the command was written before pipelines moved to worktrees (PR #38) and was never updated; replies have been adapting it by hand.
Checked and fine: `scripts/sdlc.sh` runs its own git checks in its working directory, which is the worktree when the wrapper starts it (`cd "$(dirname "$0")/.."`, line 10); `cmd_discard` uses `git -C "$wt"` (`scripts/sdlc-mod.sh:194`); the pane reads the worktree; the guard plugin reads `status.json` relative to the agent's working directory, which is the worktree. Not verified: the Graft helpers in `.claude/helpers/` (grep found no `git status` or `git diff` in them).

## Expected behaviour
One monitor command that works for any pipeline, because it finds the right directory itself. The docs print that fixed command with the slug filled in, and it shows the pipeline's real status and the files changed in its worktree.

## Decisions
- New wrapper subcommand `watch <slug> [--once]`. It resolves the pipeline directory from the run record (registry `worktree`); else `.` when `Docs/backlog/<slug>/logs/status.json` exists in the current directory (a run started in place); else exit 1 with `No pipeline for <slug>`. It loops every 3 seconds (`WATCH_INTERVAL` overrides), clearing the screen each time; `--once` prints one frame and exits (used by tests). It does not depend on `watch(1)`, which macOS lacks.
- One frame, in this order: the `status.json` line; a line `changed: <N> files, uncommitted: <M>` from `changes <slug>` when that subcommand exists (see `add-pipeline-change-counts`), omitted otherwise; the first 15 lines of `git -C "<dir>" status --short`; the last 5 lines of `<dir>/Docs/backlog/<slug>/logs/run.out`. When the run record says the process has gone, or the run is interrupted or exited, the frame says so on a line of its own.
- The command printed in replies becomes `bash scripts/sdlc-mod.sh watch <slug>`. Update the code block in the "MANDATORY: show the monitor command" bullet of `CLAUDE.md` and the code block in `.claude/commands/sdlc.md`; the prose about `status.json` and `run*.out` stays but says the files are in the pipeline's worktree when started through the wrapper.
- No existing test asserts the old command text (checked with `git grep` in `server/__tests__`).

## Scope
- In: `scripts/sdlc-mod.sh` (`watch`, usage text); `CLAUDE.md`; `.claude/commands/sdlc.md`; `README.md`; `server/__tests__/scripts/sdlc-mod.test.js`.
- Out of scope: `scripts/sdlc.sh`; the pane; the user's memory files; the Graft helpers; the in-session `/spec`, `/plan`, `/implement`, `/review` commands.

## Tests
- `server/__tests__/scripts/sdlc-mod.test.js` (throwaway git repos, stub `sdlc.sh`): `watch <slug> --once` for a wrapper run prints the `status.json` line from the worktree, not from the main tree; its `git status` part lists the worktree's files and does not list an unrelated file created in the main tree; the run-in-place fallback works with a status file in the current directory; an unknown slug exits 1 with the message; a finished run and a stopped run print the matching line; `WATCH_INTERVAL` is read (a frame with a bad value exits 2).
- A wiring test (same file or `server/__tests__/scripts/monitor-command.test.js`) reads `CLAUDE.md` and `.claude/commands/sdlc.md` as text and asserts both contain `bash scripts/sdlc-mod.sh watch <slug>` and neither contains the old `git status --short | head -15` command.

## Docs
- `CLAUDE.md` and `.claude/commands/sdlc.md`: the new command. `README.md` (control pane section): `watch <slug>` in the wrapper command list.

## Open questions
- none
