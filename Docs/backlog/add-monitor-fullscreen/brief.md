# add-monitor-fullscreen

Type: feature
Priority: P2 (normal)
Source: user request in the triage conversation: "improve the design and user experience of the sdlc monitor plugin, make it a full screen tool", with the design mockup "SDLC Monitor Full Screen" (screen 1, all pipelines). Decision from the user: a big pane inside Claude Code, not a standalone app.

## Problem
`/sdlc-monitor` opens a plugin pane with `$.ui.open({ id: PANE, title: 'SDLC control' })` (`.claude/plugins/sdlc-monitor/hooks/register.tsx:473`) and no size request. Claude Code docks it beside the transcript from 110 columns or places it above the prompt, a third of the screen by default. All content is one long column of buttons and text, so pipelines, stages, tests, output and inputs compete for a small area. Verified from `register.tsx` and the plugin typings (`PaneOpenArgs`: `rows` and `columns` are requests, a size the person dragged wins); nothing was run.

## Expected behaviour
Opening the monitor gives a large, organised screen: a pipeline list on the left, the selected pipeline on the right with a stage rail, input per stage and live output, and a key hint line at the bottom.

At any point, in any state, the developer can open a progress view of the selected pipeline that lists every file it has changed so far, grouped as the spec, plan and test-case docs, the test files, and the source files.

## Decisions
- Stay a plugin pane. `$.ui.open` is called with `focus: true` and `rows` and `columns` set to the largest size the layout allows (in practice a high number; the engine caps it). The person's own resize wins, and on a narrow terminal the pane stays inline. No standalone terminal app.
- Layout, from the mockup:
  - Header: `SDLC control / <view>` on the left, a one-line count of running, waiting and queued pipelines on the right.
  - Left column (about 40% of the width): pipelines, each as glyph, slug, stage with attempt, and state, using the existing `GLYPH` and `COLOR` maps. The selected row is highlighted.
  - Right column: the selected pipeline's title and state, a row of six stage boxes (Spec, Plan, Red tests, Implement, Review, Ship, with done, running, waiting and pending styles), then "Your input per stage", then the live output tail and the tests summary already in the snapshot.
  - Footer: key hints from the `Button` `hotkey` prop (`↑↓` select, `Enter` open, `n` new run, `i` add input, `s` stop, `q` close).
- Ship is shown as the sixth box for the Commit stage in `status.json`; naming follows `CLAUDE.md` (Spec, Plan, Red tests, Implement, Review, Ship).
- Progress view ("Files changed"), opened with `f` from the overview or any pipeline screen (running, waiting, paused, stopped, failed or done) and closed with `Esc`:
  - It lists the files the pipeline changed in its own worktree, committed and uncommitted, relative to the run's base branch (`Run.base`, or `main` when empty).
  - Groups, in this order: Pipeline docs (files under `Docs/backlog/<slug>/`, such as `specs-1.md`, `plan-1.md`, `test-cases-1.md`, `review-1.md`, with `logs/` left out); Tests (under `server/__tests__/`); Source (every other file). Each row shows a status letter (`A` added, `M` modified, `D` deleted, `?` untracked), the path, and `uncommitted` when it is not committed yet.
  - Each group header shows its count, and the overview detail shows the existing total (`Run.changes`).
  - Data: `scripts/sdlc-mod.sh changes <slug> --json` gains a `files` array of `{ "path", "status", "committed" }`; its existing keys and the table output are unchanged. The snapshot carries it as `Run.changes.files`; it refreshes on the existing 10 s cadence for a pipeline that is not running (`CHANGES_EVERY_MS`) and every poll for a running one.
  - Unmanaged runs and discarded ones have no list; the view says "not available" as the counts do today.
  - Opening a file (viewing its contents) is out of scope; the view lists paths only.
- Open and minimize:
  - The pane never opens on its own. It opens only from the `/sdlc-monitor` command or the `SDLC` button above the prompt (`AbovePrompt` render, already present).
  - A Close action (`q`, and `Esc` through `closeOnEscape: true` on `$.ui.open`) calls `$.ui.close({ id: PANE })` and returns the person to the normal view. There is no separate minimized state: the typings offer open and close only.
  - While the pane is closed the `SDLC` button stays above the prompt with the running, waiting and queued counts, the status line summary and the toasts keep working, and pipelines keep running (they are background processes).
  - Reopening shows the pipeline that was selected, the drafts and the queue, because they live in plugin atoms (`view`, `draft`, `queue`), not in the pane. Closing does not reset them.
- Everything the pane does today keeps working: start, select several and run, queue, answer Spec questions, stop with confirm, discard and restart, change counts, base branch display, toasts.
- The input and stop controls from `add-stage-input-gate` and `add-stage-stop-with-input` are drawn in this layout; until they exist the layout keeps today's input row and Stop button.
- Colours, terminal-safe: green done, cyan running, yellow waiting or stopped, red failed, dim grey pending. No colour carries meaning alone: every state also has its glyph and word.
- Times in the pane are shown in GST, written like `14:02 GST` (project rule).
- Text only, no new dependency, no multi-line input.

## Scope
- In: `.claude/plugins/sdlc-monitor/hooks/register.tsx` (render layout, `ui.open` call, Files changed view), `.claude/plugins/sdlc-monitor/types/index.d.ts` (`Run.changes.files`, state atoms), `scripts/sdlc-mod.sh` (`changes --json` gains `files`, nothing else).
- Out of scope: any other change to `scripts/sdlc.sh` or `scripts/sdlc-mod.sh`; the gate and stop-with-input behaviour; the standalone terminal app; the sdlc-guard plugin.

## Tests
- `.claude/plugins/sdlc-monitor/hooks/register.test.ts`: `ui.open` is called with `focus: true` and the size request; the overview renders the list and the detail for the selected run; each state shows its glyph and word; the six stage boxes follow `status.json`; times render in GST; start, stop, discard, queue and the Spec question flow still work.
- `register.test.ts` also covers open and close: nothing is opened at `session.start`; the `SDLC` button and `/sdlc-monitor` call `ui.open`; `q` and `Esc` call `ui.close`; after a close and reopen the same pipeline is selected and the drafts are intact; the button still renders with counts while closed.
- `server/__tests__/scripts/sdlc-mod.test.js` (throwaway git repos): `changes --json` returns `files` with the right path, status and `committed` for an added, a modified, a deleted and an untracked file, and keeps its existing keys; `logs/` paths are not listed.
- `register.test.ts` also covers the Files changed view: grouping into docs, tests and source; `f` opens it in a running, waiting, stopped and done state and `Esc` closes it; an unmanaged run shows "not available".
- Integration tests: none, there is no database or API change.

## Docs
- `CLAUDE.md`: the `scripts/sdlc-mod.sh` row is unchanged except that it can mention `changes <slug> --json` lists files. The command to open the pane stays `/sdlc-monitor`. Key hints are shown in the pane itself.

## Open questions
- none
