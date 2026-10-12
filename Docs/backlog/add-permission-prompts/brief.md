# add-permission-prompts

Type: feature
Priority: P2 (normal)
Source: user question: when an SDLC stage fails on a permission error, can it restart with the permission after asking the user?

## Problem
The stage agents run headless (`claude -p --permission-mode acceptEdits --allowedTools <fixed list>`). An action outside that list is refused and nobody is asked. The stage then fails or ships incomplete work (PR #78 shipped docs only because edits under `.claude/plugins/` were refused). The refusal is only visible in the stage log.

## Expected behaviour
- A refused action pauses the run (exit 2, state paused) and is shown in the pane with Allow this run, Allow always and Deny buttons. When none is left, the run resumes at the refused stage.
- A path under `.claude/` cannot be opened by an allow rule (verified with `claude -p`: the "sensitive file" refusal stays). Allowing it runs that stage with `--permission-mode bypassPermissions`, and the pane says so. It is never saved as an "always" rule.

## Decisions
- Agents run with `--output-format json`; `permission_denials` of the result lists the refused actions. The result text still goes to the usual `<name>.log`.
- Rules are narrow: `Edit(./path)`, `Write(./path)`, `Bash(<command word> <subcommand>:*)`, else the tool name.
- State: `Docs/backlog/<slug>/logs/permissions.json` (pending, allow, bypass, denied; gitignored with logs). Saved rules: `.claude/sdlc-permissions.json` in the main working tree.
- A denied ask is recorded and does not pause the run again; the stage reruns once without it.
- `bash scripts/sdlc-mod.sh permit <slug> allow|always|deny [n|all]` decides; it prints how many asks are left.

## Scope
- In: `scripts/sdlc-permissions.cjs`, `scripts/sdlc.sh` (agent), `scripts/sdlc-mod.sh` (permit), the sdlc-monitor pane.
- Out of scope: the test-audit agent (its own read-only tool list), asking mid-stage (a stage restarts, it does not continue).

## Tests
- `server/__tests__/scripts/sdlc-permissions.test.js`, `server/__tests__/scripts/sdlc-agent-permissions.test.js`, and the pane tests in `.claude/plugins/sdlc-monitor/hooks/register.test.ts`.

## Docs
- `README.md`, `CLAUDE.md` (command table).

## Open questions
- none
