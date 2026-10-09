# add-stage-input-gate

Type: feature
Priority: P2 (normal)
Source: user request in the triage conversation: "user input at each stage, only before the stage is initialized", with the design mockup "SDLC Monitor Full Screen" (screen 2, input before a stage starts).

## Problem
Manual input per stage already exists: `manual_input` in `scripts/sdlc.sh:72` appends the `## <stage>` section of `Docs/backlog/<slug>/manual-inputs.md` to the agent prompt, and the pane saves it with `setManualInput` (`.claude/plugins/sdlc-monitor/hooks/register.tsx:98`). But the pipeline never waits for it. The pane lets you type input at any time, and input saved after a stage's agent has started is silently ignored for that run. Nothing asks the developer before a stage begins, so in practice the input is added too late or not at all. Verified by reading `scripts/sdlc.sh` and `register.tsx`; nothing was run.

## Expected behaviour
When the gate is on, the pipeline stops before each agent stage and waits. The pane shows a screen for that stage where the developer types instructions or starts without any. The stage starts only after that choice, and its agent receives the input.

## Decisions
- The gate is opt-in. `INPUT_GATE=1` turns it on. `scripts/sdlc-mod.sh run <slug> --gate` sets it, and the pane always passes `--gate`. A plain `./scripts/sdlc.sh <slug>` (CLI, CI, tests) behaves exactly as today.
- Gate stages are the five that already take input: Spec, Plan, Red tests, Implement, Review (keys `spec`, `plan`, `red-tests`, `implement`, `review`). Test repair and Commit have no agent input and no gate.
- A gate is reached once per stage per run, before its first agent call. It does not repeat for Implement attempts, Spec question rounds or a Review rerun.
- At a gate whose key is not yet in `Docs/backlog/<slug>/logs/gates-passed` (one stage key per line), `scripts/sdlc.sh` writes `status.json` with `state` `waiting` and `stage` set to the stage name, prints `WAITING: input for <Stage>. Add input, then pass the gate.` and exits with code 5 (codes 1 and 2 are taken). No agent is started and nothing is committed.
- `scripts/sdlc-mod.sh gate-pass <slug> <stage-key> [--no-input]` appends the key to `gates-passed` (idempotent) and starts the run again with `FROM=<stage-key>` and `INPUT_GATE=1`. It does not touch `manual-inputs.md`; the pane saves the input first, through the existing `setManualInput`. An unknown key, a missing run record or a run that is not `waiting` exits 1 with a message.
- Existing resume rules still apply: `FROM=red-tests` is refused once the red-tests commit exists, which cannot happen at that gate because it comes before the commit.
- `sdlc-mod.sh restart` discards the worktree, so `gates-passed` is reset and the gates come back.
- Pane: `Run.state` gains `waiting` (glyph `⏸`, yellow, same as `paused`). The overview row reads `<Stage> · waiting for input`. Opening it shows the gate screen: the input field prefilled with the stage's current section, `Enter` saves the input (an empty line clears it) and passes the gate, `Ctrl+S` passes it without changing the input, `Esc` goes back and leaves the run waiting. Toast: `<slug> is waiting for input before <Stage>`.
- For a run that has the gate on, the input of a stage that has already started is shown read-only with the label "used". Stopping a running stage to add input is `add-stage-stop-with-input`. Runs without the gate keep today's inputs.
- The input field is the existing single-line `Input`; multi-line input is out of scope.

## Scope
- In: `scripts/sdlc.sh` (gate before each agent stage, `status.json` state, exit 5), `scripts/sdlc-mod.sh` (`run --gate`, `gate-pass`, usage text), `.claude/plugins/sdlc-monitor/hooks/register.tsx` and `.claude/plugins/sdlc-monitor/types/index.d.ts` (`waiting` state, gate screen, read-only used input), the header comments of both scripts, `CLAUDE.md` (the `sdlc-mod.sh` row).
- Out of scope: stopping a running stage and restarting it with new input (`add-stage-stop-with-input`), the full-screen layout (`add-monitor-fullscreen`), gates for Test repair and Commit, any change to the Spec questions flow (exit 2), multi-line input.

## Tests
- New `server/__tests__/scripts/sdlc-input-gate.test.js`, in the style of `sdlc-manual-input.test.js`: gate off never pauses; gate on exits 5 before each of the five stages with the right `status.json`; a key already in `gates-passed` is skipped; Implement attempts and Spec rounds do not gate again; no agent is started while waiting.
- `server/__tests__/scripts/sdlc-mod.test.js`: `run --gate` sets `INPUT_GATE=1`; `gate-pass` appends once, starts at the right `FROM`, and refuses an unknown key or a run that is not waiting.
- `.claude/plugins/sdlc-monitor/hooks/register.test.ts`: a `waiting` run shows the gate screen; `Enter` saves the input and calls `gate-pass`; `Ctrl+S` calls it without saving; `Esc` leaves the run waiting; started stages are read-only on a gated run.
- Integration tests: none, there is no database or API change.

## Docs
- `CLAUDE.md` (the `scripts/sdlc-mod.sh` row lists `gate-pass` and `--gate`) and the header comments in `scripts/sdlc.sh` and `scripts/sdlc-mod.sh`.

## Open questions
- none
