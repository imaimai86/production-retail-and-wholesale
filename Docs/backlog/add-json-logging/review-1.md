# Review 1: add-json-logging

Scope: `git diff 3d9d92a` against `specs-1.md`. After all the fixes below, full `npm test` from the repo root passes: 39 suites, 238 tests.

## Blockers

None.
- No test reads, greps or asserts on `.md` files or comments. Every new test imports and runs `server/logger.js`, `server/middleware/requestLogger.js`, `server/middleware/errorHandler.js` or the app through supertest.
- Every behaviour in the documentation (README "Logging" section, `server/API.md` `X-Request-Id` note) is backed by code.

## Acceptance criteria coverage

| Criterion | Test | Runs real code |
|---|---|---|
| LG-1..LG-8 | `server/__tests__/logger.test.js` | yes (`resolveLogFormat`, `buildLogger`, `createLogger`, default logger in `isolateModules`, `attachProcessHandlers` with mocked `process.on`/`exit`) |
| RL-1..RL-6 | `server/__tests__/middleware/requestLogger.test.js` | yes |
| EH-16..20, EH-21 | `server/__tests__/middleware/errorHandler.test.js` | yes |
| IX-L1..IX-L4 | `server/__tests__/index.test.js` | yes (supertest, logger swapped for `createLogger` on an in-memory sink) |
| No `console.*` in `index.js`, `errorHandler.js`, `requestLogger.js` | checked by grep: none | n/a |

## Fixed in this review

1. **Request body leaked into logs on malformed JSON (security, §5.5, §6, §9).** body-parser keeps V8's `JSON.parse` message, which quotes part of the input, for example `Unexpected token 'h', "{"password": hunter2}" is not valid JSON`. `errorHandler` logged that message (and the stack, whose first line repeats it) as is. `server/middleware/errorHandler.js` now spots body-parser parse errors (`type` starting with `entity.parse`, or an own `body` property). For those it logs `request body could not be parsed (<type>)` in place of the message and keeps only the stack frames. IX-L3 still passes. No test covers the leak itself; a regression test should be added (for example, a malformed body holding a secret, then assert the secret is not in the log output).
2. **The CRITICAL entry could be lost in `pretty` mode (§4.7).** pino-pretty returns a Transform pipeline with no `flush`, so `log.flush(cb)` called back at once and `process.exit(1)` could run before the line reached stdout. `exitAfterFlush` now waits one more turn (`setImmediate`). The handler also wraps `log.fatal` in `try`, so a failing logger can't block the exit or start a loop between `unhandledRejection` and `uncaughtException`. LG-8 still passes.
3. **README:** the severity list now shows the pino level → severity mapping that §13 asks for.
4. **Header values leaked into logs on other body-parser errors (security, §5.5).** The fix in item 1 only covered `entity.parse*` errors. body-parser's `charset.unsupported` and `encoding.unsupported` errors quote the `Content-Type` charset and `Content-Encoding` header values in their message and stack (`unsupported charset "…"`), and `errorHandler` logged them as is. Checked with supertest against the app: the header value appeared in the log. `server/middleware/errorHandler.js` now treats every error with a string `type` (all body-parser and raw-body errors set one) or a `body` property the same way: it logs `request body could not be read (<type>)` and only the stack frames. The frames are now cut after the known `<name>: <message>` prefix, so a multi-line original message cannot slip through. Re-checked: no header value or body text in the log for malformed JSON, unsupported charset or unsupported encoding. No test covers these leaks; regression tests should be added (a malformed body holding a secret, and a `charset=`/`Content-Encoding` secret, then assert the secret is not in the log).

## Notes (not changed)

- `requestLogger` logs on `finish` only, as §5.3 says. A request the client aborts before the response finishes gets no entry.
- The `X-Cloud-Trace-Context` trace id is not checked to be hex, so a client can put any text in the `trace` field. It is only a JSON string value with no way to inject anything; the spec does not ask for a check.
- `remoteIp` is `req.ip` without `trust proxy`, so behind the GKE load balancer it is the proxy address. This is what §5.3 asks for ("as Express reports it").
- The Google package adds `serviceContext` and `logging.googleapis.com/insertId` to every entry, not only error entries. §4.4 allows the package's standard fields.
- `engines.node >=22` and CI Node 18 → 22 fit pino 10, which needs Node 20 or later.
- The diff also has SDLC tooling changes that are not part of this feature: `.claude/plugins/sdlc-monitor/hooks/register.*`, `scripts/sdlc-permissions.cjs`, `scripts/sdlc.sh`, `scripts/sdlc-mod.sh`, `scripts/sdlc-testcheck.cjs` and `scripts/prompts/prompt-implement.md`. They were not reviewed against this spec. Ship should decide whether they belong in this commit.
