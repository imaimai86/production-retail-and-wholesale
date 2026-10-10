# Specification: add-config-pane

Sources: `brief.md`, `decisions.md` (Round 1 Q1 to Q6, all accepted), and the current `.claude/plugins/sdlc-monitor/hooks/register.tsx`, `register.test.ts`, `types/index.d.ts`, `scripts/sdlc-mod.sh` and `scripts/sdlc-models.cjs`. Where a decision changed or completed the brief, the decision is what this document states (section 13).

## 1. Summary

The `sdlc-monitor` plugin gets a second button above the prompt, `CONFIG`, right after `SDLC`. It opens a separate pane titled `CONFIG` that lists the providers and models of the user-level model registry and lets the user add a provider or models, test a model, remove a model and remove a provider. A `/sdlc-config` command opens the same pane.

The pane is a front end for `bash scripts/sdlc-mod.sh model …` only. It never reads or writes `models.json`, never calls `scripts/sdlc-models.cjs` directly, and never asks for, stores or shows a key value.

The `SDLC` pane, its button, its command and its state are unchanged. A user who never presses `CONFIG` and never types `/sdlc-config` sees one extra button and nothing else.

## 2. Terms

| Term | Meaning |
|---|---|
| Wrapper | `bash scripts/sdlc-mod.sh model <subcommand> …`, run from the repository root as the other pane actions run the wrapper. |
| CONFIG pane | The pane with id `config` and title `CONFIG`. |
| SDLC pane | The existing pane with id `sdlc`. |
| List result | The parsed stdout of the last `model list --json` call that exited 0: `{ providers: { <name>: { endpoint, api_key_env, models, effort, key_set } } }`. |
| Existing provider | A provider name that is a key of the list result. With no list result (never loaded, or the last load failed) no provider is existing. |
| Stored value | The text the pane holds for one form field after Enter was pressed in it (section 6.2). |
| Message line | For a wrapper call that exits non-zero: the first non-empty line of stderr, or, when stderr has none, the first non-empty line of stdout. |

## 3. Entry points

### 3.1 `CONFIG` button
- Rendered by the existing `AbovePrompt` handler, inside the same row as `SDLC`: directly after the `SDLC` button and before the status text.
- Key `config-open`, label `CONFIG`, no variant (the `SDLC` button stays the only `primary` one).
- Pressing it opens the pane through `ui.open` with id `config` and title `CONFIG`.
- When `hasSurvey` is set the handler passes the event on as it does today, so neither `SDLC` nor `CONFIG` is rendered.
- The `SDLC` button and the status text keep their current key, label, variant, action and text.

### 3.2 `/sdlc-config` command
- Registered at session start, next to `sdlc-monitor`, with a one-line description saying that it opens the CONFIG pane for providers and models (exact wording is free).
- Running it opens the same pane (id `config`, title `CONFIG`) and returns a short confirmation text (exact wording is free).
- It takes no arguments; any arguments are ignored.

### 3.3 Never opened automatically
Nothing opens the CONFIG pane at `session.start` or on any timer or event. Only the button and the command open it. The pane makes no wrapper call until it is opened for the first time.

### 3.4 Closing
`q` and `Esc` close the pane as they close the SDLC pane. This is the host's pane behaviour; the plugin adds no key handling for it.

### 3.5 On every open
Each time the pane is opened, by either entry point:
1. the list is reloaded (section 4.1);
2. both pending remove confirmations are cleared (section 5.3).

The stored form values are not cleared on open (section 6.2).

## 4. Provider list

### 4.1 Loading
- The list comes from `model list --json` through the wrapper.
- It is reloaded on every open (3.5) and after every add, remove-model, remove and test call has finished, whatever its exit code.
- Exit 0 with parseable JSON replaces the list result.
- A non-zero exit (for example an invalid registry file: `<path>: not valid JSON`, `<path>: provider '<n>': <rule>`) or output that is not the expected JSON leaves no list result, and the pane shows the message line in place of the list (4.4).
- The list is not polled on a timer.

### 4.2 Provider rows
Providers are shown in the order of the list result. Each provider shows, in this order:
1. its name;
2. its endpoint;
3. its key variable name (`api_key_env`);
4. `key set` when `key_set` is true, `key NOT set` otherwise;
5. the word `effort` when `effort` is true, nothing when it is false (shown after its models);
6. a `Remove` button for the provider (section 5.3).

"Key set" is what the wrapper reports: the variable is set and not empty in the environment of the Claude process that runs the command. The pane does not look at the environment or `.env` itself.

### 4.3 Model rows
Under each provider, one row per model in stored order, with:
- the model name;
- a `Test` button (section 5.1), shown for every model, also when the provider's key is not set;
- a `Remove` button for the model (section 5.2).

There is no per-provider "Add model" button: models are added with the form.

### 4.4 Empty and broken states
| State | What the list area shows | Form |
|---|---|---|
| List result with no providers | `No custom providers` | shown and usable |
| Load failed | the message line of the failed `model list --json` call, in place of the list | shown; an add is sent as for a new provider (6.4) and its failure is reported as in 7 |
| Not loaded yet | nothing, or a neutral placeholder | shown |

### 4.5 Layout
Top to bottom: a `CONFIG` heading, the provider list (or its empty or error line), then the form. No back button and no sub-screens: the pane has one screen.

## 5. Row actions

Every action runs the wrapper with its values as separate arguments (no shell string is built from provider, model or form text).

### 5.1 `Test` (per model)
- Runs `model test <provider>/<model>`.
- Result toast, always in the form `<provider>/<model>: <line>`:
  - exit 0: `<line>` is `ok` (for example `acme/fast: ok`);
  - non-zero exit: `<line>` is the message line (for example `acme/fast: HTTP 401: …`, `acme/fast: timeout after 10s`, `acme/fast: connection failed: ECONNREFUSED`, `acme/fast: key variable ACME_KEY is not set`).
- No confirmation, no progress indicator while the probe runs (it can take up to 10 seconds).
- The list is reloaded afterwards.

### 5.2 `Remove` (per model)
- First press: that model's button label becomes `Confirm remove` and a `Keep it` button appears next to it. Nothing is run.
- `Keep it`: clears the pending confirmation. Nothing is run.
- Second press (on `Confirm remove`): runs `model remove-model <provider> <model>`, then clears the pending confirmation and reloads the list.
  - exit 0: toast with the stdout line (`removed <provider>/<model>`);
  - non-zero exit: toast with the message line (for example `provider 'acme' would have no model left: use remove acme`, `model 'x' is not listed`).
- One model confirmation is pending at a time: pressing `Remove` on another model moves the pending confirmation there.

### 5.3 `Remove` (per provider)
- Same two-press pattern, labels `Remove` → `Confirm remove`, with a `Keep it` button.
- Second press runs `model remove <provider>`, then clears the pending confirmation and reloads the list.
  - exit 0: toast with the stdout line (`removed <provider>`);
  - non-zero exit: toast with the message line (for example `unknown provider 'acme'`).
- One provider confirmation is pending at a time: pressing `Remove` on another provider moves it there.
- The provider confirmation and the model confirmation are separate states: one of each can be pending at the same moment. Both are cleared on every open (3.5).

## 6. Form

### 6.1 Fields
Four single-line inputs below the list, in this order, each with a label or placeholder that names it:

| # | Field | Label / placeholder |
|---|---|---|
| 1 | Provider name | provider name |
| 2 | Endpoint | endpoint |
| 3 | Key variable | `API key variable NAME (not the key)` (this wording is required) |
| 4 | Models | models (comma list) |

No input is given a value to display (`value` / `defaultValue` are not used). There is no field for `effort` and no field for a key value.

### 6.2 Stored values
- Pressing Enter in any field stores that field's trimmed text as its stored value, replacing the previous one. Enter on an empty field stores the empty string.
- A non-empty stored value is shown next to its field as `→ <value>`. An empty one shows nothing.
- A field in which Enter was never pressed counts as empty.
- The four stored values live in the pane's own state. They are cleared only by a successful add (6.5). They survive a rejected add, the list reloads, the row actions, and closing and reopening the pane.

### 6.3 Submitting
Pressing Enter in field 4 (models) stores its value and then runs one `model add` call built from the four stored values (6.4). Enter in fields 1 to 3 only stores. There is no separate submit button.

### 6.4 The `model add` call
Argument order: `model add <provider> --endpoint <endpoint> --key-env <variable> --models <models>`, followed by `--effort` only in the case below.

**New provider** (the stored provider name is not an existing provider, which includes an empty name and the case of no list result): the four stored values are sent exactly as stored, empty ones included, without `--effort`. The pane validates nothing; the backend's validation message is what the user sees.

**Existing provider** (the stored provider name is a key of the list result):
- `--endpoint`: the stored endpoint when it is not empty, otherwise the provider's endpoint from the list result.
- `--key-env`: the stored key variable when it is not empty, otherwise the provider's `api_key_env` from the list result.
- `--models`: the provider's models from the list result in their order, followed by the typed models that are not already in that list, in typed order, each once, joined with commas. Typed models are the stored models value split at commas, each entry trimmed. A typed model that is already stored, or that repeats an earlier typed one, is dropped silently. An empty stored models value sends the provider's models unchanged. Entries are not checked otherwise (an empty or malformed entry is sent and rejected by the backend).
- `--effort`: appended when the list result reports `effort: true` for the provider, omitted otherwise. This keeps the stored flag, which `model add` would otherwise reset to false.

Examples (list result: `acme` with endpoint `https://a.example`, key variable `ACME_KEY`, models `fast,big`, effort false):

| Stored values (name / endpoint / variable / models) | Call |
|---|---|
| `acme` / empty / empty / `new` | `model add acme --endpoint https://a.example --key-env ACME_KEY --models fast,big,new` |
| `acme` / `https://b.example` / empty / `big, new, new` | `model add acme --endpoint https://b.example --key-env ACME_KEY --models fast,big,new` |
| `acme` / empty / `OTHER_KEY` / empty | `model add acme --endpoint https://a.example --key-env OTHER_KEY --models fast,big` |
| `beta` / `https://c.example` / `BETA_KEY` / `m1,m2` | `model add beta --endpoint https://c.example --key-env BETA_KEY --models m1,m2` |
| `beta` / empty / `BETA_KEY` / `m1` | `model add beta --endpoint  --key-env BETA_KEY --models m1` (empty endpoint argument; the backend rejects it) |

With effort true for `acme`, the first three calls end with `--effort`.

### 6.5 Result
- Exit 0: the four stored values are cleared, a toast shows the stdout line (`added <provider> (<n> models)`), and the list is reloaded.
- Non-zero exit: a toast shows the message line, the four stored values stay as they are (still shown next to their fields), and the list is reloaded.

## 7. Errors

| Case | Behaviour |
|---|---|
| `model add`, `remove`, `remove-model` exits non-zero | Toast with the message line. For add, stored values are kept. |
| `model test` exits non-zero | Toast `<provider>/<model>: <message line>`. |
| `model list --json` exits non-zero or prints something that is not the expected JSON | The message line is shown in place of the list; no toast. The form stays on screen. |
| Non-zero exit with no non-empty line on stderr or stdout | The message is `failed (exit <code>)`. |
| The wrapper call itself cannot be started (the process call throws) | Treated as a non-zero exit with the thrown error's first line as the message line. |
| No providers | `No custom providers`; the form stays usable. |

The pane never crashes the render: a failed call always ends in one of the rows above.

## 8. State and isolation

- The CONFIG pane has its own render handler, matched on component `Pane` and request id `config`.
- Its state lives in its own atoms of the `sdlc-monitor` plugin, all with keys prefixed `config`: the list result or its error line, the four stored form values, the pending provider confirmation and the pending model confirmation.
- It shares no state with the SDLC pane: it does not read or write `view`, `notice`, `draft`, `confirmStop`, `confirmDiscard`, `selected`, `queue`, `launching`, `snapshot` or `agents`.
- The SDLC pane's render handler, the `/sdlc-monitor` command, the 2-second refresh timer, the status line and the existing toasts are not changed in behaviour.
- `types/index.d.ts` is extended only as far as the new atoms need it (their entries in the plugin's state declaration and a type for a listed provider).

## 9. Security and privacy

- The pane handles a key variable's NAME only. No input asks for a key value and no text on screen, toast or state holds one.
- The pane does not read the environment, `.env` or `models.json`.
- Form text reaches the wrapper only as separate arguments, never through a shell command string.

## 10. Documentation

- `README.md`: next to the "Custom models and providers" paragraph and the control-pane section, describe the `CONFIG` button, the `/sdlc-config` command and what the pane does: lists providers with endpoint, key variable and key state; `Test` per model; `Remove` per model and per provider (press twice); the four-field form, that an existing provider name adds models and keeps empty fields, and that the third field is a variable name, never a key.
- `CLAUDE.md`: mention the `CONFIG` pane (button and `/sdlc-config`) in the Commands row that names the monitor control pane.

## 11. Scope

In: `.claude/plugins/sdlc-monitor/hooks/register.tsx`, `.claude/plugins/sdlc-monitor/hooks/register.test.ts`, `.claude/plugins/sdlc-monitor/types/index.d.ts` (only if types are needed), `README.md`, `CLAUDE.md`.

Out: the registry, its file and the `model` commands (`scripts/sdlc-models.cjs`, `scripts/sdlc-mod.sh`); any other setting in the CONFIG pane; an `effort` field; per-stage model choice (`add-stage-model-switch`); the SDLC pane layout (`add-monitor-fullscreen`); storing key values anywhere; database, API and integration tests (none are affected).

## 12. Acceptance criteria

All in `.claude/plugins/sdlc-monitor/hooks/register.test.ts`, with the wrapper calls mocked and captured.

Entry points
1. The `AbovePrompt` render contains `CONFIG` directly after `SDLC` and before the status text; pressing it calls `ui.open` with id `config` and title `CONFIG`.
2. With `hasSurvey` set, neither `SDLC` nor `CONFIG` is rendered.
3. `/sdlc-config` calls `ui.open` with id `config` and returns a text.
4. After `session.start` alone, `ui.open` was not called and no `model` wrapper call was made.

List
5. With two providers, one with `key_set` true and one false, the pane shows both names, endpoints and key variable names, `key set` for the first and `key NOT set` for the second, and every model name.
6. A provider with `effort: true` shows `effort`; one with `effort: false` does not.
7. An empty registry shows `No custom providers` and the four inputs.
8. A failing `model list --json` (invalid registry) shows its message line in place of the list, and the four inputs are still rendered.
9. Opening the pane a second time makes a new `model list --json` call.
10. No call reads `models.json` or runs `scripts/sdlc-models.cjs` directly: every registry call is `bash scripts/sdlc-mod.sh model …`.

Form
11. Enter in fields 1 to 3 makes no `model add` call and shows `→ <value>` for each; Enter in field 4 makes exactly one `model add <provider> --endpoint <url> --key-env <VAR> --models a,b` call with the four values in those argument positions.
12. For an existing provider, empty endpoint and key-variable fields send the stored ones, and `--models` is the stored list followed by the new typed models, without duplicates (the first two examples of 6.4).
13. For an existing provider with `effort: true` the call ends with `--effort`; for a new provider and for one with `effort: false` it does not.
14. A successful add shows the `added …` toast, clears the four stored values and reloads the list.
15. A rejected add shows the message line as a toast and the four `→ <value>` texts are still shown.

Row actions
16. `Test` calls `model test <provider>/<model>`; exit 0 gives the toast `<provider>/<model>: ok`.
17. A failed probe (exit 1, line on stdout, empty stderr) gives `<provider>/<model>: HTTP 401: …`; a missing key (line on stderr) gives `<provider>/<model>: key variable <VAR> is not set`.
18. `Test` is shown for a model whose provider has `key NOT set`.
19. Provider `Remove`: the first press makes no wrapper call and shows `Confirm remove` and `Keep it`; `Keep it` restores `Remove` with no call; the second press calls `model remove <provider>`, toasts `removed <provider>` and reloads the list.
20. Pressing `Remove` on a second provider while one is pending leaves only the second pending.
21. Model `Remove`: same two presses, calling `model remove-model <provider> <model>`; a refusal for the last model shows its message line as a toast.
22. A pending confirmation is gone after the pane is closed and opened again.

Unchanged
23. The SDLC pane render (overview and pipeline view) and the `/sdlc-monitor` command behave as before; the existing tests pass without edits to their expectations.
24. `npm test` from the repo root passes.

Docs
25. `README.md` and `CLAUDE.md` contain the texts of section 10.

## 13. Where the decisions changed or completed the brief

| Brief | Decision | Stated in |
|---|---|---|
| "Enter on the last one calls `model add`", "keeps what was typed" | Enter stores each field; the stored values are shown as `→ <value>`; nothing is put back into an input (Q1) | 6.2, 6.3, 6.5 |
| "An existing provider name merges the models" | The pane builds the merged list itself, stored first, new ones appended, duplicates dropped; no pane-side validation (Q2) | 6.4 |
| Screen lists name, endpoint, key variable, key state, models | `effort` is shown when true and kept on add with `--effort` (Q3) | 4.2, 6.4 |
| Per-provider `Remove` and per-model `Test` only | A per-model `Remove` is added (Q4) | 4.3, 5.2 |
| "A non-zero exit shows the first stderr line" | The message line falls back to stdout; Test toast is `<provider>/<model>: <line>`; `Test` shown without a key; no progress indicator (Q5) | 2, 5.1, 7 |
| "Second press confirms, as Stop does" | `Confirm remove` and `Keep it`; one pending per kind; cleared on open (Q6) | 5.2, 5.3, 3.5 |

## 14. Details taken from existing behaviour

These are not in the brief or the decisions word for word; they follow from the code and are listed so they can be vetoed.

- The `/sdlc-config` command must be registered at session start to exist (as `sdlc-monitor` is); registering is not "opening" (3.2, 3.3).
- The `CONFIG` button has no variant, because the brief's button line gives none (3.1).
- A pending confirmation is cleared once its command has run, whatever the exit code, as Stop clears `confirmStop` after stopping (5.2, 5.3).
- The list reloads after an action whether it succeeded or not, since the brief says "after each add, remove and test" (4.1).
- With an invalid registry the form is still rendered, because the brief replaces only the list with the error line; an add then fails in the backend with the same error (4.4).
- The stored form values are cleared only by a successful add, because Q1 names no other moment (6.2).
- The `failed (exit <code>)` text for a non-zero exit with no output, and the handling of a call that cannot be started, are fallbacks so a toast is never empty (7).
