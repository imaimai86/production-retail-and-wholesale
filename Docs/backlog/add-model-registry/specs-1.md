# Specification: add-model-registry

Sources: `brief.md`, `decisions.md` (Round 1 Q1 to Q8, Round 2 Q1 and Q2), and the current `scripts/sdlc.sh`, `scripts/sdlc-mod.sh` and `.claude/plugins/sdlc-monitor/hooks/register.tsx`. Where a decision changed the brief, the decision is what this document states (see section 12).

## 1. Summary

A user-level registry file, `models.json`, holds the custom providers and their model names for the SDLC pipeline. A new helper, `scripts/sdlc-models.cjs`, is the only code that reads or writes it. `scripts/sdlc-mod.sh model …` wraps the helper, the `/sdlc-monitor` pane calls only the wrapper, and `scripts/sdlc.sh` asks the helper each time it resolves a `<provider>/<model>`, so a change is seen by the next agent that starts, with no restart.

The registry never holds a key value. A provider names an environment variable, and the key is read from the environment of the process that runs the command. The `SDLC_PROVIDER*` variables (shell or `.env`) keep working as a fallback.

With no registry file and no `SDLC_PROVIDER*` variables, everything behaves as it does today.

## 2. Terms

| Term | Meaning |
|---|---|
| Registry | The `models.json` file at the resolved path (section 3). |
| Helper | `node scripts/sdlc-models.cjs <command> …`. |
| Wrapper | `scripts/sdlc-mod.sh model <subcommand> …`. |
| Registry provider | A provider defined in the registry. |
| `.env` provider | A provider listed in `SDLC_PROVIDERS` with its `SDLC_PROVIDER_<NAME>_*` variables, as today. |
| Key variable | The environment variable named by a registry provider's `api_key_env`. |
| Key is set | The key variable is set and not empty in the environment of the process that runs the command. `.env` is not consulted. |

## 3. Registry file location

One function in the helper resolves the path. It takes `{ env, platform, home }` so every branch can be tested without touching the real environment. First match wins:

1. `env.SDLC_MODELS_FILE`, used as given.
2. `<env.XDG_CONFIG_HOME>/sdlc/models.json`, when `XDG_CONFIG_HOME` is set and `platform` is not `win32`.
3. `<env.APPDATA>\sdlc\models.json`, when `platform` is `win32` and `APPDATA` is set.
4. `<home>/.config/sdlc/models.json` otherwise. This includes `win32` without `APPDATA`, and `win32` with only `XDG_CONFIG_HOME` set.

A variable that is set to an empty string counts as not set.

The folder is created on the first write, not before. Reading commands never create the folder or the file.

## 4. Registry format and validity

### 4.1 Shape

```
{ "providers": { "<name>": { "endpoint": "<url>", "api_key_env": "<VAR>", "models": ["<model>", …], "effort": false } } }
```

- The file is a JSON object with a `providers` object.
- Each provider is an object with a string `endpoint`, a string `api_key_env`, an array-of-strings `models` and an optional boolean `effort`.
- `effort` absent means `false`. `effort: true` means the same as `SDLC_PROVIDER_<NAME>_EFFORT=yes`: the pipeline passes `--effort` to agents on that provider.
- Unknown keys, at the top level or inside a provider, are tolerated and are kept as they are when the file is rewritten.
- No field holds a key value. `api_key_env` is the NAME of a variable.

### 4.2 Validation rules

| # | Field | Rule |
|---|---|---|
| V1 | provider name | matches `^[a-z0-9][a-z0-9-]*$` |
| V2 | provider name | is not `anthropic` |
| V3 | `endpoint` | an absolute URL with scheme `https`; or scheme `http` only when the host is `localhost`, `127.0.0.1` or `::1` (written `[::1]` in a URL). Any other scheme, a relative URL, or `http` to any other host is rejected. |
| V4 | `api_key_env` | matches `^[A-Z_][A-Z0-9_]*$` |
| V5 | each model | matches `^[A-Za-z0-9._:/-]+$` |
| V6 | `models` | at least 1 entry |
| V7 | `models` | at most 50 entries |
| V8 | `models` | no duplicates |

The reason for V3: a key must not travel in clear text to another host.

### 4.3 When the rules apply

- **On write.** Every writing command validates its result before writing. A failure exits 1 with one stderr line and writes nothing: no file, no folder, no `.tmp`.
- **On read.** Every command except `path` checks the whole file against the shape (4.1) and rules V1 to V8. A file that is not valid JSON, has the wrong shape or breaks a rule makes the command exit 1. The stderr message names the file path and, for a shape or rule failure, the first offending provider and rule. The file is left untouched: never overwritten, never repaired, never ignored silently.
- **A missing file** is an empty registry for every reading command. It is not an error.

### 4.4 Atomic writes

A write goes to `models.json.tmp` in the same folder and is then renamed to `models.json`. After any command, successful or not, no `models.json.tmp` remains.

## 5. Helper commands

General rules for `node scripts/sdlc-models.cjs <command> …`:

- Success: exit 0, one line or JSON on stdout.
- Failure: exit 1, one line on stderr, nothing written.
- An unknown command, a missing argument or an unknown option is a failure (exit 1).
- A key value never appears in any output, on stdout or stderr, of any command.
- Only `test` uses the network, and only when it is called.
- The helper never opens `.env`.

### 5.1 `path`

Prints the resolved file path (section 3). It works whether the file exists, is missing or is broken. Exit 0.

### 5.2 `list [--json]`

Lists registry providers only. `.env` providers are not included.

- `list --json` prints one line: the file's shape plus `key_set` per provider, with `effort` always written as a boolean:
  `{"providers":{"<name>":{"endpoint":"…","api_key_env":"…","models":[…],"effort":false,"key_set":true}}}`
- With no file or no provider it prints `{"providers":{}}` and exits 0.
- `list` without `--json` prints one line per provider:
  `<name>  <endpoint>  <VAR> (key set|key NOT set)  <models comma-joined>`, with `  effort` appended when `effort` is true.
- With no provider it prints the single line `no providers (<path>)`.
- `key_set` is true only when the key variable is set and not empty in the process environment. A value that exists only in `.env` gives `key_set` false.

### 5.3 `add <provider> --endpoint <url> --key-env <VAR> --models a,b [--effort]`

- `--endpoint`, `--key-env` and `--models` are always required, for a new and for an existing provider. A missing one exits 1.
- Creates the provider, or replaces every field of an existing one: `endpoint`, `api_key_env`, `models` (the list is replaced, not merged) and `effort` (true with `--effort`, false without it, even if it was true before).
- `--models` is a comma-separated list. Whitespace around an entry is ignored. Rules V1 to V8 apply.
- Other providers, and unknown keys, are kept.
- Prints `added <provider> (<n> models)`.

### 5.4 `add-model <provider> <model>`

- Appends the model to the provider's list.
- Fails when: the provider is unknown; the model is already listed (V8); the model breaks V5; the provider already has 50 models (V7).
- Prints `added <provider>/<model>`.

### 5.5 `remove-model <provider> <model>`

- Removes the model from the provider's list.
- Fails when: the provider is unknown; the provider does not list the model; it is the provider's last model. The last case says the provider would have no model left and to use `remove <provider>` instead.
- Prints `removed <provider>/<model>`.

### 5.6 `remove <provider>`

- Removes the provider with all its models.
- Fails when the provider is unknown.
- Prints `removed <provider>`.

### 5.7 `get <provider>`

For `scripts/sdlc.sh`. Prints exactly four lines, in this order:

```
endpoint=<url>
api_key_env=<VAR>
models=<a,b>
effort=true|false
```

Exit 1 when the provider is unknown (including when there is no file). `get` prints the variable name, never its value.

### 5.8 `test <provider>/<model>`

Registry providers only; a `.env` provider cannot be tested.

Before any request, each of these exits 1 with a stderr line naming the item, and no request is sent:
- unknown provider;
- a model the provider does not list;
- key not set (the line names the variable).

Otherwise it sends exactly one request:
- `POST <endpoint>/v1/messages`; trailing slashes of the stored endpoint are dropped before `/v1/messages` is appended (the stored value is not changed);
- headers `Authorization: Bearer <value of the key variable>` and `anthropic-version: 2023-06-01`;
- a body for the given model with a one-word prompt and `max_tokens` 1;
- a 10 second timeout.

| Outcome | Output | Exit |
|---|---|---|
| any 2xx status | `ok` | 0 |
| any other status | `HTTP <status>: <first 200 characters of the response body>` | 1 |
| no answer within 10 s | `timeout after 10s` | 1 |
| connection error | `connection failed: <error code>` | 1 |

### 5.9 Error summary

All exit 1, one stderr line, nothing written:

| Case | Message names |
|---|---|
| any of V1 to V8 broken by `add` or `add-model` | the field and the rule |
| `add` without `--endpoint`, `--key-env` or `--models` | the missing option |
| `add-model`, `remove-model`, `remove`, `get`, `test` on an unknown provider | the provider |
| `add-model` of a model already listed | the model |
| `remove-model` of a model not listed; `test` of a model not listed | the model |
| `remove-model` of the last model | the provider, and `remove <provider>` |
| `test` with the key not set | the variable |
| broken registry file (any command except `path`) | the file path, and the first offending provider and rule when it parses |

## 6. Wrapper: `scripts/sdlc-mod.sh model …`

- `scripts/sdlc-mod.sh model list|add|add-model|remove-model|remove|test …` runs the helper with the same arguments, passes stdout and stderr through, and exits with the helper's exit code.
- `path` and `get` are not wrapper subcommands. `model` with no subcommand, or with any other subcommand, prints the usage text and exits 2, as the wrapper does for every bad invocation today.
- The usage text lists `model`.
- The existing commands (`run`, `stop`, `discard`, `restart`, `status`, `changes`, `watch`) are unchanged.

## 7. Pipeline: `scripts/sdlc.sh`

### 7.1 Resolution

`resolve_provider <model> <stage>` keeps its contract (`PV_ACTIVE`, `PV_MODEL`, `PV_ENDPOINT`, `PV_KEY`, `PV_EFFORT_FLAG`). For a model containing `/`:

1. It asks the helper for the provider (`get`). This happens on every call, so each agent start sees the current file.
2. **Provider in the registry.** Endpoint, models and effort come from the registry. The key is the value of the key variable in the pipeline's environment. `PV_EFFORT_FLAG` is 1 when `effort` is true, otherwise 0.
3. **Provider not in the registry.** It falls back to the `SDLC_PROVIDER*` variables exactly as today, including the provider's own `_API_KEY` and `_EFFORT`.
4. **Provider in both.** The registry wins as a whole; no field is taken from the `SDLC_PROVIDER*` variables.

The set of known providers is the registry's plus `SDLC_PROVIDERS`.

A model without `/` is an Anthropic model and is untouched, as today.

### 7.2 Errors (exit 1, message on stderr)

| Case | Behaviour |
|---|---|
| Provider in neither the registry nor `SDLC_PROVIDERS` | as today; the message still says the provider is not listed in `SDLC_PROVIDERS` |
| Registry provider, model not in its list | the message names the model and the allowed list |
| Registry provider, key not set | the message names the variable. This holds even when the same provider also has `SDLC_PROVIDER_<NAME>_API_KEY`, and even when the variable is written in `.env` only. |
| Broken registry file | exit 1 at startup with the file path, whatever models the stages use. After startup, a file that became broken fails the next resolution of a `<provider>/<model>`. |
| `.env` provider errors (missing endpoint or key, model not in `_MODELS`) | unchanged |

### 7.3 Unchanged

- `load_env_models` is unchanged: it still copies only the `SDLC_PROVIDER*` keys of the repo-root `.env`, shell values win, and nothing else of `.env` is read. It does not read key variables of registry providers.
- `apply_provider_env` is unchanged: the key is exported only inside the subshell that starts the agent, `ANTHROPIC_API_KEY` is emptied there, and the key never reaches the rest of the script or a command line.
- Stage defaults, `MODEL_<STAGE>`, `EFFORT_<STAGE>`, `SDLC_MODEL`, `SDLC_EFFORT`, the effort check, `status.json` and its `models` field.

## 8. Pane: `/sdlc-monitor` Models screen

The pane calls only the wrapper.

### 8.1 Navigation

- The overview has a `Models` button that opens the Models screen.
- The Models screen has a `← All pipelines` button that returns to the overview, like the other screens.

### 8.2 Provider list

Loaded with `model list --json`. For each provider the screen shows: name, endpoint, key variable, `key set` or `key NOT set`, and its models.

- Per provider, a `Remove` button. The first press asks for confirmation; the second press calls `model remove <provider>`. While the confirmation is pending a `Keep it` button cancels it, as Discard does.
- Per model, a `Test` button. It calls `model test <provider>/<model>` and shows the result as a toast: `ok`, or the command's failure line.
- The list is reloaded after a `Remove` (second press) and after an add.
- A broken registry file shows the command's stderr line as a toast.

### 8.3 "Add model" form

Four single-line inputs, in this order:

1. provider name
2. endpoint
3. "API key variable NAME (not the key)"
4. models (comma list)

Behaviour:

- `Enter` on any of the first three saves that field as a draft, shown next to it as `→ value`, like the answer fields of a paused run.
- `Enter` on the fourth saves it and submits with the drafts.
- **New provider** (the name is not in the loaded list): all four fields are required. If one is empty, a toast says so and no command is called.
- **Existing provider** (the name is in the loaded list): the pane merges, the helper does not. Each empty field takes the stored value. Models become the stored list followed by the typed ones that are not already in it. `--effort` is passed when the stored `effort` is true.
- In both cases the pane then calls `model add <provider> --endpoint … --key-env … --models …` with the four complete values.
- **Success:** a toast with the command's output line, the drafts are cleared and the list is reloaded.
- **Rejection:** a toast with the command's stderr line, and the drafts stay as typed.

### 8.4 Types

`types/index.d.ts` gains what the Models screen needs (provider entries with `key_set`, the form drafts, the pending removal).

### 8.5 Not changed

The per-stage picker of `add-stage-model-switch` reads `sdlc-mod.sh model list --json`; this item provides that output and does not touch the picker. The pipeline screens are unchanged.

## 9. Documentation

- **`README.md`**, "Custom models and providers": the registry file and its path per OS (section 3); the command list; the key-variable rule (the registry holds a variable NAME; export the variable in the shell profile, because a key written only in `.env` is not used for a registry provider); precedence (registry over `SDLC_PROVIDER*`); the WSL note (WSL and the Windows host share one file only through `SDLC_MODELS_FILE`).
- **`.env.example`**: the registry is the primary place; the `SDLC_PROVIDER*` block is the fallback for CI and headless runs.
- **`CLAUDE.md`**: add `model list|add|add-model|remove-model|remove|test` to the `scripts/sdlc-mod.sh` command row.

## 10. Scope

**In:** `scripts/sdlc-models.cjs` (new), `scripts/sdlc-mod.sh` (`model`, usage), `scripts/sdlc.sh` (`resolve_provider`), `.claude/plugins/sdlc-monitor/hooks/register.tsx` and `types/index.d.ts`, `.env.example`, `README.md`, `CLAUDE.md`, and the tests of section 11.

**Out:**
- storing key values anywhere, the OS keychain included;
- reading a registry provider's key from `.env`;
- removing or changing the `SDLC_PROVIDER*` fallback;
- native Windows `cmd` or PowerShell scripts (the pipeline is bash: Git Bash or WSL);
- discovering models from an endpoint's `/v1/models`;
- per-stage model selection (`add-stage-model-switch`);
- running non-Claude agent CLIs;
- any database or API change.

## 11. Acceptance criteria

### 11.1 Helper (`server/__tests__/scripts/sdlc-models.test.js`)

Path:
- AC1. `SDLC_MODELS_FILE` set: that path is returned, on any platform.
- AC2. Not `win32`, `XDG_CONFIG_HOME` set: `<XDG_CONFIG_HOME>/sdlc/models.json`.
- AC3. `win32`, `APPDATA` set: `<APPDATA>\sdlc\models.json`, also when `XDG_CONFIG_HOME` is set.
- AC4. `win32`, no `APPDATA`: `<home>/.config/sdlc/models.json`.
- AC5. Nothing set: `<home>/.config/sdlc/models.json`.
- AC6. `path` exits 0 on a missing file and on a corrupt file.

Commands, on a temporary file:
- AC7. `add` creates the folder and file on the first write and prints `added <provider> (<n> models)`.
- AC8. `add` on an existing provider replaces endpoint, key variable, the model list and `effort` (an earlier `effort: true` becomes false without `--effort`).
- AC9. `add` without `--endpoint`, `--key-env` or `--models` exits 1 and writes nothing.
- AC10. `add-model` appends and prints `added <provider>/<model>`; `remove-model` removes and prints `removed <provider>/<model>`; `remove` deletes the provider and prints `removed <provider>`.
- AC11. `list --json` prints the one-line shape of 5.2 with `key_set` and a boolean `effort`; with no file it prints `{"providers":{}}` and exits 0.
- AC12. `list` prints one line per provider in the format of 5.2, `  effort` only when true, and `no providers (<path>)` when empty.
- AC13. `get` prints the four lines of 5.7 in order; an unknown provider exits 1.
- AC14. Unknown keys in the file survive a rewrite.

Validation, each exits 1 with a stderr line and leaves the file byte-identical (or absent):
- AC15. Provider name with an upper-case letter, a leading dash or another character outside the pattern; provider name `anthropic`.
- AC16. Endpoint that is relative, has another scheme, or is `http` to a remote host. `http://localhost`, `http://127.0.0.1` and `http://[::1]` are accepted, and so is `https` to any host.
- AC17. `api_key_env` in lower case, starting with a digit, or containing a character outside the pattern.
- AC18. A model with a space or another character outside the pattern; an empty model list; 51 models; a duplicate model.
- AC19. `add-model` or `remove-model` on an unknown provider; `add-model` of a listed model; `add-model` as the 51st model; `remove-model` of an unlisted model; `remove` of an unknown provider.
- AC20. `remove-model` of the last model: the message points to `remove <provider>`.

File integrity:
- AC21. No `models.json.tmp` remains after a successful write or a rejected one.
- AC22. A file that is not valid JSON makes `list`, `add`, `add-model`, `remove-model`, `remove`, `get` and `test` exit 1 naming the file, and the file is unchanged.
- AC23. A wrong-shape file (for example no `providers` object, or `models` not an array) does the same.
- AC24. A hand-edited file that breaks a rule (for example an `http` endpoint on a remote host) does the same, naming the provider and the rule.

Key handling:
- AC25. `key_set` is true when the key variable is set in the environment; false when it is unset; false when it is empty.
- AC26. `key_set` is false when the variable is present only in a `.env` in the working directory.
- AC27. The key value appears in the output of no command (`list`, `list --json`, `get`, `test`, and every error path).

`test`, against a local `http` server:
- AC28. 200: prints `ok`, exit 0. The request is a `POST` to `/v1/messages` with `Authorization: Bearer <key>`, `anthropic-version: 2023-06-01`, the model and `max_tokens` 1.
- AC29. A stored endpoint with a trailing slash requests `/v1/messages`, not `//v1/messages`.
- AC30. 401: prints `HTTP 401: ` plus at most the first 200 characters of the body, exit 1.
- AC31. A response slower than the timeout: prints `timeout after 10s`, exit 1.
- AC32. Nothing listening: prints `connection failed: <error code>`, exit 1.
- AC33. Unknown provider, unlisted model, key not set (including set only in `.env`): exit 1 naming it, and the server receives no request.

### 11.2 Pipeline (`server/__tests__/scripts/sdlc-providers.test.js`)

- AC34. A provider defined only in the registry resolves: `PV_ACTIVE` 1, `PV_MODEL`, `PV_ENDPOINT` from the registry, `PV_KEY` from the key variable.
- AC35. Registry `effort` true gives `PV_EFFORT_FLAG` 1; false or absent gives 0.
- AC36. A provider in both: the registry's endpoint, models and key variable are used, not the `SDLC_PROVIDER*` values.
- AC37. A provider only in `SDLC_PROVIDER*` still works, with its own `_API_KEY`; the existing tests of this file still pass.
- AC38. Registry provider with the key variable unset: exit 1 naming the variable.
- AC39. Registry provider with the key variable present only in `.env`: exit 1 naming the variable; the `.env` value is not used.
- AC40. Registry provider, model not in its list: exit 1 naming the model.
- AC41. Provider in neither place: exit 1 with the existing "not listed in SDLC_PROVIDERS" message.
- AC42. The file is read on every call: a model added between two calls resolves on the second.
- AC43. A corrupt registry file: exit 1 with its path.
- AC44. No registry file and no `SDLC_PROVIDER*`: Anthropic models resolve as today.
- AC45. The key is visible only inside the agent subshell (the existing `apply_provider_env` test holds for a registry provider).

### 11.3 Wrapper (`server/__tests__/scripts/sdlc-mod.test.js`)

- AC46. `model list`, `add`, `add-model`, `remove-model`, `remove` and `test` pass their arguments to the helper unchanged and return its stdout, stderr and exit code (0 and 1 both checked).
- AC47. The usage text lists `model`; `model` with no or an unknown subcommand prints usage and exits 2.

### 11.4 Pane (`.claude/plugins/sdlc-monitor/hooks/register.test.ts`)

- AC48. The overview has a `Models` button; the Models screen has `← All pipelines`.
- AC49. The screen lists each provider with endpoint, key variable, `key set` or `key NOT set`, and models.
- AC50. A new provider with four values calls `model add` with those four values.
- AC51. A new provider with an empty field shows a toast and calls nothing.
- AC52. An existing provider's name with empty fields calls `model add` with the stored endpoint and key variable, the stored models followed by the new ones without duplicates, and `--effort` when the stored `effort` is true.
- AC53. `Enter` on one of the first three inputs shows the draft as `→ value` and calls nothing.
- AC54. A successful add shows a toast with the output line, clears the drafts and reloads the list.
- AC55. A rejected add shows the stderr line as a toast and keeps the typed values.
- AC56. `Remove` calls nothing on the first press and `model remove <provider>` on the second; `Keep it` cancels; the list is reloaded after the removal.
- AC57. `Test` calls `model test <provider>/<model>` and shows a toast with `ok` or the failure line.

### 11.5 General

- AC58. `npm test` passes from the repo root.
- AC59. Integration tests: none added; there is no database or API change.
- AC60. `README.md`, `.env.example` and `CLAUDE.md` carry the content of section 9.

## 12. Where the decisions changed the brief

| Brief | Decision | This spec |
|---|---|---|
| Key from the shell, "else from that one variable in the repo-root `.env`"; `key_set` true from `.env` too | Round 2 Q1: shell environment only | 5.2, 5.8, 7.1, 7.2; AC26, AC33, AC39 replace the brief's "from `.env`" tests |
| `load_env_models` "reads it by name" | Follows from Round 2 Q1 | `load_env_models` is unchanged (7.3) |
| The pane form "merges the models" through `model add` | Round 1 Q1: the pane merges, `add` stays strict | 5.3, 8.3 |
| `SDLC_PROVIDER*` fallback | Round 2 Q2: kept as written | 7.1 |

## 13. Details taken from existing behaviour

These are not new decisions; each follows from a convention already in the code or from a decision above. They are listed so the Plan stage can see their origin.

- An environment variable set to an empty string counts as not set in path resolution (section 3), in line with "unset or empty is not set" for key variables (Round 2 Q1).
- Whitespace around a `--models` entry is ignored (5.3), as `scripts/sdlc.sh` already does for `SDLC_PROVIDER_<NAME>_MODELS`. The pane's fourth field is a typed comma list.
- A helper usage error exits 1 (section 5), the helper's only failure code in the brief. The wrapper's own bad invocation exits 2 (section 6), its existing convention.
- The request outcomes of `test` are printed on stdout and its precondition errors on stderr (5.8), following the wording of Round 1 Q7 ("prints" against "a stderr line"). The pane toast shows whichever line the command produced.
- A stage on an Anthropic model does not consult the registry after startup (7.2), because `resolve_provider` returns early for a model without `/` today and that behaviour is declared unchanged.
- The one word of the `test` prompt and the formatting of the written JSON are not contracts.
- AC31 needs a response slower than 10 seconds. How the test achieves that without a user-visible setting is for the Plan stage.
