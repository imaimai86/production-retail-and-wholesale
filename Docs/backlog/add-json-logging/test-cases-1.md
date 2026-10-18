# Test cases: add-json-logging

Sources: `specs-1.md` §14, `plan-1.md` Step 7. All tests import and run the real modules; none reads a `.md` file or a comment. Log output is captured with `createLogger(<in-memory sink>)`; middlewares read `require('../logger').logger` at call time, so tests swap that property.

## Test matrix

| ID | File | Requirement | Case | Expected |
|---|---|---|---|---|
| LG-1 | `server/__tests__/logger.test.js` | §4.2 | `resolveLogFormat` over the spec table, plus ` Pretty `, empty `LOG_FORMAT`, empty `KUBERNETES_SERVICE_HOST`, `NODE_ENV=development` | Table results; `LOG_FORMAT` wins; invalid falls through |
| LG-2 | logger.test.js | §4.5, §11 | `pino-pretty` mocked; then mocked to throw | Pretty asks for the module once (`sync: true`); on throw: no crash, JSON output, exactly one `WARNING` naming `pino-pretty` |
| LG-3 | logger.test.js | §4.5 | Same `info`/`warn`/`error` sequence through pretty (mock stream) and json | Same count, order and levels |
| LG-4 | logger.test.js | §4.4 | `createLogger` with `info/warn/error/fatal` | One line each, valid JSON, severity INFO/WARNING/ERROR/CRITICAL, string `message`, ISO `timestamp` |
| LG-5 | logger.test.js | §4.4 | `error(new Error(..))` and `error({err}, 'ctx')` | `serviceContext` service and version (from `package.json`); stack in `message` |
| LG-6 | logger.test.js | §4.3 | `LOG_LEVEL` = `error`, `silent`, `bogus`, `FATAL`; `info`, `INFO`, unset, empty, blank; `debug`; `resolveLogLevel` | Warn still printed, info not; info printed and debug not; `debug` prints debug |
| LG-6b | logger.test.js | §4.1 | `createLogger` under Jest | Writes to its sink |
| LG-7 | logger.test.js | §4.6 | Default logger under Jest with and without `LOG_IN_TESTS=1` (stdout spy) | Nothing written without it; one JSON line with it |
| LG-8 | logger.test.js | §4.7 | `attachProcessHandlers` with `process.on`/`process.exit` mocked; Error, string, `undefined` reasons for both events | Both events registered; one `CRITICAL` entry each (stack in `message` for Errors); `process.exit(1)` |
| RL-1 | `server/__tests__/middleware/requestLogger.test.js` | §5.3 | `GET /items?token=abc` with a User-Agent | `httpRequest` has method, path-only url, numeric status, userAgent, remoteIp, `HTTP/1.1`, latency `/^\d+(\.\d+)?s$/`; non-empty message |
| RL-2 | requestLogger.test.js | §5.3 | 200 / 404 / 500 | INFO / WARNING / ERROR, one entry each |
| RL-3 | requestLogger.test.js | §5.3 | `GET /`, `GET /health` at 200 and 500; `POST /` at 200 | Skipped at 200, logged at 500; POST logged |
| RL-4 | requestLogger.test.js | §5.2 | Valid id, absent, empty, 129 chars, bad chars, duplicated, exactly 128 chars | Valid echoed and labelled; others replaced by a UUID; bad raw value in neither header nor log; 128 accepted |
| RL-5 | requestLogger.test.js | §5.4 | Trace header with/without span, malformed, no header, no `GOOGLE_CLOUD_PROJECT` | `projects/<p>/traces/<id>` and `spanId` only when allowed; request still 200 |
| RL-6 | requestLogger.test.js | §5.5 | `x-auth-token`, `Cookie`, query string | None of the values in the output |
| RL-7 | requestLogger.test.js | §5.2, §5.4 | `resolveRequestId`, `parseTraceContext` direct calls (named exports per plan Step 3) | Pure helper results |
| EH-16..20 | `server/__tests__/middleware/errorHandler.test.js` (updated) | §6 | 500 error with code and request context; 404; `headersSent` (500 and 404); thrown string | One `ERROR` with message, stack, `error.code`, requestId label, path-only url; one `WARNING`; `headersSent`: one entry, `next(err)`, no response; string: one entry, generic 500 |
| EH-21 | errorHandler.test.js | §6 | Postgres-style error with `detail`/`where` | `constraint`, `table`, `column` logged; `detail` and `where` values absent |
| IX-L1 | `server/__tests__/index.test.js` | §14 | `Products.getAll` rejects `Error('secret db detail')` | 500 generic body; log has message, stack, path; body has none |
| IX-L2 | index.test.js | §7 | 409 insufficient stock | Exactly 1 entry, `WARNING` |
| IX-L3 | index.test.js | §7 | Malformed JSON body | 400; exactly 2 `WARNING`s (requestLogger with `httpRequest.status` 400, errorHandler with `error`), same requestId equal to the response header |
| IX-L4 | index.test.js | §5.2 | `/`, 401, 200, 409, malformed 400, supplied id | `X-Request-Id` on all; bodies unchanged; supplied id echoed |

The tests fail until Implement adds `server/logger.js`, `server/middleware/requestLogger.js` and the `errorHandler`/`index.js` changes, and the pipeline installs `pino`, `@google-cloud/pino-logging-gcp-config` and `pino-pretty`.

## Review items (no test)

- Documentation: README "Logging" section (§13) and the `X-Request-Id` note in `server/API.md`.
- No `console.*` left in `server/index.js`, `server/middleware/errorHandler.js` and `server/middleware/requestLogger.js` (§14 General): a review check, since a test would have to read source text.
- Dependencies: exact versions in `server/package.json` and lockfile; `pino-pretty` under `devDependencies`; `"engines": { "node": ">=22" }`; CI Node version bump (plan Step 6).
- `pino-pretty` is never required in `json` mode (§4.5): verified by review of `buildLogger`; LG-2 covers the pretty path and the fallback.
- Colour only on a TTY (§4.5) and the pretty line layout (local time, severity, key fields, stack on own lines): manual check with `LOG_FORMAT=pretty`.
- `json` mode writes only to stdout, never stderr (§4.4): review of `createGcpLoggingPinoConfig` options (`inihibitDiagnosticMessage: true`).
- `server/index.js` calls `attachProcessHandlers` only inside `require.main === module` and `requestLogger` is registered first (§8): review; IX-L3 exercises the ordering through malformed JSON.
- Secrets (§9): covered by RL-6 and EH-21 for the paths in scope; review the `REDACT_PATHS` safety net.
