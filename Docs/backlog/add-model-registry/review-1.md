# Review 1: add-model-registry

Reviewed `git diff 4019a21` (`scripts/sdlc-models.cjs`, `scripts/sdlc-mod.sh`, `scripts/sdlc.sh`) against `specs-1.md`.

`npm test` after the fixes: 33 suites, 783 tests, all passing. No file under `server/__tests__/` was touched.

## Verdict

The helper, the wrapper and the pipeline resolution match sections 3 to 7. Section 9 (docs) was missing and is now added. **Section 8 (the pane's Models screen, AC48 to AC57) is not implemented and is still open.**

## Fixed

| # | File | Problem | Fix |
|---|---|---|---|
| 1 | `scripts/sdlc-models.cjs` `validEndpoint` | `new URL()` strips newlines, tabs and outer spaces, so an endpoint such as `"https://x.com\nmodels=evil"` passed V3 and was stored as typed. `get` then printed extra `key=value` lines into the output `sdlc.sh` parses, and `list` no longer printed one line per provider. | An endpoint containing whitespace or a control character is rejected. |
| 2 | `scripts/sdlc-models.cjs` `validEndpoint` | `https://user:password@host` was accepted, which puts a secret in the registry and in `list` output, against S4.1 ("no field holds a key value"). | An endpoint with a user or password part is rejected. |
| 3 | `scripts/sdlc-models.cjs` `probe` | The `HTTP <status>` line was cut to 200 characters before the key was masked. A gateway that echoes the key across the cut left the first part of the key unmasked in the output (AC27). | The key is masked before the cut. |
| 4 | `scripts/sdlc-models.cjs` `probe` | The response body was collected without a limit. | Collection stops at 64 KB (only 200 characters are shown). |
| 5 | `scripts/sdlc-models.cjs` `probe` | A key that is not a legal header value (for example one holding a newline) made `request()` throw with the 10 s timer still armed: the command printed the error and then hung for 10 s. | The throw is caught and reported as `connection failed: <code>` at once. |
| 6 | `scripts/sdlc.sh` `resolve_provider` | In the registry branch a requested model containing a comma (`p/a,b` with models `a,b,c`) matched the comma-joined list and passed the allow-list. | A model name with a comma is refused with the existing "not in the registry models" message. |
| 7 | `README.md`, `.env.example`, `CLAUDE.md` | Section 9 / AC60 was not done. | Added: registry path per OS, the `model` commands, the key-variable rule, precedence, the WSL note, `.env` block marked as the fallback, and the `model` entry in the `CLAUDE.md` command row. |

Fixes 1 to 6 have no dedicated test: the suite still passes, but the new rejections themselves were not run (the ad-hoc checks were not permitted in this session). They deserve a test each in a later Red tests pass.

## Open, not fixed

1. **Pane not implemented (S8, AC48 to AC57, plan step 4).** `register.tsx` and `types/index.d.ts` are unchanged, and the Red tests commit did not extend `register.test.ts`. This is a feature gap, not a defect in the diff, and it cannot be verified with `npm test`, so it was not written during review. The README therefore has no "Models" bullet in the control-pane list yet.
2. **`registry_check` is skipped when the helper file is missing** (`scripts/sdlc.sh`). Implement added this so `sdlc-test-repair-resume.test.js`, which copies `sdlc.sh` alone, keeps passing. It weakens S7.2 only for a checkout without `scripts/sdlc-models.cjs`; a `<provider>/<model>` stage still fails there, with node's "Cannot find module" text. Acceptable, but it is a deviation from the plan's fail-closed check.
3. **Key variable named `SDLC_PROVIDER…`** (plan risk 2). `load_env_models` copies such a name from `.env` into the environment, so a registry provider using it would get its key from `.env`, against Round 2 Q1. Needs a spec decision (one more rule in the helper).
4. **Fallback depends on the exact stderr text.** `resolve_provider` falls back to `SDLC_PROVIDER*` only when the helper's stderr is exactly `unknown provider '<p>'`. Anything else node writes to stderr (a warning caused by `NODE_OPTIONS`, for example) turns a `.env` provider into `ERROR: model registry: …`. It fails closed, so it is safe, but brittle. A provider name starting with `--` likewise reports `unknown option` instead of "not listed in SDLC_PROVIDERS".
5. **`sdlc-mod.sh` outside a git repository.** `COMMON` now falls back to `.git` when `git rev-parse` fails (needed by the wrapper tests, whose temp repos are not git repos). `model` works there; the other commands were already unusable there and still are, now with a later error.
6. **Concurrent writers.** Two `model` commands at the same moment share one `models.json.tmp`; the last rename wins and one change can be lost. No lock is specified.

## Checked and found correct

- Path resolution (S3), including empty variables and `win32` separators.
- V1 to V8 on write and on read; a broken file is never rewritten; reading commands create nothing; no `.tmp` is left behind.
- `${!kv}` in `sdlc.sh` is safe: `api_key_env` is validated against V4 on every read before bash expands it.
- The key value reaches no output; `test` does not follow redirects, so the key is not forwarded to another host.
- Registry wins as a whole; the key comes only from the environment; `load_env_models` and `apply_provider_env` are unchanged (S7.3).
- Wrapper: arguments pass through unchanged, `path` and `get` are not exposed, bad `model` invocations exit 2.
