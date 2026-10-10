# Test cases: add-config-pane (round 1)

Sources: `specs-1.md` (acceptance 1 to 25), `plan-1.md`.

## Where the tests live

| Suite | File | Run by | Written in |
|---|---|---|---|
| Docs (Jest) | `server/__tests__/scripts/config-pane-docs.test.js` | `npm test` | Red tests (this stage) |
| Pane (`claude-code/testing`) | `.claude/plugins/sdlc-monitor/hooks/register.test.ts` | the plugin harness, not `npm test` | start of Implement (the Red tests guard allows only docs and `server/__tests__`; plan-1 "Pipeline constraints") |

The pane tests cannot live under `server/__tests__/`: they need the plugin harness and `register.tsx`, which Jest in `server/` does not load. The matrix below is their input. Review must not count the pane tests as passed unless they were run.

## Matrix

Wrapper calls are mocked through the `model` handler of `world()`; "call" means the captured `bash scripts/sdlc-mod.sh model ...` argv after `model`.

| # | Acc. | Suite | Case | Expected |
|---|---|---|---|---|
| P1 | 1 | Pane | `AbovePrompt` render; press `config-open` | `SDLC`, then `CONFIG`, then status text; open with id `config`, title `CONFIG`; `config-open` has no `variant` |
| P2 | 2 | Pane | `AbovePrompt` with `hasSurvey: true` | neither `sdlc-open` nor `config-open` found |
| P3 | 3 | Pane | run `/sdlc-config` | open with id `config`; non-empty `text`; arguments ignored |
| P4 | 4 | Pane | `session.start` only, clock advanced past `EVERY_MS` | no `ui.open`, no `model` call |
| P5 | 5 | Pane | two providers, `key_set` true / false | names, endpoints, key variable names, every model, `key set`, `key NOT set` shown |
| P6 | 6 | Pane | `effort: true` and `false` providers | `effort` text only for the true one |
| P7 | 7 | Pane | empty registry | `No custom providers`; four inputs present |
| P8 | 8 | Pane | `list --json` exit 1, stderr `<path>: not valid JSON` | that line shown in place of list; four inputs present; no toast |
| P9 | 9 | Pane | open twice | two `list --json` calls |
| P10 | 10 | Pane | all captured calls | each registry call is `bash scripts/sdlc-mod.sh model ...`; none names `models.json` or `sdlc-models.cjs` |
| P11 | 11 | Pane | Enter in fields 1 to 3, then field 4 | no `add` until field 4; three `→ <value>` texts; then exactly one `add beta --endpoint https://c.example --key-env BETA_KEY --models m1,m2` |
| P12 | 12 | Pane | existing `acme` (models fast,big): empty endpoint and variable + `new`; and `https://b.example` + `big, new, new` | `--endpoint https://a.example --key-env ACME_KEY --models fast,big,new`; `--endpoint https://b.example --key-env ACME_KEY --models fast,big,new` |
| P12b | 12 | Pane | `acme` with only `OTHER_KEY`; `beta` with empty endpoint | `--models fast,big` unchanged; empty `--endpoint` argument sent as is |
| P13 | 13 | Pane | existing `effort: true` / `effort: false` / new provider | `--effort` last only for the first |
| P13b | 6.4 | Pane | typed name `constructor` | treated as a new provider (own-property check) |
| P14 | 14 | Pane | successful add | toast `added ...`; no `→` texts; one more `list --json` |
| P15 | 15 | Pane | rejected add (exit 1, stderr line) | toast is the line; four `→` texts remain; list reloaded |
| P16 | 16 | Pane | press `Test` on `acme/fast` | call `test acme/fast`; toast `acme/fast: ok`; list reloaded |
| P17 | 17 | Pane | exit 1 with line on stdout; exit 1 with line on stderr | `acme/fast: HTTP 401: ...`; `acme/fast: key variable ACME_KEY is not set` |
| P18 | 18 | Pane | provider with `key NOT set` | `Test` button present for its models |
| P19 | 19 | Pane | provider `Remove` press, `Keep it`, press twice | first press: no call, `Confirm remove` and `Keep it`; `Keep it` restores `Remove`, no call; second press: `remove acme`, toast `removed acme`, list reloaded |
| P20 | 20 | Pane | `Remove` on provider A then B | only B pending |
| P21 | 21 | Pane | model `Remove` twice; last-model refusal | call `remove-model acme fast`; refusal line is the toast |
| P21b | 5.2, 5.3 | Pane | pending provider and pending model together | both pending at once; `Remove` on another model moves only the model confirmation |
| P22 | 22 | Pane | pending provider and model, close, open again | both cleared; stored form values kept |
| P23 | 7 | Pane | exit 3 with no output; `process.run` throws | toast `failed (exit 3)`; toast with the error's first line; pane still renders |
| P24 | 23 | Pane | existing 22 tests | pass, expectations unedited |
| D1 | 25 | Docs (Jest) | `README.md` text | contains `CONFIG`, `/sdlc-config`, `API key variable NAME (not the key)` |
| D2 | 25 | Docs (Jest) | `README.md` text | says the third field is a variable name, never a key |
| D3 | 25 | Docs (Jest) | `CLAUDE.md` lines with `/sdlc-monitor` | one of them contains `/sdlc-config` and `CONFIG` |
| R1 | 24 | Run | `npm test` from the repo root | passes (D1 to D3 fail before the docs step, pass after) |

## Review items (not testable by a test)

- Form `Input`s are given no `value` / `defaultValue` prop (spec 6.1).
- No shell string is built from provider, model or form text; all calls use `process.run([...])` with separate arguments (spec 5, 9).
- The pane reads no environment, `.env` or `models.json` (spec 9).
- The CONFIG handler touches only `config*` atoms and none of the SDLC atoms (spec 8).
- `scripts/sdlc-models.cjs`, `scripts/sdlc-mod.sh`, the SDLC pane handler and the timer are unchanged in behaviour.
- Manual check from plan-1 step 7.3 with `SDLC_MODELS_FILE` pointing at a scratch file.
