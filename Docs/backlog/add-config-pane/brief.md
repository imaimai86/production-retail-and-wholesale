# add-config-pane

Type: feature
Priority: P2 (normal)
Source: user request in the triage conversation: "Add a [ CONFIG ] button near the [ SDLC ] button to open a new pane that support provider and model registry management". Split out of `add-model-registry`, whose brief had the screen inside the SDLC pane.

## Problem
`add-model-registry` stores custom providers and models in a user-level `models.json` and manages them with `scripts/sdlc-mod.sh model list|add|add-model|remove-model|remove|test`. Nothing in the monitor plugin lets a user do this from the UI. The only entry point above the prompt is the `SDLC` button (`.claude/plugins/sdlc-monitor/hooks/register.tsx:533`, `AbovePrompt` render at `:524`), which opens the pane with id `sdlc` (`PANE`, `:6`). Verified by reading `register.tsx` and the `sdlc/add-model-registry` branch (the backend exists there, the pane screen does not); nothing was run.

Depends on `add-model-registry`: run this item after that branch is merged into `main`.

## Expected behaviour
A `CONFIG` button sits next to the `SDLC` button above the prompt. Pressing it opens a separate pane titled `CONFIG` that lists the registered providers and models and lets the user add, test and remove them. The `SDLC` pane is unchanged.

## Decisions
- Button: `<Button key="config-open" label="CONFIG" onPress={() => $.ui.open({ id: CONFIG_PANE, title: 'CONFIG' })} />` placed right after the `SDLC` button in the `AbovePrompt` render, inside the same `Box`, before the status `Text`. `CONFIG_PANE = 'config'`. Same `hasSurvey` rule as `SDLC`.
- The pane never opens on its own (nothing at `session.start`). A `/sdlc-config` command (`on('command.run', { command: 'sdlc-config' })`) also opens it. `q` and `Esc` close it, as in the `sdlc` pane.
- Own `ui.render` handler for `{ component: 'Pane', requestId: 'config' }`; own atoms (prefix `config`), no shared `view` state with the `sdlc` pane. The `sdlc` handler is not edited except to leave it as is.
- The pane calls only `bash scripts/sdlc-mod.sh model …` (as the other pane actions call the wrapper), never `models.json` directly and never `scripts/sdlc-models.cjs`.
- Screen: each provider shows name, endpoint, key variable, `key set` or `key NOT set` (from `model list --json`), and its models. Per provider a `Remove` button (second press confirms, as Stop does). Per model a `Test` button whose result (`ok`, or the status and message) is a toast. Per provider an `Add model` shortcut is not needed: adding a model is the form below.
- Form: four single-line `Input`s in order: provider name, endpoint, "API key variable NAME (not the key)", models (comma list). `Enter` on the last one calls `model add <provider> --endpoint <url> --key-env <VAR> --models a,b`. An existing provider name merges the models; empty fields keep the stored value (the screen fills them from the list before calling `add`). The key field is labeled as a variable name; the pane never asks for or shows a key value.
- Errors: a non-zero exit shows the first stderr line as a toast and keeps what was typed. A registry file that is invalid shows the error line in place of the list. With no providers the list says "No custom providers" and the form stays usable.
- The list refreshes after each add, remove and test, and every time the pane is opened.
- Out of the box nothing changes for users who never press `CONFIG`.

## Scope
- In: `.claude/plugins/sdlc-monitor/hooks/register.tsx`, `.claude/plugins/sdlc-monitor/types/index.d.ts` (only if types are needed), `README.md`, `CLAUDE.md`.
- Out of scope: the registry, its file and the `model` commands (`add-model-registry`); other settings in the CONFIG pane; per-stage model choice (`add-stage-model-switch`); the SDLC pane layout (`add-monitor-fullscreen`); storing key values anywhere.

## Tests
- `.claude/plugins/sdlc-monitor/hooks/register.test.ts`: `CONFIG` renders right after `SDLC` and `onPress` calls `ui.open` with id `config`; it is hidden when `hasSurvey` is set, like `SDLC`; `/sdlc-config` opens the pane; nothing opens at `session.start`; the CONFIG pane lists providers with key set and not set; the form calls `model add` with the four values in the right arguments; `Remove` needs a second press; `Test` shows an `ok` toast and a failure toast; a rejected add shows the message and keeps the typed values; an invalid registry shows the error line; the `sdlc` pane render is unchanged.
- Integration tests: none, there is no database or API change.

## Docs
- `README.md`: the `CONFIG` button, the `/sdlc-config` command and what the pane does, next to the "Custom models and providers" paragraph.
- `CLAUDE.md`: mention the `CONFIG` pane in the monitor control-pane row.

## Open questions
- none
