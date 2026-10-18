# Plan: add-json-logging

Sources: `specs-1.md`, `decisions.md` (Round 1: Q1, Q2, Q3 accepted). Section numbers (§) refer to `specs-1.md`.

## 0. Affected files

| File | Change |
|---|---|
| `server/logger.js` | **new**: logger factory, format and level resolution, process handlers |
| `server/middleware/requestLogger.js` | **new**: request id, trace parsing, one entry per finished response |
| `server/middleware/errorHandler.js` | `console.error(err)` (line 17) replaced by a logger entry |
| `server/index.js` | `requestLogger` registered before `express.json` (line 25); `console.log` (line 838) → `logger.info`; `attachProcessHandlers` in the `require.main` block (line 836) |
| `server/package.json`, `server/package-lock.json` | three packages (installed by the pipeline), plus `"engines": { "node": ">=22" }` |
| `.github/workflows/ci.yml` | `node-version: '18'` → `'22'` (see §2.4) |
| `server/__tests__/logger.test.js` | **new** (LG-1..8) |
| `server/__tests__/middleware/requestLogger.test.js` | **new** (RL-1..6) |
| `server/__tests__/middleware/errorHandler.test.js` | EH-16..20 rewritten, EH-21 added; the `console.error` spy in `beforeEach` removed |
| `server/__tests__/index.test.js` | IX-L1..L4 added |
| `README.md`, `server/API.md` | docs step (step 8) |

Callers checked with graft: `errorHandler` is used only by `server/index.js:13,834` and its own test. `handleStockError` (`server/index.js:16-20`) answers 409/404 itself, so those requests never reach `errorHandler` (one entry, §7). Out of scope and untouched: `server/swaggerServer.js`, `server/scripts/generate-openapi-spec.js`, `server/models/*`.

## Dependencies

- runtime: pino@10.4.0
- runtime: @google-cloud/pino-logging-gcp-config@1.3.6
- dev: pino-pretty@13.2.0

## 1. Confirmed package APIs

### 1.1 `@google-cloud/pino-logging-gcp-config@1.3.6`

Sources: https://registry.npmjs.org/@google-cloud/pino-logging-gcp-config/latest, https://unpkg.com/@google-cloud/pino-logging-gcp-config@1.3.6/build/src/pino_gcp_config.d.ts, https://unpkg.com/@google-cloud/pino-logging-gcp-config@1.3.6/build/src/pino_gcp_config.js (context7 does not have this package).

- `main`: `build/src/pino_gcp_config.js`. CommonJS: `const { createGcpLoggingPinoConfig } = require('@google-cloud/pino-logging-gcp-config')`.
- Signature (d.ts):
  ```ts
  export declare function createGcpLoggingPinoConfig(options?: GCPLoggingPinoOptions, pinoLoggerOptionsMixin?: pino.LoggerOptions): pino.LoggerOptions;
  export interface GCPLoggingPinoOptions {
      serviceContext?: ServiceContext;          // { service: string; version?: string }
      traceGoogleCloudProjectId?: string;
      auth?: GoogleAuth;
      pinoDestinationStream?: pino.DestinationStream;
      inihibitDiagnosticMessage?: boolean;      // sic: spelled "inihibit"
  }
  ```
  Throws if `serviceContext` is given without a non-empty `service` string.
- Dependencies: `pino ^10.3.1`, `@google-cloud/logging ^12.0.1`. Engines: Node `>=20.20.2`; `@google-cloud/logging@12.0.1` requires Node `>=22`.
- Behaviour from the source, and what it means for us:
  - **Auto-detection / network.** If `serviceContext` is missing it calls `detectServiceContext(new Logging().auth)`. If `traceGoogleCloudProjectId` is `undefined`/`null` it calls `auth.getProjectId()`. Both are async and may contact the metadata server. **We always pass `serviceContext` and `traceGoogleCloudProjectId: ''`** (the source says an empty string "keeps project ID as null"). Then there are no promises, no `Logging` client and no network. We set the trace fields ourselves in `requestLogger` (§5.4).
  - **Diagnostic line.** Unless `inihibitDiagnosticMessage: true`, it logs a one-off diagnostic entry through a temporary pino on stdout. **We pass `inihibitDiagnosticMessage: true`.**
  - The returned options are `{ ...mixin, messageKey: 'message', formatters: { ...mixin.formatters, level, log }, timestamp }`. `messageKey`, `formatters.level`, `formatters.log` and `timestamp` **override the mixin**. `formatters.log` calls `mixin.formatters.log` first and then `formatLogObject`.
  - `formatters.level` → `{ severity, level }` using `trace,debug→DEBUG, info→INFO, warn→WARNING, error→ERROR, fatal→CRITICAL` (matches §4.4). The numeric `level` stays as a pino bookkeeping field.
  - `formatLogObject` adds `serviceContext` to **every** entry (a package standard field; §4.4 only requires it on error entries, and others may carry it). It adds `logging.googleapis.com/insertId`, and adds `stack_trace` when `entry.err instanceof Error`.
  - **Conflict: timestamp.** The package writes `"timestamp":{"seconds":…,"nanos":…}`, but §4.4 needs an ISO string. **Override after the call**: `options.timestamp = () => \`,"timestamp":"${new Date().toISOString()}"\``.
  - **Conflict: stack in `message`.** The package puts the stack in `stack_trace`, not `message`. We put the stack in `message` ourselves (§3.1 `logMethod` hook, and the errorHandler/process-handler messages).

### 1.2 `pino@10.4.0`

Sources: https://registry.npmjs.org/pino/latest; context7 `/pinojs/pino` (docs/api.md). CommonJS, `types: pino.d.ts`. No `engines` field; its range satisfies the Google package's `^10.3.1`.

- `pino([options], [destination]) => logger`. `destination` can be any object with `write(string)` (Node writable or plain object), e.g. `process.stdout` or an in-memory `{ write(s) { lines.push(s) } }`.
- `options.level`: one of `'fatal','error','warn','info','debug','trace','silent'`.
- `options.hooks.logMethod(inputArgs, method, level)`: must be synchronous and must call `method.apply(this, newArgs)`.
- `options.serializers`: default `{ err: pino.stdSerializers.err }`. The `err` serializer also applies when the first argument is an `Error`. **It copies the error's own enumerable properties**, so a Postgres error passed as `err` would leak `detail`/`where`, and a body-parser `SyntaxError` would leak `body`. So we never pass a raw error object to the logger; we pass a picked plain object under the key `error` (§3.3, §5).
- `options.timestamp`: a function returning a partial JSON string, e.g. `` () => `,"time":"…"` ``.
- `options.base`: `null` drops `pid`/`hostname`.
- `options.redact`: `{ paths: string[], censor }`.
- `logger.flush([cb])`: flushes an async destination; `cb` runs when done. "Does not flush the output of `pino-pretty`." Confirmed in https://unpkg.com/pino@10.4.0/lib/proto.js (`function flush (cb)`): `if (typeof stream.flush === 'function') stream.flush(cb || noop); else if (cb) cb()`. So for `process.stdout` or an in-memory `{ write }` sink (neither has `flush`), `cb` runs synchronously.
- `options.redact` paths are parsed with `/[^.[\]]+|\[([^[\]]*?)\]/g` (https://unpkg.com/pino@10.4.0/lib/redaction.js, backed by `@pinojs/redact`); a quoted bracket segment such as `["x-auth-token"]` is the safe form for keys with `-`.

### 1.3 `pino-pretty@13.2.0` (dev)

Sources: https://registry.npmjs.org/pino-pretty/latest; context7 `/pinojs/pino-pretty` (Readme.md, `_autodocs/api-reference`, `_autodocs/types.md`). CommonJS, `main: index.js`, `types: index.d.ts`, devDependency `pino ^10.1.0`.

- `const pretty = require('pino-pretty'); const stream = pretty(opts); pino({ level }, stream)`. The default export is `build(opts)` and returns a Transform stream.
- `PrettyOptions` used: `colorize?: boolean`, `translateTime?: boolean | string` (`'SYS:HH:MM:ss.l'` = local time), `ignore?: string` (`'pid,hostname'`), `sync?: boolean` (use `true`: no async writes after exit or after Jest tests), `destination?: string | number | DestinationStream | NodeJS.WritableStream` (default `1`), `messageFormat?: false | string | MessageFormatFunc`, `errorLikeObjectKeys?: string[]` (default `['err','error']`), `singleLine?: boolean`.
- Implement checks the installed `node_modules/pino-pretty/index.d.ts` for the exact `MessageFormatFunc` parameters before using it (expected: `(log, messageKey, levelLabel, extras) => string`).

## 2. Design decisions (left to Plan by the spec)

1. **Request id property:** `req.requestId` (set by `requestLogger`, read by `errorHandler`).
2. **Swappable default logger.** Both middlewares do `const loggerModule = require('../logger')` and call `loggerModule.logger.<level>(…)` **at call time**, never destructuring at module load. Tests (and IX-L*) replace it with `require('../logger').logger = createLogger(memoryStream)`, with no `jest.mock` of the module. `module.exports.logger` must therefore be a plain, writable property.
3. **Same events in both modes.** Callers always pass the same `(fields, message)`. Only the pino options and the destination differ by mode.
4. **Node 22.** `@google-cloud/logging@12.0.1` (a dependency of the Google package) requires Node `>=22`, and GitHub CI runs Node 18. GitLab CI uses `node:22` and local is v22.22.2. Bump `.github/workflows/ci.yml` to `'22'` and add `"engines": { "node": ">=22" }` to `server/package.json`.
5. **Error-level message = the stack itself** (no prefix line), so Error Reporting can parse it. Context goes in fields.
6. Requiring the Google package loads `@google-cloud/logging`/`google-gax` once per process (and once per Jest test file that requires `index.js`). This is accepted; no network happens (§1.1).

## 3. Steps (in this order)

### Step 1: dependencies (pipeline)
The pipeline installs the three packages at the start of Implement. Implement then:
- checks `node_modules/@google-cloud/pino-logging-gcp-config/build/src/pino_gcp_config.d.ts` and `pino/pino.d.ts` against §1;
- confirms `pino-pretty` is under `devDependencies`;
- adds `"engines": { "node": ">=22" }` to `server/package.json`.

### Step 2: `server/logger.js` (new)

Constants:
- `SERVICE = 'production-retail-and-wholesale'`
- `VERSION = require('./package.json').version`
- `LEVELS = ['trace','debug','info','warn']`
- `REDACT_PATHS`: `['password','*.password','token','*.token','authorization','*.authorization','cookie','*.cookie','headers','*.headers','["x-auth-token"]','*["x-auth-token"]','DATABASE_URL','ADMIN_TOKEN']`, `censor: '[Redacted]'`. This is a safety net only; callers never pass these. Constructing pino with these paths must not throw (LG-4 exercises it through `createLogger`).

Functions:

1. `resolveLogFormat(env)`: pure, §4.2.
   ```
   const f = String(env.LOG_FORMAT ?? '').trim().toLowerCase();
   if (f === 'json' || f === 'pretty') return f;
   if (String(env.KUBERNETES_SERVICE_HOST ?? '') !== '' || env.NODE_ENV === 'production') return 'json';
   return 'pretty';
   ```
2. `resolveLogLevel(value)` (extra export): §4.3. `v = String(value ?? '').trim().toLowerCase()`; `''` → `'info'`; in `LEVELS` → `v`; anything else (`error`, `fatal`, `silent`, `bogus`) → `'warn'`.
3. `logMethod(inputArgs, method, level)` hook: if `level >= 50` (error/fatal):
   - if `inputArgs[0] instanceof Error`, replace the args with `[{ error: pickError(e) }, e.stack ?? String(e.message)]`. If a string message followed, keep it in the field `context`.
   - if `inputArgs[0]?.err instanceof Error`, copy the other fields, move `err` into a picked `error` field (delete `err`), set the message to `err.stack`, and keep any string message that was passed in the field `context`.
   - then call `method.apply(this, args)`.
   This also stops pino's `err` serializer from copying arbitrary properties.
4. `pickError(err)` (internal, also used by `errorHandler`; export it): `{ name, message, code, constraint, table, column }`, each copied only when present and a string or number. Never `detail`, `where`, `body`, `parameters`. It must not throw: wrap it in try/catch and return `{}`.
5. `safeString(v)`: `try { return String(v) } catch { return '[unprintable]' }`. Exported for reuse.
6. `baseOptions(env)`: `{ level: resolveLogLevel(env.LOG_LEVEL), base: null, hooks: { logMethod }, redact: { paths: REDACT_PATHS, censor: '[Redacted]' } }`.
7. `jsonOptions(env)`:
   ```js
   const opts = createGcpLoggingPinoConfig(
     { serviceContext: { service: SERVICE, version: VERSION }, traceGoogleCloudProjectId: '', inihibitDiagnosticMessage: true },
     baseOptions(env));
   opts.timestamp = () => `,"timestamp":"${new Date().toISOString()}"`;
   return opts;
   ```
8. `loadPretty()`: `return require('pino-pretty')`. It is only called in `pretty` mode (lazy, §4.5).
9. `buildLogger({ format, destination, env = process.env })` (extra export; used by tests for LG-2/LG-3):
   - `format === 'json'` → `pino(jsonOptions(env), destination)`.
   - `format === 'pretty'` → in `try`: `const pretty = loadPretty(); const stream = pretty({ destination, sync: true, colorize: destination?.isTTY === true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname', errorLikeObjectKeys: ['err','error'], messageFormat: <fn showing requestId, method, path, status, latency when present> }); return pino(baseOptions(env), stream);`. Pretty mode keeps pino's default `level`/`msg`/`time` keys so pino-pretty reads them.
   - `catch` (any throw, including the require) → `const l = pino(jsonOptions(env), destination); l.warn('pino-pretty could not be loaded; using JSON output instead'); return l;` This gives exactly one WARNING per build.
10. `createLogger(destination)`: `buildLogger({ format: 'json', destination })`. It always writes and ignores the Jest rule.
11. Default instance:
    ```js
    const discard = process.env.JEST_WORKER_ID !== undefined && process.env.LOG_IN_TESTS !== '1';
    const NULL_STREAM = { write() {} };
    module.exports.logger = buildLogger({ format: resolveLogFormat(process.env), destination: discard ? NULL_STREAM : process.stdout });
    ```
    Use `process.stdout` (a stream, not `pino.destination(1)`) so it writes only to stdout and LG-7 can spy on `process.stdout.write`.
12. `attachProcessHandlers(log)`:
    ```
    const handler = (event) => (reason) => {
      const isErr = reason instanceof Error;
      log.fatal({ event, error: isErr ? pickError(reason) : { value: safeString(reason) } },
                isErr && reason.stack ? reason.stack : `${event}: ${safeString(reason)}`);
      exitAfterFlush(log);
    };
    process.on('uncaughtException', handler('uncaughtException'));
    process.on('unhandledRejection', handler('unhandledRejection'));
    ```
    `exitAfterFlush(log)`: `try { log.flush(() => process.exit(1)); } catch { process.exit(1); }`. Confirmed (§1.2): for a destination without `flush` (stdout, in-memory sink) pino calls `cb` synchronously; for a pino-pretty stream with `sync: true` the entry is already written. The fatal entry is written synchronously by `write` before `flush`, so it is never lost on stdout.
13. Exports: `logger`, `createLogger`, `resolveLogFormat`, `attachProcessHandlers`, plus `resolveLogLevel`, `buildLogger`, `pickError`, `safeString`.

### Step 3: `server/middleware/requestLogger.js` (new)

- `const crypto = require('crypto'); const loggerModule = require('../logger');`
- `VALID_ID = /^[A-Za-z0-9._\-:]{1,128}$/`
- `resolveRequestId(header)` (export): `typeof header === 'string' && VALID_ID.test(header) ? header : crypto.randomUUID()`. A duplicated header joined as `"a, b"` fails the regex (comma, space). An array (should not happen) fails `typeof`.
- `parseTraceContext(header, project)` (export): returns `{}` unless both are non-empty strings. `try`: `const [ids] = header.split(';'); const [trace, span] = ids.split('/');`. If `trace` is empty → `{}`. Otherwise `{ 'logging.googleapis.com/trace': \`projects/${project}/traces/${trace.trim()}\` }`, plus `'logging.googleapis.com/spanId': span.trim()` when `span` is non-empty. `catch` → `{}`.
- `requestLogger(req, res, next)` (default export):
  1. `const start = process.hrtime.bigint();`
  2. `const id = resolveRequestId(req.headers['x-request-id']); req.requestId = id; res.setHeader('X-Request-Id', id);` This runs before `next()`, so every response (including errorHandler and `express.json` failures) carries it.
  3. `res.on('finish', () => { try { … } catch { /* never affect the response */ } })`:
     - `const status = res.statusCode; const path = (req.originalUrl || req.url || '').split('?')[0];`
     - probe skip: `if (req.method === 'GET' && (path === '/' || path === '/health') && status < 400) return;`
     - `latency = \`${(Number(process.hrtime.bigint() - start) / 1e9).toFixed(3)}s\``
     - entry: `{ httpRequest: { requestMethod: req.method, requestUrl: path, status, userAgent: req.get('user-agent'), remoteIp: req.ip, protocol: \`HTTP/${req.httpVersion}\`, latency }, 'logging.googleapis.com/labels': { requestId: id }, ...parseTraceContext(req.headers['x-cloud-trace-context'], process.env.GOOGLE_CLOUD_PROJECT) }`
     - level: `status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'`, then `loggerModule.logger[level](entry, \`${req.method} ${path} ${status}\`)`.
  4. `next()`.
- `GOOGLE_CLOUD_PROJECT` is read per request, so tests can set and unset it.
- No body, no other header value, no query string (§5.5). `originalUrl` is used so the path stays the full path even if mounted under a router later.
- No `console.*`.

### Step 4: `server/middleware/errorHandler.js` (changed)

Replace line 17 `console.error(err);` with `logError(err, req, status)`. Compute `status = resolveStatus(err)` once, before the `headersSent` check, and reuse it for the response.

```js
const loggerModule = require('../logger');
const { pickError, safeString } = loggerModule;

function logError(err, req, status) {
  try {
    const isErr = err instanceof Error;
    const path = String((req && (req.originalUrl || req.url)) || '').split('?')[0];
    const entry = {
      error: isErr ? { ...pickError(err), stack: err.stack } : { value: safeString(err) },
      httpRequest: { requestMethod: req && req.method, requestUrl: path },
    };
    if (req && req.requestId) entry['logging.googleapis.com/labels'] = { requestId: req.requestId };
    const message = isErr && err.stack ? err.stack : safeString(isErr ? err.message : err);
    loggerModule.logger[status >= 500 ? 'error' : 'warn'](entry, message);
  } catch { /* logging must never change the response */ }
}
```

- Error-like objects that are not `instanceof Error` but have `message`/`stack` are picked through `pickError` as well. Treat `err && typeof err === 'object'` as error-like for `pickError`, and use `err.stack` when it is a string.
- `resolveStatus` stays exported unchanged. Response logic unchanged: `if (res.headersSent) return next(err);` then the generic body.
- Unit tests call `errorHandler(err, {}, res, next)` with `req = {}`. The guards above handle that.

### Step 5: `server/index.js` (changed)

- Line 13 area: add `const requestLogger = require('./middleware/requestLogger');` and `const { logger, attachProcessHandlers } = require('./logger');`.
- Line 25: insert `app.use(requestLogger);` immediately **before** `app.use(express.json({ strict: false }));`.
- Lines 836-840:
  ```js
  if (require.main === module) {
    attachProcessHandlers(logger);
    app.listen(port, () => {
      logger.info(`Server listening on port ${port}`);
    });
  }
  ```
- Nothing else changes; `module.exports = app` stays.

### Step 6: CI Node version
`.github/workflows/ci.yml` line 13: `node-version: '18'` → `'22'` (§2.4). `.gitlab-ci.yml` already uses `node:22`.

### Step 7: tests (Red tests stage writes them; all import the real modules)

In-memory capture used in each file (inline; a helper file under `__tests__/` would be collected as a test suite):
`const lines = []; const sink = { write: (s) => { lines.push(s); } }; const entries = () => lines.join('').split('\n').filter(Boolean).map(JSON.parse);`

**`server/__tests__/logger.test.js`**
- LG-1 `resolveLogFormat` over every row of the §4.2 table, plus `LOG_FORMAT=' Pretty '`.
- LG-2 `jest.isolateModules` + `jest.doMock('pino-pretty', () => jest.fn(() => sink2))` → `buildLogger({ format: 'pretty', destination: sink })` calls the mock once (with `sync: true`). Then a `doMock` whose factory throws → `buildLogger({ format: 'pretty', destination: sink })` returns a working logger. `sink` holds exactly one `WARNING` line mentioning `pino-pretty`, and later lines are JSON. No throw.
- LG-3 The same sequence (`info`, `warn`, `error(new Error('x'))`) through the mocked-pretty logger (pino level numbers 30/40/50 in the raw lines the mock stream receives) and through `createLogger` (INFO/WARNING/ERROR) gives the same count, order and levels.
- LG-4 `createLogger(sink)`: `info/warn/error/fatal` → every line parses as JSON with `severity` INFO/WARNING/ERROR/CRITICAL, a string `message`, and `timestamp` matching ISO (`new Date(t).toISOString() === t`). One line per entry (no stray newlines).
- LG-5 `log.error(new Error('secret db detail'))` and `log.error({ err }, 'ctx')` → `serviceContext.service === 'production-retail-and-wholesale'`, `serviceContext.version === require('../package.json').version`, `message` contains `'Error: secret db detail\n    at '`.
- LG-6 `buildLogger` with `env.LOG_LEVEL` of `error`/`silent`/`bogus` still writes a `warn`; `info`/`INFO`/unset write an `info`; `debug` is dropped at `info`. Also `resolveLogLevel(' Debug ') === 'debug'`.
- LG-7 With `JEST_WORKER_ID` set (it always is): `jest.isolateModules` require of `../logger` with `LOG_IN_TESTS` unset, spy on `process.stdout.write` → `logger.warn('x')` writes nothing. With `LOG_IN_TESTS='1'` (and `LOG_FORMAT=json`) → one JSON line written. Restore env afterwards.
- LG-8 Spy on `process.on` (capture the handlers, do not register them) and `process.exit` (mockImplementation). `attachProcessHandlers(createLogger(sink))` registers both events. Calling each handler with `new Error('boom')`, `'plain string'` and `undefined` gives a `CRITICAL` line (message contains the stack for the Error) and `process.exit(1)` (await `new Promise(setImmediate)` before asserting).

**`server/__tests__/middleware/requestLogger.test.js`** (a small `express()` app: `requestLogger`, then routes returning 200/404/500, `GET /`, `GET /health`; supertest; `require('../../logger').logger = createLogger(sink)` in `beforeEach`; wait for `finish` with `await new Promise(setImmediate)` if needed)
- RL-1 `GET /items?token=abc` with a `User-Agent` → `httpRequest` has `requestMethod 'GET'`, `requestUrl '/items'`, numeric `status`, `userAgent`, `remoteIp`, `protocol` `HTTP/1.1`, and `latency` matching `/^\d+(\.\d+)?s$/`.
- RL-2 200 → INFO, 404 → WARNING, 500 → ERROR.
- RL-3 `GET /` and `GET /health` returning 200 → no line. The same paths returning 500 → logged. `POST /` 200 → logged.
- RL-4 Valid id `abc-123:x.y_z` echoed and in the label. Absent → a UUID (v4 regex) echoed and logged. `''`, 129 chars, `'bad id!'`, and a duplicated header (`.set('X-Request-Id', ['a','b'])`) → replaced; the raw value appears in neither the header nor `lines.join('')`.
- RL-5 Trace header + `GOOGLE_CLOUD_PROJECT=proj` → `projects/proj/traces/<id>` and `spanId`. Header without a span → trace only. No env, or no header, or header `'/123'` → neither field. A malformed header still gives 200.
- RL-6 Request with `x-auth-token: tok-SECRET`, `Cookie: sid=COOKIE-SECRET`, `?q=QUERY-SECRET` → none of the three strings appear in the output.

**`server/__tests__/middleware/errorHandler.test.js`**
- Remove the `console.error` spy (lines 26-34). In `beforeEach`, set `require('../../logger').logger = createLogger(sink)` and clear `lines`.
- EH-16..20 (rewritten): 500 error → exactly one `ERROR` line whose `message` contains `secret db detail` and the stack, with `error.code` when set, and the `requestId` label when `req.requestId` is given (pass `{ requestId: 'rid-1', method: 'GET', originalUrl: '/x?y=1' }` → `httpRequest.requestUrl '/x'`). 404 → one `WARNING`. `headersSent` → one line, `next(err)`, no `status`/`json`. Statuses and bodies are unchanged (existing EH-01..15 untouched). A thrown string `'boom'` → one line, generic 500 body, no throw.
- EH-21 An `Error` with `code: '23505'`, `constraint`, `table`, `column`, `detail: 'Key (email)=(a@b.c)'`, `where: 'SQL function'` → `error.constraint/table/column` present. The output contains neither `a@b.c` nor `SQL function`.

**`server/__tests__/index.test.js`** (existing mocks; add `const loggerModule = require('../logger')` and `loggerModule.logger = createLogger(sink)` in a `beforeEach` of a new `describe('logging')`)
- IX-L1 `Products.<method used by a GET route>.mockRejectedValueOnce(new Error('secret db detail'))` → 500 `{ error: 'Internal server error' }`. The log contains `secret db detail`, `'    at '` and the route path. `JSON.stringify(res.body)` contains none of them.
- IX-L2 `Inventory.transfer.mockRejectedValueOnce(coded('INSUFFICIENT_STOCK', …))` (existing pattern, line 273) → 409 and exactly one line in total, `WARNING`.
- IX-L3 POST with `Content-Type: application/json` and body `'{bad'` → 400. Exactly two `WARNING` lines: one with `httpRequest.status === 400` (requestLogger) and one with an `error` field (errorHandler), with the same `requestId`, equal to the response `X-Request-Id`.
- IX-L4 A sample of existing requests (GET 200, 404, 401 without token, 409) all have an `X-Request-Id` header, and their bodies equal the values the existing tests assert.

`npm test` from the repo root must pass. No test reads any `.md` file or comment.

### Step 8: documentation (checked in Review; no test)
- `README.md`: add a "Logging" section covering every point in §13 (JSON fields and severity mapping; `LOG_LEVEL` and the never-below-warn rule; `X-Request-Id`; pretty output locally and JSON in Kubernetes, and how `LOG_FORMAT`/`KUBERNETES_SERVICE_HOST`/`NODE_ENV` choose; GKE agent → `jsonPayload` with `severity`; `severity>=WARNING` query; `GOOGLE_CLOUD_PROJECT` in the Deployment for trace correlation; `LOG_IN_TESTS`). Mention Node 22 as the minimum.
- `server/API.md`: a note that every response carries `X-Request-Id` (the incoming value when it is valid, else a generated UUID).

## 4. Risks and checks for Implement
- Do not pass raw `Error` objects with extra properties into pino outside the `logMethod` hook path. pino's `err` serializer copies enumerable properties (`detail`, `where`, body-parser's `body`).
- Keep `traceGoogleCloudProjectId: ''` and `serviceContext` set, or the Google package starts async metadata lookups (open handles in Jest, network in production).
- `express.json` errors (`SyntaxError`, `status: 400`, `type: 'entity.parse.failed'`) go to `errorHandler` → WARNING. That is the second entry in IX-L3.
- After the change, `graft grep "console\."` in `server/index.js`, `server/middleware/errorHandler.js` and `server/middleware/requestLogger.js` must return nothing.
