# Plan: add-model-registry

Source: `specs-1.md` (sections cited as S5.3, AC12, …) and `decisions.md`. Read for this plan: `scripts/sdlc.sh` (lines 1 to 170), `scripts/sdlc-mod.sh`, `.claude/plugins/sdlc-monitor/hooks/register.tsx`, `.claude/plugins/sdlc-monitor/types/index.d.ts`, the test harnesses of `sdlc-providers.test.js`, `sdlc-mod.test.js` and `register.test.ts`, `README.md` lines 101 to 148, `.env.example`, `scripts/backlog-list.cjs` (export convention), `scripts/sdlc-changes.cjs` (`skipReason`).

No database, API or `server/` source change. No new dependency (Node built-ins only).

## 1. Files

| File | Change |
|---|---|
| `scripts/sdlc-models.cjs` | **new**: the helper (the only reader and writer of `models.json`) |
| `scripts/sdlc.sh` | `resolve_provider` asks the helper first; new `registry_check`; header comment |
| `scripts/sdlc-mod.sh` | `model` dispatch, `usage`, header comment |
| `.claude/plugins/sdlc-monitor/hooks/register.tsx` | Models screen, `Models` button, three atoms, four functions |
| `.claude/plugins/sdlc-monitor/types/index.d.ts` | `ModelProvider`, `ModelDraft`, three `PluginState` keys |
| `README.md`, `.env.example`, `CLAUDE.md` | S9 |
| `server/__tests__/scripts/sdlc-models.test.js` | **new** (Red tests) |
| `server/__tests__/scripts/sdlc-providers.test.js`, `sdlc-mod.test.js`, `.claude/plugins/sdlc-monitor/hooks/register.test.ts` | extended (Red tests) |

Callers of what changes (graft): `resolve_provider` is called only by `stage_model_effort` (`scripts/sdlc.sh:131`), which `stage_flags` and the startup loop (`:142`) call. Its `PV_*` contract does not change, so `apply_provider_env`, `stage_flags` and `agent` need no edit. `usage` in `sdlc-mod.sh` is called by every bad invocation; only its text grows.

## 2. Order of work

1. `scripts/sdlc-models.cjs` (everything else depends on its output contracts).
2. `scripts/sdlc-mod.sh` (`model`).
3. `scripts/sdlc.sh` (`resolve_provider`, `registry_check`).
4. Pane: `types/index.d.ts`, then `register.tsx`.
5. Docs: `README.md`, `.env.example`, `CLAUDE.md`.
6. `npm test` from the repo root.

## 3. Step 1: `scripts/sdlc-models.cjs`

Same layout as `scripts/backlog-list.cjs`: `#!/usr/bin/env node`, pure functions, `module.exports`, and a guarded entry point. `main` is async because of `test`:

```js
module.exports = { resolvePath, validateProvider, validateRegistry, parseModels, main, TEST_TIMEOUT_MS };
if (require.main === module) main(process.argv.slice(2)).then(code => { process.exitCode = code; });
```

Built-ins only: `fs`, `path`, `os`, `http`, `https`. The file never references `.env` (S5).

### 3.1 Functions

| Function | Contract |
|---|---|
| `resolvePath({ env, platform, home })` | S3, first match wins. `set(v)` = `typeof v === 'string' && v !== ''`. (1) `env.SDLC_MODELS_FILE` as given. (2) not `win32` and `XDG_CONFIG_HOME` set: `` `${XDG_CONFIG_HOME}/sdlc/models.json` ``. (3) `win32` and `APPDATA` set: `path.win32.join(APPDATA, 'sdlc', 'models.json')`. (4) `` `${home}/.config/sdlc/models.json` ``. Branches 2 and 4 are built with `/` and branch 3 with `path.win32`, so the result is the same on every OS the tests run on (AC1 to AC5). |
| `isObject(v)` | plain object: not null, not an array. |
| `has(obj, key)` | `Object.prototype.hasOwnProperty.call`. Every provider lookup uses it: `constructor` and `toString` pass V1 and must not be found on the prototype. |
| `validateProvider(name, p)` | returns `null` or `'<field>: <rule>'`. Order: V1, V2, shape (`p` is an object; `endpoint` and `api_key_env` strings; `models` an array of strings; `effort` absent or boolean), V3, V4, V6, V7, V5 per model, V8. |
| `validEndpoint(s)` | V3: `new URL(s)` in a `try` (a relative URL throws); `https:` accepted; `http:` only when `hostname` is `localhost`, `127.0.0.1` or `[::1]`; anything else rejected. |
| `validateRegistry(data)` | returns `null` or a message. Top level must be an object with an object `providers`; then `validateProvider` per provider in file order, first failure wins: `` `provider '${name}': ${msg}` ``. |
| `load(file)` | missing file (`ENOENT`) gives `{ providers: {} }`. Otherwise `JSON.parse`, then `validateRegistry`. Throws `RegistryError` with `` `${file}: not valid JSON` `` or `` `${file}: ${msg}` ``. Never writes. |
| `save(file, data)` | caller has already validated. `mkdirSync(dirname, { recursive: true })`, write `` `${file}.tmp` `` (`JSON.stringify(data, null, 2) + '\n'`), `renameSync` to `file`; a `finally` removes the `.tmp` if it is still there (S4.4, AC21). |
| `parseModels(text)` | `text.split(',').map(s => s.trim())`; a blank string gives `[]` (so V6 fires), an empty entry is kept (so V5 fires). |
| `parseArgs(cmd, argv)` | positionals and options per command; throws `UsageError` for an unknown option, a missing option value or a wrong positional count. `add` takes `--endpoint`, `--key-env`, `--models` (each consumes the next token) and `--effort`; `list` takes `--json`; the others take none. |
| `keyValue(env, name)` | `env[name]` when it is a non-empty string, else `''`. `key_set` is `keyValue(...) !== ''` (AC25). |
| `probe({ endpoint, model, key, timeoutMs })` | S5.8, resolves to `{ ok, line }`. `new URL(endpoint.replace(/\/+$/, '') + '/v1/messages')`; `http` or `https` by protocol; `POST`; headers `content-type: application/json`, `Authorization: Bearer <key>`, `anthropic-version: 2023-06-01`; body `{ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }`. One `setTimeout(timeoutMs)` covers the whole exchange and destroys the request. 2xx: `ok`. Other status: `` `HTTP ${status}: ${body.slice(0, 200)}` ``. Timer fired: `` `timeout after ${timeoutMs / 1000}s` ``. Request error: `` `connection failed: ${err.code || 'ERROR'}` ``. Before returning, every occurrence of `key` in `line` is replaced by `***` (a gateway may echo the token in a 401 body; AC27). |
| `main(argv, io = {})` | `io`: `env` (default `process.env`), `platform`, `home` (`os.homedir()`), `out` and `err` (functions taking one line; default write to `process.stdout` / `process.stderr`), `timeoutMs` (default `TEST_TIMEOUT_MS = 10000`). Returns the exit code. One `try/catch`: `RegistryError`, `UsageError` and command errors print one stderr line and return 1. |

### 3.2 Commands (in `main`)

`path` is handled before `load`, so it works on a missing or corrupt file (AC6). Every other command calls `load` first (AC22 to AC24). Writing commands build the new object in memory, run `validateRegistry` on the whole result, and only then call `save`; a failure therefore creates no folder, no file and no `.tmp` (S4.3).

| Command | Behaviour | Output |
|---|---|---|
| `path` | `resolvePath` | the path |
| `list --json` | `{ providers: { name: { endpoint, api_key_env, models, effort: p.effort === true, key_set } } }`, only these five keys per provider, one line | `JSON.stringify` |
| `list` | per provider `` `${name}  ${endpoint}  ${VAR} (${key_set ? 'key set' : 'key NOT set'})  ${models.join(',')}` `` plus `'  effort'` when true | or `` `no providers (${file})` `` |
| `add <p> --endpoint --key-env --models [--effort]` | missing option: `missing --endpoint` (or `--key-env`, `--models`), checked before anything else. `providers[p] = { ...(existing ?? {}), endpoint, api_key_env, models: parseModels(...), effort: Boolean(flag) }` (unknown keys of the provider and of the file are kept: AC14) | `` `added ${p} (${n} models)` `` |
| `add-model <p> <m>` | unknown provider; `model '<m>' is already listed`; then push and validate (V5, V7) | `` `added ${p}/${m}` `` |
| `remove-model <p> <m>` | unknown provider; `model '<m>' is not listed`; last model: `` `provider '${p}' would have no model left: use remove ${p}` `` (AC20) | `` `removed ${p}/${m}` `` |
| `remove <p>` | unknown provider; `delete` | `` `removed ${p}` `` |
| `get <p>` | unknown provider | `endpoint=`, `api_key_env=`, `models=<comma>`, `effort=true\|false`, four lines in this order |
| `test <p>/<m>` | split at the first `/`. Before any request, on stderr: unknown provider; `` `model '${m}' is not listed for provider '${p}'` ``; `` `key variable ${VAR} is not set` ``. Then `probe`; its line goes to **stdout**, exit 0 only for `ok` (S5.8, S13) | see `probe` |

Fixed message, used by `scripts/sdlc.sh` (step 3): an unknown provider is exactly `` `unknown provider '${p}'` `` on stderr, in every command.

Validation messages name the field and the rule, for example `endpoint: must be https, or http to localhost, 127.0.0.1 or [::1]`, `api_key_env: must match ^[A-Z_][A-Z0-9_]*$`, `provider name: must match ^[a-z0-9][a-z0-9-]*$`, `provider name: 'anthropic' is reserved`, `models: at least 1 model`, `models: at most 50 models`, `models: duplicate 'x'`, `` models: 'x y' must match ^[A-Za-z0-9._:/-]+$ ``.

### 3.3 AC31 (timeout) without a user-visible setting

There is no environment variable and no CLI option for the timeout. The seam is in-process only: `main(['test', 'p/m'], { env, out, err, timeoutMs: 200 })` against a local server that never answers gives `timeout after 0.2s`, and the exported `TEST_TIMEOUT_MS` is asserted to be `10000` (so the CLI prints `timeout after 10s`). This keeps the suite fast; a real 10 s wait is not needed.

## 4. Step 2: `scripts/sdlc-mod.sh`

1. Header comment (after the `watch` lines): `scripts/sdlc-mod.sh model list|add|add-model|remove-model|remove|test …   the model registry (scripts/sdlc-models.cjs)`.
2. `usage()` (line 32): append `` | model list [--json] | model add <provider> --endpoint <url> --key-env <VAR> --models a,b [--effort] | model add-model|remove-model <provider> <model> | model remove <provider> | model test <provider>/<model> `` to the one usage line. Still stderr, still exit 2.
3. Dispatch (line 322 `case`), before `*)`:

```bash
  model)  case "${2:-}" in
            list|add|add-model|remove-model|remove|test) shift; exec node "$ROOT/scripts/sdlc-models.cjs" "$@" ;;
            *) usage ;;
          esac ;;
```

`exec` with `"$@"` passes the arguments unchanged and gives the helper's stdout, stderr and exit code (AC46). `path`, `get`, no subcommand and anything else reach `usage` (AC47). Argument checking is the helper's job (exit 1), not the wrapper's.

## 5. Step 3: `scripts/sdlc.sh`

All edits are inside the block between `# Default per stage` and the `load_env_models` call, which is the slice `sdlc-providers.test.js` extracts (line 8). **The two adjacent lines `load_env_models` and `MODELS_JSON="{"` must stay adjacent**, or that slice breaks.

1. Add after `prov_var` (line 102):

```bash
# The registry helper (user-level models.json). ROOT is the repo root; the tests run this block from another directory.
models_helper() { node "${ROOT:-$PWD}/scripts/sdlc-models.cjs" "$@"; }
# registry_check: a broken registry file fails the run at startup, whatever models the stages use.
registry_check() { models_helper list --json >/dev/null || exit 1; }
```

   The helper's own stderr line (which carries the file path) passes through.

2. `resolve_provider` (lines 106 to 118). Keep the first two lines and the split. Insert the registry branch before the `SDLC_PROVIDERS` lookup; the existing fallback code below it is not edited:

```bash
  local out err rc=0 line kv=""
  err="$(mktemp)"; out="$(models_helper get "$p" 2>"$err")" || rc=$?
  if [ "$rc" -eq 0 ]; then
    rm -f "$err"
    while IFS= read -r line; do
      case "$line" in
        endpoint=*) ep="${line#endpoint=}";; api_key_env=*) kv="${line#api_key_env=}";;
        models=*) models="${line#models=}";; effort=*) [ "${line#effort=}" = true ] || PV_EFFORT_FLAG=0;;
      esac
    done <<< "$out"
    case ",$models," in *",$m,"*) ;; *) echo "ERROR: model '$m' (stage $2) is not in the registry models of provider '$p' (allowed: $models)" >&2; exit 1;; esac
    key="${!kv:-}"
    [ -n "$key" ] || { echo "ERROR: provider '$p' (stage $2): key variable $kv is not set in the environment (export it; .env is not read for a registry provider)" >&2; exit 1; }
    PV_ACTIVE=1; PV_ENDPOINT="$ep"; PV_KEY="$key"; PV_MODEL="$m"
    return 0
  fi
  line="$(cat "$err")"; rm -f "$err"
  [ "$line" = "unknown provider '$p'" ] || { echo "ERROR: model registry: $line" >&2; exit 1; }
```

   - Exit 0: the registry wins as a whole; no `SDLC_PROVIDER*` value is read (S7.1 case 4, AC36, AC38).
   - Exit 1 with exactly `unknown provider '<p>'`: fall through to today's code (AC37, AC41).
   - Any other failure (broken file, helper missing, node missing): exit 1 with the helper's line. It fails closed, so a broken registry is never ignored silently (AC43).
   - `kv` is safe for `${!kv}`: the helper only returns names matching V4.
   - The helper runs on every call, so a changed file is seen by the next agent (AC42). A model without `/` returns before it (S13).
   - `PV_EFFORT_FLAG` starts at 1 and becomes 0 unless `effort=true` (AC35).
   - `local` gains `out err rc line kv`; `ep`, `key`, `models` are already local.

3. Startup: put the call after the marker pair, outside the test slice:

```bash
load_env_models
MODELS_JSON="{"
registry_check
for st in …
```

4. Header comment (lines 22 to 25): providers come first from the registry (`scripts/sdlc-mod.sh model …`, key read from the variable the provider names), then from `SDLC_PROVIDER*`. Update the comment above `resolve_provider` the same way.

`load_env_models` and `apply_provider_env` are not edited (S7.3).

## 6. Step 4: pane

### 6.1 `types/index.d.ts`

```ts
export type ModelProvider = { endpoint: string; api_key_env: string; models: string[]; effort: boolean; key_set: boolean }
// the four inputs of the "Add model" form, as captured on Enter
export type ModelDraft = { name?: string; endpoint?: string; keyEnv?: string; models?: string }
```

`PluginState['sdlc-monitor']` gains `models: Record<string, ModelProvider>`, `modelDraft: ModelDraft`, and `confirmRemove: string` (the provider whose Remove button waits for a second press).

### 6.2 `register.tsx`

1. Import the two types. Add `const MODELS_VIEW = '#models'` (a slug can never contain `#`, so the `view` atom can carry it) and three atoms next to the existing ones: `models` (`{}`), `modelDraft` (`{}`), `confirmRemove` (`''`).
2. New functions, after `discardRun`:

| Function | Behaviour |
|---|---|
| `modelCmd($, args)` | `$.process.run(['bash', WRAPPER, 'model', ...args])` in a `try`; returns `{ ok: exitCode === 0, stdout, line }` where `line` is the first non-empty trimmed line of stdout, else of stderr. A throw gives `{ ok: false, stdout: '', line: 'could not run sdlc-mod.sh' }`. |
| `loadModels($)` | `modelCmd($, ['list', '--json'])`. Not ok: `$.ui.toast(line)` and the atom becomes `{}` (S8.2 broken file). Ok: `parse(stdout)?.providers` into the `models` atom. |
| `submitModel($, typed)` | Saves `typed.trim()` as `modelDraft.models`, then reads the draft and the `models` atom. `name` empty: toast, return. Provider `name` is an own key of the loaded list: `endpoint = draft.endpoint \|\| stored.endpoint`, `keyEnv = draft.keyEnv \|\| stored.api_key_env`, `list = [...stored.models, ...typed entries not already in it]`, `--effort` when `stored.effort`. Otherwise all four must be non-empty, or toast `Fill in all four fields for a new provider` and return with no command (AC51). Then `modelCmd($, ['add', name, '--endpoint', endpoint, '--key-env', keyEnv, '--models', list.join(','), ...effort])`. Toast `line` in both cases. Ok: `modelDraft` becomes `{}` and `loadModels`. Not ok: the draft stays (AC55). Typed entries are split on `,`, trimmed, and empty ones dropped. |
| `removeProvider($, name)` | `modelCmd($, ['remove', name])`, toast `line`, clear `confirmRemove`, `loadModels`. |
| `testModel($, name, model)` | `modelCmd($, ['test', `${name}/${model}`])`, toast `line` (`ok` or the failure line). |

3. Overview (the `!run && !current` branch): add after the `Clear` button row, or beside the title, `<Button key="models-open" label="Models" onPress={async () => { await update($, view, () => MODELS_VIEW); await loadModels($) }} />`.
4. New branch in the `Pane` renderer, placed **before** `if (!run && !current)` (otherwise `#models` falls into the "not started" screen): `if (current === MODELS_VIEW) { … }` reading `models`, `modelDraft`, `confirmRemove`. Layout:
   - `<Button key="back" label="← All pipelines" …>`: sets `view` to `''` and `confirmRemove` to `''`.
   - `Providers`: none gives a dim `No providers yet.`. Per provider one row with `name`, `endpoint`, `api_key_env`, `key set` (green) or `key NOT set` (yellow), `effort` when true, then `<Button key={`remove-${name}`} label={removing ? 'Confirm remove' : 'Remove'} …>` (first press sets `confirmRemove`, second calls `removeProvider`) and, while pending, `<Button key={`keep-${name}`} label="Keep it" …>`. Under it, per model, the model name and `<Button key={`test-${name}/${model}`} label="Test" onPress={() => testModel($, name, model)} />`.
   - `Add model`: four rows, each a label, an `Input`, and `<Text color="cyan">→ {value}</Text>` when its draft is not empty.

     | Input key | Placeholder | `onSubmit` |
     |---|---|---|
     | `model-name` | `provider name` | `update(modelDraft, d => ({ ...d, name: value.trim() }))` |
     | `model-endpoint` | `endpoint` | same for `endpoint` |
     | `model-key-env` | `API key variable NAME (not the key)` | same for `keyEnv` |
     | `model-models` | `models (comma list), Enter to add` | `submitModel($, value)` |

The keys above (`models-open`, `back`, `remove-<p>`, `keep-<p>`, `test-<p>/<m>`, `model-name`, `model-endpoint`, `model-key-env`, `model-models`) are the contract between Red tests and Implement. The pipeline screens and the 2 s refresh are not touched; the list is loaded on opening the screen, after an add and after a removal only.

## 7. Step 5: documentation

- `README.md`, the **Custom models and providers** text in line 103: rewrite it to lead with the registry: the file and its path per OS (S3, including `SDLC_MODELS_FILE`), the `bash scripts/sdlc-mod.sh model …` commands, the key-variable rule (the file holds a variable NAME; export the variable in the shell profile; a key written only in `.env` is not used for a registry provider), precedence (registry over `SDLC_PROVIDER*`), the WSL note, then the existing `SDLC_PROVIDER*` text as the fallback for CI and headless runs. Add the `model` lines to the command block at line 126 and a **Models** bullet to the control-pane list at line 141.
- `.env.example`, lines 18 to 21: say the registry is the primary place and this block is the fallback for CI and headless runs. The commented keys stay.
- `CLAUDE.md`: add `model list\|add\|add-model\|remove-model\|remove\|test` to the `scripts/sdlc-mod.sh` row of the command table.

## 8. Notes for Red tests

- **Never touch the developer's real registry.** Every test sets `SDLC_MODELS_FILE` to a path in a fresh temp folder. In `sdlc-providers.test.js` the `bash()` helper strips `SDLC_*` from the environment, so add to its base env `ROOT: root` (so `models_helper` finds the script while `cwd` is a temp folder) and `SDLC_MODELS_FILE: <temp path that does not exist>`. Without this the existing tests of the file would read `~/.config/sdlc/models.json` or fail to find the helper.
- `sdlc-providers.test.js`: write the registry JSON straight to the temp file. AC39 uses a `.env` in `cwd` holding the key variable. AC42 runs two `resolve_provider` calls in one script with a `node …sdlc-models.cjs add-model` between them. AC43 can use `registry_check` and `resolve_provider p/m`. AC45 reuses the `run()` stub with a registry provider and the key variable in the env.
- `sdlc-models.test.js`: `spawnSync('node', [helper, …], { env, cwd })` for the CLI contracts; AC26 and AC33 put a `.env` in `cwd`. `test` cases use an `http.createServer` on `127.0.0.1` port 0 (allowed by V3) and record the request; these need the async `spawn`, or the in-process `main`, because `spawnSync` blocks the server's event loop. AC31 as in 3.3. AC32: take a port from a server that was closed. AC3 expects backslashes from `resolvePath` on any OS.
- `sdlc-mod.test.js`: `mkRepo` copies only the wrapper. Write a stub `scripts/sdlc-models.cjs` into the temp repo that prints `JSON.stringify(process.argv.slice(2))` on stdout, a line on stderr and exits with `STUB_EXIT`, then check all six subcommands with exit 0 and 1, including an argument with a space.
- `register.test.ts`: extend the `process.run` mock for `argv[2] === 'model'` (it must return `stderr` too) and use the keys of 6.2. It runs with `claude-code/testing`, not with `npm test`.

## 9. Risks and open points

1. **Ship skips `.claude/`.** `skipReason` in `scripts/sdlc-changes.cjs:63` lists every file under `.claude/` as `local or agent configuration`, so `register.tsx`, `types/index.d.ts` and `register.test.ts` will appear in `ship-skipped.md` and must be committed by hand after the run. Not in scope to change.
2. **A key variable named `SDLC_PROVIDER…`.** `load_env_models` copies every `SDLC_PROVIDER*` key of `.env` into the environment. A registry provider whose `api_key_env` has such a name would therefore get its key from `.env`, against Round 2 Q1. The spec declares `load_env_models` unchanged and V4 allows the name, so this plan changes neither. If it matters, the fix is one more rule in the helper (reject an `api_key_env` starting with `SDLC_PROVIDER`), which needs a spec decision.
3. **Fail closed in `resolve_provider`.** A `<provider>/<model>` stage now needs `node` and the helper even for a `.env`-only provider. Both are already required by the pipeline (`sdlc-testcheck.cjs`).
4. **`sdlc.sh` test slice.** The marker `load_env_models\nMODELS_JSON` in `sdlc-providers.test.js:8` must survive (step 3.3).
5. **Key echoed by a gateway.** `probe` masks the key in its output line, so a `HTTP 401` line can differ from the raw body in that one case.
6. **Cost per resolution.** One `node` start per agent on a provider model, plus one at startup. Anthropic-only runs pay only the startup check.
