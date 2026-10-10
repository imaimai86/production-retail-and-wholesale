# Test cases: add-model-registry

Sources: `specs-1.md` (AC1 to AC60), `plan-1.md` section 8. Every test imports or runs the code under test; none reads a test file. Each test sets `SDLC_MODELS_FILE` to a temp path, never the real registry.

## Files

| File | Covers |
|---|---|
| `server/__tests__/scripts/sdlc-models.test.js` (new) | helper: AC1 to AC33 |
| `server/__tests__/scripts/sdlc-providers-registry.test.js` (new) | `resolve_provider`, `registry_check`, `apply_provider_env`: AC34 to AC45 |
| `server/__tests__/scripts/sdlc-mod-model.test.js` (new) | wrapper `model`, usage: AC46, AC47 |
| `server/__tests__/scripts/sdlc-providers.test.js` (edited) | base env gains `ROOT` and a missing `SDLC_MODELS_FILE`, so AC37 (existing tests still pass) holds |

The helper test spawns the CLI (`spawnSync`) for contracts, and calls the exported `main` in process for `test` (a local `http` server on `127.0.0.1` needs a free event loop).

## Matrix

| AC | Case | Expected | Test file |
|---|---|---|---|
| AC1 | `SDLC_MODELS_FILE` set, any platform | that path | models |
| AC2 | not win32, `XDG_CONFIG_HOME` | `<xdg>/sdlc/models.json` | models |
| AC3 | win32, `APPDATA` (with and without XDG) | `<APPDATA>\sdlc\models.json` | models |
| AC4 | win32 without `APPDATA`, with and without XDG | `<home>/.config/sdlc/models.json` | models |
| AC5 | nothing set; empty-string variables | `<home>/.config/...` | models |
| AC6 | `path` on missing and corrupt file | exit 0, file untouched | models |
| AC7 | `add` on a fresh path | folder and file created, `added gw (2 models)` | models |
| AC8 | `add` over existing with `effort: true` | all fields replaced, effort false, other providers kept | models |
| AC9 | `add` without each of the 3 required options | exit 1, names the option, no folder | models |
| AC10 | `add-model`, `remove-model`, `remove` | output lines and file contents | models |
| AC11 | `list --json` with key set; no file | one line shape with `key_set`, boolean `effort`; `{"providers":{}}` and no folder | models |
| AC12 | `list` text, effort suffix, key NOT set; empty | per-line format; `no providers (<path>)` | models |
| AC13 | `get`; effort absent; unknown provider, no file, `constructor`/`toString` | four lines in order; `effort=false`; exit 1 `unknown provider '<p>'` | models |
| AC14 | unknown keys at top level and in a provider | survive `add-model` and `add` | models |
| AC15 | names `Gw`, `-gw`, `g_w`, `g w`, `gw.x`, `anthropic`; valid names | rejected / accepted; file byte-identical or absent | models |
| AC16 | relative, `ftp`, `file`, remote `http`, `localhost.evil.com`; `http` localhost / 127.0.0.1 / `[::1]`, `https` any | rejected / accepted | models |
| AC17 | lower case, leading digit, `-`, space, `$`; valid | rejected / accepted | models |
| AC18 | model with space or `@`, empty entry, empty list, 51 models, duplicate; 50 models; `.:/-_` names | rejected / accepted | models |
| AC19 | unknown provider (3 commands); listed model; bad model; 51st model; unlisted model | exit 1, one stderr line naming it, file unchanged | models |
| AC20 | `remove-model` of the last model | message contains `remove gw`, model kept | models |
| AC21 | after success and after rejections | no `models.json.tmp` | models |
| AC22 to AC24 | invalid JSON; no `providers`; `providers` array; `models` string; endpoint number; `effort` string; remote `http`; `anthropic`; duplicate models, each against `list`, `list --json`, `add`, `add-model`, `remove-model`, `remove`, `get`, `test` | exit 1, stderr has the file path, file byte-identical, no `.tmp`; message names provider and rule | models |
| AC25 | key variable set / unset / empty | `key_set` true / false / false | models |
| AC26 | key only in `.env` of cwd | `key_set` false | models |
| AC27 | key value in `list`, `list --json`, `get`, error paths, and a gateway echoing it in a 401 body | never in stdout or stderr | models |
| AC28 | 200 and 204 | `ok`, exit 0; `POST /v1/messages`, Bearer key, `anthropic-version`, model, `max_tokens` 1; model with `/` split at first slash | models |
| AC29 | endpoint `…///` | requests `/v1/messages`; stored value unchanged | models |
| AC30 | 401 with 500-char body; 500 | `HTTP 401: ` + 200 chars; exit 1 | models |
| AC31 | server never answers, `timeoutMs` 200 | `timeout after 0.2s`; `TEST_TIMEOUT_MS` is 10000 (so the CLI says 10s) | models |
| AC32 | closed port | `connection failed: ECONNREFUSED` | models |
| AC33 | unknown provider, unlisted model, key unset, key empty, key only in `.env`, missing file | exit 1 naming it; server got 0 requests | models |
| AC34 | registry-only provider | `1\|model\|endpoint\|key\|0` | providers-registry |
| AC35 | effort true / false / absent | flag 1 / 0 / 0 | providers-registry |
| AC36 | provider in both | registry endpoint, models, key variable, effort; `.env` model rejected | providers-registry |
| AC37 | `.env`-only provider, with and without a registry file | works with its own `_API_KEY`; existing tests in `sdlc-providers.test.js` | providers-registry, providers |
| AC38 | key variable unset / empty; `_API_KEY` of same provider present | exit 1 naming the variable | providers-registry |
| AC39 | key variable only in `.env` | exit 1 naming it, value not output | providers-registry |
| AC40 | model not listed | exit 1 naming model and allowed list | providers-registry |
| AC41 | provider in neither | existing "not listed in SDLC_PROVIDERS" message | providers-registry |
| AC42 | `add-model` between two resolutions in one shell | second resolves | providers-registry |
| AC43 | corrupt file, `resolve_provider` and `registry_check` | exit 1 with the path; `registry_check` passes for missing and valid files | providers-registry |
| AC44 | no file, no `SDLC_PROVIDER*`; Anthropic model with a corrupt file after startup | `0\|opus\|1`; unaffected | providers-registry |
| AC45 | `stage_flags` + `apply_provider_env` with registry provider | key and base URL inside subshell only, `ANTHROPIC_API_KEY` emptied, nothing outside | providers-registry |
| AC46 | the 6 subcommands (7 forms), stub helper, exit 0 and 1, arg with a space | args unchanged, stdout, stderr, exit code passed through; real helper reachable | mod-model |
| AC47 | no args; `model`, `model path`, `model get x`, `model bogus` | usage lists `model`; usage and exit 2; helper not run | mod-model |

## Not covered by Jest here (stated, not skipped silently)

| AC | Why | How it is checked |
|---|---|---|
| AC48 to AC57 (pane) | the pane test is `.claude/plugins/sdlc-monitor/hooks/register.test.ts`, outside `server/__tests__/`; it runs with `claude-code/testing`, not `npm test`, and this stage may not write outside `server/__tests__/` | Implement stage writes it, using the keys in plan 6.2 (`models-open`, `back`, `remove-<p>`, `keep-<p>`, `test-<p>/<m>`, `model-name`, `model-endpoint`, `model-key-env`, `model-models`) |
| AC58 | `npm test` passes | run at Implement and Review |
| AC59 | no integration tests added | review item: confirm no DB or API change in the diff |
| AC60 | README, `.env.example`, `CLAUDE.md` content | review item: read the three files against spec section 9. A test must not scan documentation text for this |

## Review items (rules about tests or text, not testable by code)

- No test reads, scans or asserts on any test file, including itself.
- Every test uses a temp `SDLC_MODELS_FILE`; none reads or writes `~/.config/sdlc/models.json`.
- AC31 never waits 10 s: the in-process `timeoutMs` seam is used and the 10 s constant is asserted separately.
- Plan risk 2: an `api_key_env` named `SDLC_PROVIDER…` would be filled from `.env` by `load_env_models`; no test pins this, it needs a spec decision.

## Expected state

These are Red tests: the helper `scripts/sdlc-models.cjs`, the `model` dispatch and the `resolve_provider` registry branch do not exist yet, so the three new files fail until Implement. The existing tests in `sdlc-providers.test.js` must keep passing after the harness edit.
