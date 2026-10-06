# run-sdlc-in-worktree

Type: feature
Priority: P2 (normal)
Source: report: "each sdlc pipeline run in its own worktree so multiple tasks can run parallel, all files change counts or status check in any UI or plugin should check the worktree" (the isolation part). Decision recorded 2026-10-06: the user chose that `./scripts/sdlc.sh` delegates to a worktree by default.

## Problem
Worktree isolation exists only when a pipeline is started through `scripts/sdlc-mod.sh run` or the control pane. `./scripts/sdlc.sh <slug>`, still the documented pipeline command (the `CLAUDE.md` command table, the README, the output of `/triage`), runs in the current working tree: it changes into the repo root (`scripts/sdlc.sh:10`) and runs `git checkout` of `sdlc/<slug>` there (line 79). Two direct runs, or a direct run beside the developer's own work, share one working tree and one branch checkout, and each run's guards diff the whole tree (for example `src_hash`, line 77), so parallel tasks interfere with each other. That is the reason the wrapper exists. Verified by reading the code; the interference was not reproduced.

## Expected behaviour
`./scripts/sdlc.sh <slug>` runs the pipeline in its own worktree, exactly like the wrapper, so several tasks (up to the cap of 2) can run in parallel from any entry point, without touching the working tree it was started from.

## Decisions
- Delegation: early in `scripts/sdlc.sh`, after the slug is resolved (a missing slug and the "first pending item" pick behave as today) and before any git change, when none of `SDLC_IN_PLACE=1`, `SDLC_IN_WORKTREE=1` and a non-empty `CI` is set, the script starts `bash scripts/sdlc-mod.sh run <slug>` as a child process (not detached).
- Foreground behaviour: it prints `Pipeline for <slug> runs in its own worktree: <path>` and `Monitor it with: bash scripts/sdlc-mod.sh watch <slug>` (print only the path line when the `watch` subcommand does not exist yet; see `fix-monitor-worktree-path`), then streams `<worktree>/Docs/backlog/<slug>/logs/run.out` from the start until the wrapper process exits, and exits with the wrapper's exit code: 0 done, 2 paused for answers, 3 cap full, 4 already running, 5 already merged, anything else failed. The messages `PAUSED: ...` that today appear on the terminal still appear (they are in `run.out`).
- Interrupt: Ctrl-C (INT) or TERM on the foreground `sdlc.sh` runs `bash scripts/sdlc-mod.sh stop <slug>`, then exits 130 (INT) or 143 (TERM). The pipeline does not keep running unseen.
- The wrapper sets `SDLC_IN_WORKTREE=1` in the environment of the `sdlc.sh` it starts (`scripts/sdlc-mod.sh`, the `exec bash scripts/sdlc.sh` call at line 149), so that run executes in place inside its worktree and never delegates again.
- `SDLC_IN_PLACE=1` keeps the old behaviour (run in the current working tree). A non-empty `CI` also runs in place, as CI has no use for a separate worktree.
- Environment passes through to the pipeline unchanged (`FROM`, `MAX_ATTEMPTS`, `MAX_TURNS`, `MAX_REPAIR_TESTS`, `SDLC_INTEGRATION_CI`, `SDLC_BASE`); the wrapper's cap and "already running" rules therefore apply to direct runs too.
- Ordering: this item edits `scripts/sdlc.sh`, which `fix-ship-commit-scope` also edits (the Ship stage). Start it after that item is merged. The `watch` hint depends on `fix-monitor-worktree-path`; without it the script prints only the worktree path.

## Scope
- In: `scripts/sdlc.sh` (the delegation block and the header comment); `scripts/sdlc-mod.sh` (set `SDLC_IN_WORKTREE=1` for the child); `README.md`; `CLAUDE.md` (the `sdlc.sh` row of the command table and one line in the SDLC pipeline section); a new `server/__tests__/scripts/sdlc-delegate.test.js`.
- Out of scope: the logic of the Spec, Plan, Red tests, Implement, Review and Ship stages; the pane; the guard plugin; the in-session `/sdlc`, `/spec`, `/plan`, `/implement`, `/review` and `/ship` commands (they keep running in the session's working tree).

## Tests
- New `server/__tests__/scripts/sdlc-delegate.test.js`. Each case builds a throwaway git repo containing the real `scripts/sdlc.sh` and `scripts/sdlc-mod.sh`, a brief, and a fake `claude` first on `PATH` that exits 1 immediately (so the real pipeline stops at its first agent without any model call). Cases: a direct run creates the worktree `<wt-base>/<slug>` on branch `sdlc/<slug>`, its `run.out` contains `SDLC: <slug> on branch sdlc/<slug>`, and the starting working tree keeps its branch, HEAD and files; the exit code of the wrapper (1 from the fake agent; 3 with `SDLC_MAX_PARALLEL=0`; 5 when the red-tests commit is on the base; 4 for a second run of a running slug) is the exit code of `sdlc.sh`; the output contains the worktree path line; `SDLC_IN_PLACE=1` and `CI=1` run in the current working tree (the branch is checked out there, no worktree is created); a run started by the wrapper does not delegate again (no second worktree, one `run.out`); `FROM=implement` and `MAX_ATTEMPTS` reach the pipeline (visible in its output); TERM on the foreground script stops the pipeline (the registry says interrupted) and exits 143; a missing slug prints the same usage message as today.
- Wiring (same file): `scripts/sdlc.sh` header comment documents `SDLC_IN_PLACE` and `SDLC_IN_WORKTREE`; `bash -n` passes on both scripts; the existing `sdlc-gates.test.js` and `backlog-list-wiring.test.js` assertions still pass.

## Docs
- `README.md` (SDLC pipeline section): direct runs now use a worktree, where it is, the exit codes, and `SDLC_IN_PLACE=1`. `CLAUDE.md`: the `sdlc.sh` command-table row and one line in the SDLC pipeline section.

## Open questions
- none
