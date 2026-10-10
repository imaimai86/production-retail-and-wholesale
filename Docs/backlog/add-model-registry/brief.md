# add-model-registry

Type: feature
Priority: P2 (normal)
Source: user request in the triage conversation: "I want the user to be able to add their own models, using the monitor plugin; .env is not the best place to keep dynamic configuration". Decisions from the user: the registry is a user-level JSON file that works on macOS, Linux and Windows; API keys are never stored in it, only the name of an environment variable.

## Problem
Custom providers and models are configured only through `SDLC_PROVIDER*` keys in the repo-root `.env` (`load_env_models`, `resolve_provider`, `scripts/sdlc.sh`, branch `feat/sdlc-model-providers`). `.env` is read once at process start, is per checkout (worktrees get it through a symlink, `scripts/sdlc-mod.sh:138`), is shared with the app's own secrets (`DATABASE_URL`, `ADMIN_TOKEN`), and encodes a provider with its models as a set of variables glued by naming. A pane that adds models would have to rewrite `.env`, which can break the server, and a running pipeline would never see the change. Verified by reading `scripts/sdlc.sh`, `scripts/sdlc-mod.sh` and the plugin; nothing was run.

Builds on `feat/sdlc-model-providers` (the `.env` provider support). Run this item after that branch is merged into `main`.

## Expected behaviour
A user adds, lists, tests and removes providers and their model names with `sdlc-mod.sh model …`. The pane screen for it (a `CONFIG` button and pane) is the separate item `add-config-pane`. The list is stored once per user, outside the repo, and works the same on macOS, Linux and Windows. A model added while a pipeline runs is usable by the next stage that starts, with no restart. No secret is stored: a provider names the environment variable that holds its key.

## Decisions
- File: `models.json`, location resolved by one function in the new `scripts/sdlc-models.cjs`, first match wins: `SDLC_MODELS_FILE`; `$XDG_CONFIG_HOME/sdlc/models.json` when `XDG_CONFIG_HOME` is set (not on Windows); `%APPDATA%\sdlc\models.json` when `process.platform` is `win32` and `APPDATA` is set; else `<os.homedir()>/.config/sdlc/models.json`. The function takes `{ env, platform, home }` so each branch is testable. The folder is created on the first write.
- Format: `{ "providers": { "<name>": { "endpoint": "<url>", "api_key_env": "<VAR>", "models": ["<model>", …], "effort": false } } }`. `effort` is optional and means the same as `SDLC_PROVIDER_<NAME>_EFFORT=yes`.
- Validation (exit 1, stderr message, nothing written): provider name matches `^[a-z0-9][a-z0-9-]*$` and is not `anthropic`; endpoint is an absolute `https` URL, or `http` only for `localhost`, `127.0.0.1` or `::1` (a key must not travel in clear text to another host); `api_key_env` matches `^[A-Z_][A-Z0-9_]*$`; every model matches `^[A-Za-z0-9._:/-]+$`; at most 50 models per provider; at least one model; no duplicate models. No field accepts a key value: a value that looks like a key is not detectable, so the field is named and documented as a variable NAME and the pane label says so.
- Helper commands (`node scripts/sdlc-models.cjs …`), all printing one line or JSON and exiting 0 on success:
  - `path`: the resolved file path.
  - `list [--json]`: providers with endpoint, `api_key_env`, `models`, `effort` and `key_set` (true when the variable is set in the process environment or in the repo-root `.env`; the value is never printed).
  - `add <provider> --endpoint <url> --key-env <VAR> --models a,b [--effort]`: creates the provider or replaces its fields; `--models` replaces the list.
  - `add-model <provider> <model>` and `remove-model <provider> <model>`; `remove <provider>`: removes it with all its models.
  - `get <provider>`: prints `endpoint`, `api_key_env`, comma-joined `models` and `effort` as `key=value` lines, for `sdlc.sh`; exit 1 when unknown.
  - `test <provider>/<model>`: one `POST <endpoint>/v1/messages` with a one-word prompt and `max_tokens` 1, `Authorization: Bearer <value of api_key_env>` and `anthropic-version`; prints `ok` or the HTTP status and the first 200 characters of the error body (the key is never printed); a 10 s timeout; exit 1 on failure. It is the only command that uses the network, and only when called.
- Writes are atomic: write `models.json.tmp` in the same folder, then rename it. A file that is not valid JSON, or has the wrong shape, makes every command except `path` exit 1 naming the file; it is never overwritten or ignored silently.
- Wrapper: `scripts/sdlc-mod.sh model list|add|add-model|remove-model|remove|test …` runs the helper with the same arguments and exit code; usage text lists it. The pane calls only the wrapper.
- `scripts/sdlc.sh`: `resolve_provider` looks the provider up through `node scripts/sdlc-models.cjs get <provider>` first, then falls back to the `SDLC_PROVIDER*` variables. When a provider is defined in both, the registry wins. The set of known providers is the registry's plus `SDLC_PROVIDERS`. It runs on every call, so each agent start sees the current file. The key is the value of the variable named by `api_key_env`, taken from the shell, else from that one variable in the repo-root `.env` (`load_env_models` reads it by name; nothing else of `.env` is read). A missing variable exits 1 naming it. All other behaviour of `resolve_provider` (errors, `_EFFORT`, `apply_provider_env`, the key only inside the subshell) is unchanged. A broken registry file exits 1 at startup with its path.
- Pane: not part of this item. The `CONFIG` button, its pane and the provider and model screen (list, add, test, remove) are delivered by `add-config-pane`, which calls only the `sdlc-mod.sh model` wrapper defined here.
- The model lists feed the per-stage picker of `add-stage-model-switch`, through `sdlc-mod.sh model list --json`; this item does not change that picker.
- Out of the box nothing changes: with no file and no `.env` providers, behaviour is as today.

## Scope
- In: `scripts/sdlc-models.cjs` (new), `scripts/sdlc-mod.sh` (`model` command, usage), `scripts/sdlc.sh` (`resolve_provider`, `load_env_models`), `.env.example`, `README.md`, `CLAUDE.md`.
- Out of scope: any pane or UI change (`add-config-pane`); storing key values anywhere (OS keychain included); native Windows `cmd` or PowerShell scripts (the pipeline is bash, so Git Bash or WSL); WSL and the Windows host share a file only through `SDLC_MODELS_FILE`; discovering models from an endpoint's `/v1/models`; per-stage selection (`add-stage-model-switch`); running non-Claude agent CLIs.

## Tests
- `server/__tests__/scripts/sdlc-models.test.js`: path resolution for each branch (`SDLC_MODELS_FILE`, XDG, win32 with `APPDATA`, win32 without `APPDATA`, default home) using the injected `{ env, platform, home }`; `add`, `add-model`, `remove-model`, `remove` and `list --json` on a temp file; every validation rule above, including `http` to a remote host rejected and to `localhost` accepted, and that nothing is written on failure; atomic write leaves no `.tmp`; a corrupt and a wrong-shape file exit 1 and stay untouched; `key_set` true from the environment and from `.env`, false otherwise, and the value is never in any output; `get` output and unknown provider; `test` against a local `http` server returning 200 (prints `ok`), 401 (exit 1, status shown) and a slow response (timeout), with the key absent from output.
- `server/__tests__/scripts/sdlc-providers.test.js`: a provider from the registry resolves; the registry wins over `SDLC_PROVIDER*` for the same name; a provider only in `.env` still works; the key comes from the named variable in the shell and, failing that, from `.env`; a missing variable exits 1 naming it; the file is read again on every call (change it between two calls); a corrupt registry exits 1.
- `server/__tests__/scripts/sdlc-mod.test.js`: `model` subcommands pass arguments and exit codes through; usage lists `model`.
- Pane tests: none here; they belong to `add-config-pane`.
- Integration tests: none, there is no database or API change.

## Docs
- `README.md` (the "Custom models and providers" paragraph): the registry file and its paths per OS, the command list, the key-variable rule, precedence (registry over `.env`), and the `WSL` note.
- `.env.example`: say the registry is the primary place and the `SDLC_PROVIDER*` block is the fallback for CI and headless runs.
- `CLAUDE.md`: add `model list|add|add-model|remove-model|remove|test` to the `scripts/sdlc-mod.sh` command row.

## Open questions
- none
