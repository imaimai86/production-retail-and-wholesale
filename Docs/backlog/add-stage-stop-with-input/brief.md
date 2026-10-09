# add-stage-stop-with-input

Type: feature
Priority: P2 (normal)
Source: user request in the triage conversation: "a way to stop and add user inputs even after they start", with the design mockup "SDLC Monitor Full Screen" (screens 3 and 4).

## Problem
Once a stage's agent has started, its prompt is fixed. To steer it today the developer has to use three separate controls: Stop (`sdlc-mod.sh stop`), type into the "Manual input per stage" row, and press that stage's "resume at" button (`register.tsx`, `INPUT_STAGES` and `launch`). Nothing ties the input to the stage that was running, and nothing says the old agent never saw it. Verified by reading `register.tsx`, `scripts/sdlc-mod.sh` and `scripts/sdlc.sh`; nothing was run.

## Expected behaviour
On a running pipeline the developer presses one key, types the new instructions, and confirms. The pipeline stops, the input is saved for the stage that was running, and that stage starts again with the input.

## Decisions
- In the pane, `s` on a running managed pipeline whose current stage is Spec, Plan, Red tests, Implement or Review opens "Stop <Stage> and add input". During Test repair or Commit there is no input key, so only the plain stop remains. `x` is the plain stop, as the Stop button is today, including its second-press confirm.
- Dialog actions: `Enter` stops, saves the input and restarts that stage; `Ctrl+S` stops and saves but leaves the pipeline stopped; `Esc` closes the dialog and the agent keeps running. The field is prefilled with the stage's existing section; an empty line clears it (as `setManualInput` does).
- Order: stop first (`sdlc-mod.sh stop`), then save to `manual-inputs.md`, then start with `FROM=<stage key>`, so the agent never reads half-saved input. If the stop fails, nothing is saved or started and the pane's notice says so.
- Restart is from the beginning of that stage. For Implement the attempt counter starts again at 1 (`scripts/sdlc.sh:205`). Files the agent already changed stay in the worktree, and earlier stages keep their results.
- Spec, Plan and Red tests are restarted this way only while the red-tests commit does not exist, which holds whenever they are the running stage. After a stop later in the run, the stopped screen offers only: restart the stopped stage, or "Start over from Spec" (the existing restart with its confirm). `scripts/sdlc.sh:119-120` already refuses `FROM=` Spec, Plan or Red tests once that commit exists, and the pane does not offer what the script refuses.
- Stopped screen: the stopped stage's input is editable and has an `r` action (restart with the input shown); input of completed stages is read-only; later stages stay editable.
- Reuses the existing wrapper commands and `setManualInput`. No new `sdlc-mod.sh` command and no change to `scripts/sdlc.sh`.
- The input field is the existing single-line `Input`.

## Scope
- In: `.claude/plugins/sdlc-monitor/hooks/register.tsx` (stop-and-add-input dialog, stopped screen actions, read-only completed input), `.claude/plugins/sdlc-monitor/types/index.d.ts` if state atoms are added.
- Out of scope: the pre-stage gate (`add-stage-input-gate`), the full-screen layout (`add-monitor-fullscreen`), restarting an earlier stage after the red-tests commit exists, changing what the wrapper's stop does, multi-line input.

## Tests
- `.claude/plugins/sdlc-monitor/hooks/register.test.ts`: `s` opens the dialog only for the five input stages; `Enter` runs stop, save and launch in that order with the right `FROM`; `Ctrl+S` runs stop and save only; `Esc` runs nothing; a failed stop saves nothing; the stopped screen does not offer Spec, Plan or Red tests restart when the red-tests commit exists; completed stages are read-only.
- Integration tests: none, there is no database or API change.

## Docs
- None beyond the pane's own key hints (`CLAUDE.md` already points to the control pane).

## Open questions
- none
