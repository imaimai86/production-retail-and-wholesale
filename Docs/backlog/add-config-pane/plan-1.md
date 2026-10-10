# Plan: add-config-pane (round 1)

Input: `specs-1.md` (with `decisions.md` Round 1, all accepted). No source edits are made by this document.

## Findings (affected files)

Graft does not index `.claude/plugins/` (no symbols for `register.tsx`, `register.test.ts` or `types/index.d.ts`, and no hits for `sdlc-monitor` in its 56 files), so the spans below were read directly. Graft has no callers for these symbols: `register` is loaded only through `.claude/plugins/sdlc-monitor/hooks/hooks.json` (`"modules": ["./register.tsx"]`), and nothing else imports the file.

| File | Spans | Role |
|---|---|---|
| `.claude/plugins/sdlc-monitor/hooks/register.tsx` | `PANE` :6, `WRAPPER` :10, atoms :28-37, `parse` :59, `session.start` :460-483 (`command.register` :461), `command.run` for `sdlc-monitor` :485-492, `AbovePrompt` render :524-537 (button :533), SDLC `Pane` render :539-854, Stop two-press pattern :671-687, `Input` with `onSubmit` :787 and :820, `→` draft text :826-830 | New constant, atoms, helpers, command, button and pane handler |
| `.claude/plugins/sdlc-monitor/types/index.d.ts` | exported types :1-46, `PluginState['sdlc-monitor']` :50-66 | Types and state entries for the new atoms |
| `.claude/plugins/sdlc-monitor/hooks/register.test.ts` | `world()` :47-126 (`process.run` stub :103-119, `ui.open` stub :122), `open()` :128, helpers :134-137, `AbovePrompt` test :410-418 | Stub the `model` calls, capture toasts and opens, add the CONFIG tests |
| `README.md` | "Custom models and providers" inside the paragraph at :103, command list :125-138, control pane :145-152 | Docs |
| `CLAUDE.md` | Commands row :15 | Docs |
| `server/__tests__/scripts/` | `monitor-command.test.js` (reads `README.md` and `CLAUDE.md` and asserts on their text) | Pattern for the docs test |

Read for the contract only, not edited (out of scope): `scripts/sdlc-models.cjs` `main` :207-302 and `scripts/sdlc-mod.sh` :331-332.

Notes from reading the code:
- `scripts/sdlc-mod.sh model …` does `exec node scripts/sdlc-models.cjs "$@"`, so the exit code, stdout and stderr are the script's own. Thrown `RegistryError` and `UsageError` go to stderr with exit 1; a failed probe prints its line on stdout with exit 1 and an empty stderr (:292-294). This is why the message line falls back to stdout.
- `model list --json` prints one line: `{"providers":{<name>:{endpoint,api_key_env,models,effort,key_set}}}` (:232-234). With an invalid file `load` throws before the `switch`, so the error is on stderr with exit 1.
- `model add` requires `--endpoint`, `--key-env` and `--models` to be present (:221) and stores `effort: Boolean(opts.effort)` (:253). An empty string still counts as present, so the pane always passes all three options, also when a stored value is empty.
- The existing pane actions call the wrapper as `$.process.run(['bash', WRAPPER, …])` with separate arguments (:204, :303, :308). The CONFIG pane uses the same form, never the `bash -c` string that `launch` uses (:299).
- The pane handler has no "opened" event of its own: the SDLC pane loads its data in the command (:486) and on the timer. So the "on every open" work (3.5) is done by one function that both entry points call before `ui.open`.
- The `process.run` stub in `register.test.ts` returns exit 0 with empty stdout and stderr for unknown calls (:118). A `model` call never happens in the existing tests, so they are not affected by the new code or by an additive stub.
- `register.test.ts` has no `ui.toast` handler today. The harness lets the existing toasts at :470-472 through without one, so adding a capturing handler is additive.

## Pipeline constraints (read before Red tests)

- `scripts/sdlc.sh` runs `npm test` (Jest in `server/`) and treats `server/__tests__` as the test directory. `register.test.ts` uses `claude-code/testing` and is not run by `npm test`.
- The Red tests stage may write only docs and `server/__tests__`. In `add-pipeline-change-counts` the guard refused its edit of `register.test.ts` (`test-cases-1.md` :40 of that item). Expect the same here.
- So: Red tests writes `test-cases-1.md` with the full matrix (acceptance 1 to 25) and the Jest docs test of step 1. The pane tests of step 2 are written at the start of Implement, before the source edits, from that matrix. Implement and Review may edit `.claude/plugins/`; only `server/__tests__` is locked for them.
- The repo documents no command for running `claude-code/testing` files (nothing in `README.md`, `CLAUDE.md` or `scripts/`). Implement must run `register.test.ts` with the plugin harness if it is available in its environment and say in its log whether it ran. Review must not count the pane tests as passed unless they were run.

## Design

### Names
| Kind | Name |
|---|---|
| Pane id | `CONFIG_PANE = 'config'`, title `'CONFIG'` |
| Command | `sdlc-config` |
| Atoms (plugin `sdlc-monitor`) | `configList`, `configError`, `configForm`, `configConfirmProvider`, `configConfirmModel` |
| Button keys | `config-open`; `config-test:<provider>/<model>`; `config-remove-model:<provider>/<model>`, `config-keep-model`; `config-remove-provider:<provider>`, `config-keep-provider` |
| Input keys | `config-in-provider`, `config-in-endpoint`, `config-in-keyEnv`, `config-in-models` |

Model names may contain `/` (`openrouter/openai/gpt-5`) and a provider name cannot be told from a model name by text alone, so the pending model confirmation is stored as an object, not as a joined string.

### Types (`types/index.d.ts`)
```ts
export type ConfigProvider = { endpoint: string; api_key_env: string; models: string[]; effort: boolean; key_set: boolean }
export type ConfigForm = { provider: string; endpoint: string; keyEnv: string; models: string }
```
`PluginState['sdlc-monitor']` gains:
```ts
// the last `model list --json` result; null when never loaded or the last load failed
configList: Record<string, ConfigProvider> | null
// the message line of a failed `model list --json`; '' otherwise
configError: string
// the four form values stored by Enter
configForm: ConfigForm
// the provider whose Remove waits for a second press; '' when none
configConfirmProvider: string
// the model whose Remove waits for a second press
configConfirmModel: { provider: string; model: string } | null
```

### Functions (`register.tsx`, module level, placed after `submitAnswers` :374 and before `STAGE_AGENTS` :377)

| Function | Behaviour |
|---|---|
| `firstLine(text: string): string` | First line with non-space content, trimmed; `''` when there is none. |
| `runModel($, args: string[]): Promise<{ ok: boolean; stdout: string; line: string }>` | `$.process.run(['bash', WRAPPER, 'model', ...args])` in a `try`. `ok` is `exitCode === 0`. `line` on exit 0 is `firstLine(stdout)`; on non-zero it is `firstLine(stderr) \|\| firstLine(stdout) \|\| \`failed (exit ${exitCode})\``. In the `catch`: `{ ok: false, stdout: '', line: firstLine(String(e?.message ?? e)) \|\| 'failed' }`. No `env` option is passed. |
| `loadConfig($): Promise<void>` | `runModel($, ['list', '--json'])`. When `ok` and `parse(stdout)?.providers` is a plain object: build `Record<string, ConfigProvider>` in key order (`models` kept only if an array of strings, else `[]`; `effort` and `key_set` as `=== true`; `endpoint` and `api_key_env` through `String(… ?? '')`), then `configList` gets it and `configError` gets `''`. Otherwise `configList` gets `null` and `configError` gets `line`, or `'model list --json: unexpected output'` when `line` is empty. No toast. |
| `openConfig($): Promise<void>` | Clears `configConfirmProvider` (`''`) and `configConfirmModel` (`null`), awaits `loadConfig($)`, then `$.ui.open({ id: CONFIG_PANE, title: 'CONFIG' })`. Does not touch `configForm`. |
| `addArgs(form: ConfigForm, list: Record<string, ConfigProvider> \| null): string[]` | Pure. `const p = list && Object.prototype.hasOwnProperty.call(list, form.provider) ? list[form.provider] : null`. New provider (`p` is null): `['add', form.provider, '--endpoint', form.endpoint, '--key-env', form.keyEnv, '--models', form.models]`. Existing: endpoint is `form.endpoint \|\| p.endpoint`, key variable is `form.keyEnv \|\| p.api_key_env`; typed is `form.models === '' ? [] : form.models.split(',').map(x => x.trim())`; models is `p.models` followed by each typed entry not already in the growing list (an empty entry is kept once, so the backend rejects it); joined with `,`; `'--effort'` is pushed last when `p.effort`. |
| `submitAdd($): Promise<void>` | Reads `configForm` and `configList`, `runModel($, addArgs(form, list))`, toasts `line`, sets `configForm` to `EMPTY_FORM` only when `ok`, then `loadConfig($)`. |
| `testModel($, provider, model): Promise<void>` | `runModel($, ['test', \`${provider}/${model}\`])`; toast `\`${provider}/${model}: ${ok ? 'ok' : line}\``; then `loadConfig($)`. |
| `removeModel($, provider, model): Promise<void>` | `runModel($, ['remove-model', provider, model])`; toast `line`; `configConfirmModel` gets `null`; `loadConfig($)`. |
| `removeProvider($, provider): Promise<void>` | `runModel($, ['remove', provider])`; toast `line`; `configConfirmProvider` gets `''`; `loadConfig($)`. |

`hasOwnProperty` is used for the existing-provider check so that a typed name such as `constructor` is not taken for an existing provider.

The reload in the four action functions is one `list --json` call each, after the action's own call, whatever its exit code (4.1).

## Order of work

Red tests covers step 1 and the matrix. Implement covers steps 2 to 6. Docs go last.

### 1. Docs test (Jest): `server/__tests__/scripts/config-pane-docs.test.js` (new)
Same shape as `monitor-command.test.js` (read a repo file, assert on its text). Covers acceptance 25:
- `README.md` contains `CONFIG`, `/sdlc-config`, and the form's required wording `API key variable NAME (not the key)`.
- `CLAUDE.md` contains `/sdlc-config` and `CONFIG` in the line that also contains `/sdlc-monitor`.

It fails before step 6 and passes after it. It reads only docs, never a test file.

### 2. Pane tests: `.claude/plugins/sdlc-monitor/hooks/register.test.ts`
Additive changes to `world()` only, so the 22 existing tests keep their expectations (acceptance 23):
- New optional third parameter `model?: (argv: string[]) => { exitCode?: number; stdout?: string; stderr?: string } | undefined`. In the `process.run` stub, before the final `return out('')`: when `e.argv[1] === 'scripts/sdlc-mod.sh' && e.argv[2] === 'model'` and `model` is given, return its result with `stderr` passed through (the current `out` helper always sends `stderr: ''`, so build the value directly here).
- `const opens: { id: string; title: string }[] = []`, pushed in the `ui.open` stub; `const toasts: string[] = []`, pushed in a new `on('ui.toast', …)` stub. Return both from `world()`.
- New helpers next to `launches` :134: `modelCalls(calls)` (calls with `c[0] === 'bash' && c[1] === 'scripts/sdlc-mod.sh' && c[2] === 'model'`, mapped to `c.slice(3)`), `openConfig($)` (runs command `sdlc-config`, then mounts `{ component: 'Pane', requestId: 'config' }`), and a `registry(providers)` factory that returns a `model` handler answering `list --json` from an in-memory object and `add` / `remove` / `remove-model` / `test` with the real script's lines (`added <p> (<n> models)`, `removed <p>`, `removed <p>/<m>`, `ok`), with per-test overrides for the failure cases.

New tests, one per behaviour (acceptance numbers in brackets):
1. `AbovePrompt` shows `SDLC`, then `CONFIG`, then the status text; pressing `config-open` records an open with id `config` and title `CONFIG`; `config-open` has no `variant` [1].
2. With `props: { hasSurvey: true }` neither `sdlc-open` nor `config-open` is found [2].
3. `/sdlc-config` records an open with id `config` and returns a non-empty `text` [3].
4. Before either entry point is used, `opens` is empty and `modelCalls` is empty, also after the clock advances past `EVERY_MS` [4].
5. Two providers, one with the key set: names, endpoints, key variable names, `key set`, `key NOT set` and every model name are shown [5]; `effort` only for the provider with `effort: true` [6].
6. Empty registry: `No custom providers` and the four inputs [7].
7. Failing `list --json` (exit 1, stderr `<path>: not valid JSON`): that line is shown, the four inputs are found, `toasts` is empty [8].
8. Opening twice gives two `list --json` calls [9]; every captured `bash` call that mentions `model` has `argv[1] === 'scripts/sdlc-mod.sh'`, and no `fs.read` or `process.run` names `models.json` or `sdlc-models.cjs` [10].
9. New provider: `ui.input` in fields 1 to 3 gives no `add` call and three `→ <value>` texts; field 4 gives exactly `['add','beta','--endpoint','https://c.example','--key-env','BETA_KEY','--models','m1,m2']` [11, 13].
10. Existing provider `acme`: the first two rows of the table in 6.4 [12]; with `effort: true` the call ends with `--effort`, with `effort: false` it does not [13].
11. Successful add: toast `added …`, no `→` texts left, one more `list --json` call [14].
12. Rejected add (exit 1, stderr line): the line is the toast and the four `→ <value>` texts are still shown [15].
13. `Test`: call `['test','acme/fast']`, toast `acme/fast: ok` [16]; exit 1 with the line on stdout gives `acme/fast: HTTP 401: …`; exit 1 with the line on stderr gives `acme/fast: key variable ACME_KEY is not set` [17]; the `Test` button exists for a model of a provider with `key_set: false` [18].
14. Provider `Remove`: first press makes no call, label `Confirm remove`, `config-keep-provider` shown; `Keep it` restores `Remove`; two presses call `['remove','acme']`, toast `removed acme`, list reloaded [19]. `Remove` on a second provider leaves only that one pending [20].
15. Model `Remove`: the same with `['remove-model','acme','fast']`; a refusal for the last model is the toast [21].
16. A pending provider and a pending model confirmation are both gone after `ui.unmount()` and a second `openConfig($)` [22].
17. Fallbacks of section 7: exit 3 with no output gives the toast `failed (exit 3)`; a `process.run` stub that denies the call gives a toast with the error's first line and the pane still renders.

### 3. Types: `.claude/plugins/sdlc-monitor/types/index.d.ts`
Add `ConfigProvider` and `ConfigForm` after `AgentRow` :46 and the five state entries after `notice` :65, as in "Types" above. Nothing existing changes.

### 4. State and helpers: `register.tsx`
1. Import `ConfigForm` and `ConfigProvider` in the type import at :4.
2. `const CONFIG_PANE = 'config'` after `PANE` :6.
3. After `notice` :37: `const EMPTY_FORM: ConfigForm = { provider: '', endpoint: '', keyEnv: '', models: '' }` and the five atoms, each `atom({ plugin: 'sdlc-monitor', key: '<name>' } as const, <initial>)` with the initial values `null`, `''`, `EMPTY_FORM`, `''`, `null`.
4. The functions of the "Functions" table, in that order, after `submitAnswers` :374.

### 5. Wiring: `register.tsx`, inside `register` :459
1. `session.start` :461: add a second `await $.command.register({ name: 'sdlc-config', description: 'Open the CONFIG pane: providers and models of the model registry' })` right after the `sdlc-monitor` one. Nothing else in the handler changes: no `openConfig`, no `loadConfig`, nothing in the timer.
2. After the `sdlc-monitor` `command.run` handler :492:
   ```tsx
   on('command.run', { command: 'sdlc-config' }, async $ => {
     await openConfig($)

     return { text: 'CONFIG opened: providers and models.' }
   })
   ```
3. `AbovePrompt` :533-534: insert `<Button key="config-open" label="CONFIG" onPress={() => openConfig($)} />` between the `SDLC` button and the `Text`. The `hasSurvey` line :525, the `SDLC` button and the `Text` are not edited. Update the comment at :523 to say two buttons.
4. After the SDLC pane handler (:854), a new `on('ui.render', { component: 'Pane', requestId: CONFIG_PANE }, async ($, e) => { … })`. It reads only the five `config*` atoms. Render, top to bottom, in one `<Box flexDirection="column" paddingX={1} gap={1}>`:
   - `<Text bold>CONFIG</Text>`.
   - List area: `configError` non-empty: `<Text color="red">{error}</Text>`; else `configList === null`: nothing; else no keys: `<Text dimColor>No custom providers</Text>`; else one column `Box` per provider (`key={\`config-provider:${name}\`}`):
     - a row with `<Text bold>{name}</Text>`, `<Text dimColor>{endpoint}</Text>`, `<Text dimColor>{api_key_env}</Text>`, `<Text color={key_set ? 'green' : 'yellow'}>{key_set ? 'key set' : 'key NOT set'}</Text>`, then the provider `Remove` button and, when pending, `Keep it`;
     - one row per model: `<Text>{model}</Text>`, `Test`, the model `Remove` button and, when pending, `Keep it`;
     - `{p.effort && <Text dimColor>effort</Text>}` after the model rows. Keep each of the four provider texts in its own `Text` so a test can find `effort`, `key set` and `key NOT set` as whole texts.
   - Both `Remove` buttons copy the Stop pattern :672-687: `label={pending ? 'Confirm remove' : 'Remove'}`, `variant={pending ? 'primary' : undefined}`; `onPress` calls `removeProvider` / `removeModel` when pending, otherwise sets its own confirm atom to this row (which moves a pending one). `Keep it` resets only its own atom. The provider atom and the model atom never write each other.
   - Form: four rows from a constant list defined next to `EMPTY_FORM`:
     ```ts
     const CONFIG_FIELDS: { key: keyof ConfigForm; label: string }[] = [
       { key: 'provider', label: 'provider name' },
       { key: 'endpoint', label: 'endpoint' },
       { key: 'keyEnv', label: 'API key variable NAME (not the key)' },
       { key: 'models', label: 'models (comma list)' },
     ]
     ```
     Each row: `<Input key={\`config-in-${f.key}\`} placeholder={f.label} onSubmit={…} />` and `{form[f.key] && <Text color="cyan">→ {form[f.key]}</Text>}`. `onSubmit` does `await update($, configForm, d => ({ ...d, [f.key]: value.trim() }))` and, for `models` only, then `await submitAdd($)`. No `value` or `defaultValue` prop. No submit button, no back button.

Nothing in :6-457 other than the additions above, and nothing in the SDLC pane handler :539-854, is edited.

### 6. Docs
- `README.md` :145-152: change the opening line of the control-pane paragraph to name both buttons, and add one bullet after "Discard and start over": **CONFIG** button and `/sdlc-config`; lists each registry provider with endpoint, key variable and `key set` / `key NOT set`; **Test** per model (result as a toast); **Remove** per model and per provider (press twice to confirm); the four-field form (provider name, endpoint, `API key variable NAME (not the key)`, models), Enter stores a field and Enter in the models field sends the add; an existing provider name adds the typed models and keeps the stored value of an empty field; the third field takes a variable name, never a key. In the :103 paragraph, after the sentence that introduces `bash scripts/sdlc-mod.sh model …`, add a short pointer to the CONFIG pane.
- `CLAUDE.md` :15: after "then `/sdlc-monitor`" add the `CONFIG` button and `/sdlc-config` for providers and models.

### 7. Verification
1. `npm test` from the repo root: the docs test of step 1 passes and nothing else changes [24, 25].
2. `register.test.ts` with the `claude-code/testing` harness: the 22 existing tests unchanged and green, the 17 new ones green [1 to 23].
3. By hand: `claude --plugin-dir .claude/plugins/sdlc-monitor` with `SDLC_MODELS_FILE` pointing at a scratch file; press `CONFIG`, add a provider, add a model to it, `Test`, remove the model, remove the provider; break the file and reopen.

## Assumptions and risks

| # | Point | Default taken |
|---|---|---|
| 1 | Red tests cannot edit `register.test.ts` (guard) and `npm test` does not run it | Pane tests are written first in Implement from the matrix; only the docs test is red in the Red tests stage. |
| 2 | Exit 0 from `list --json` with output that is not the expected JSON has no message line by the spec's definition (section 2 defines it for non-zero exits) | Show the first non-empty stdout line, or `model list --json: unexpected output` when there is none. |
| 3 | `ui.open` is awaited after the list load, so the pane appears once `list --json` returns (one short `node` start) | Accepted: it matches the `sdlc-monitor` command, which refreshes before opening, and the first render already has the list. |
| 4 | The harness accepts an `on('ui.toast', …)` stub and `props: { hasSurvey: true }` on mount, and `ui.input` fires `onSubmit` (used at test :222) | If the toast stub is not supported, assert on a `$.ui.toast` spy instead; the source does not change. |
| 5 | A wrapper call can take up to 10 s (`Test`); the pane shows nothing meanwhile | As decided in Q5. A press during that time starts a second call; not guarded. |
| 6 | Stored form values and the list live in atoms, so they survive closing the pane, as 6.2 requires | No reset on open. |

## Out of scope (unchanged)
`scripts/sdlc-models.cjs`, `scripts/sdlc-mod.sh`, `.claude/plugins/sdlc-guard/`, `hooks.json`, the SDLC pane handler, the timer, the status line, integration tests.
