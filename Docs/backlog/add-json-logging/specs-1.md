# Spec: add-json-logging

Type: feature · Priority: P2 · Sources: `brief.md`, `decisions.md` (Round 1: Q1, Q2, Q3 all accepted).

## 1. Summary

The server logs every error and warning, with enough request context to debug it, through a structured logger built on `pino`. The logger has two output modes, both on stdout:

- `json`: one JSON object per line in the Google Cloud Logging structured format. The GKE logging agent reads it from the container's stdout.
- `pretty`: human-readable console output for local development.

HTTP responses (status codes and bodies) do not change. The only visible change for clients is a new `X-Request-Id` response header.

## 2. Current state (checked against the code)

- `server/middleware/errorHandler.js` exists (from `hide-internal-errors`, commit `39a74b3`, so the precondition is met). It calls `console.error(err)` and then sends `{ "error": "Internal server error" }` for 5xx or `{ "error": http.STATUS_CODES[status] }` for 4xx, and calls `next(err)` when headers have already been sent.
- `server/index.js` registers `express.json({ strict: false })`, then `GET /`, then `Auth.verify`, then the routes, then `errorHandler`. `handleStockError` (around line 17) sends 409/404 itself. About 17 route-built `res.status(4xx)` responses exist. `console.log('Server listening on port …')` is inside `if (require.main === module)` (now line 838; the brief says 828).
- There is no `GET /health` route today. A request to it currently gets the response that `Auth.verify` or the 404 fallback gives. The probe skip rule (§5.3) still applies to that path, so a health route added later is covered without a change.
- `server/__tests__/middleware/errorHandler.test.js` test `EH-16..20` spies on `console.error`.
- `server/package.json` dependencies: `dotenv`, `express`, `pg`. Version `1.0.0`.

## 3. Dependencies

| Package | Kind | Purpose |
|---|---|---|
| `pino` | runtime | Logger |
| `@google-cloud/pino-logging-gcp-config` | runtime | Google's pino options for the Cloud Logging structured format |
| `pino-pretty` | dev | Readable local output (`pretty` mode only) |

- No stage before Implement installs anything or reads `server/node_modules`. The Plan stage confirms the API of `@google-cloud/pino-logging-gcp-config` (exact exported function name, signature and options, for example how the service context is given) from its published README and type definitions (npm, unpkg, GitHub or context7). Plan cites the source and pins exact versions of all three packages under `## Dependencies` in `plan-1.md`. The pipeline installs them at the start of Implement. Implement checks the installed type definitions against the plan.
- The resulting changes to `server/package.json` and `server/package-lock.json` belong to this item.
- Wherever the Google package's defaults conflict with this spec (severity names, field names, the stack inside `message`, stdout only), this spec wins. Implement adds options or formatters on top of the package's options to make it match.

## 4. `server/logger.js` (new)

### 4.1 Exports

| Export | Description |
|---|---|
| `logger` | The default instance, created once when the module loads, writing to stdout. |
| `createLogger(destination)` | Returns a new logger that writes `json`-format lines to the given writable stream, with the same level rules, severity mapping, fields and redaction as the default logger. It is meant for tests: it ignores the Jest discard rule (§4.6). |
| `resolveLogFormat(env)` | A pure function. It takes an env-like object and returns `'json'` or `'pretty'` (§4.2). It reads nothing but its argument. |
| `attachProcessHandlers(logger)` | Registers process-level handlers (§4.7). |

Any other exports (for example a level resolver) are allowed but optional.

### 4.2 Output mode: `resolveLogFormat(env)`

The mode is chosen once, at startup. Rules in order:

1. `env.LOG_FORMAT`, trimmed and compared case-insensitively. `json` gives `'json'` and `pretty` gives `'pretty'`. This rule wins over everything else.
2. Otherwise, `'json'` if `env.KUBERNETES_SERVICE_HOST` is set to a non-empty value, or `env.NODE_ENV === 'production'`.
3. Otherwise `'pretty'`.

An unset, empty or invalid `LOG_FORMAT` (for example `xml`) is ignored, and rules 2 and 3 apply.

| env | Result |
|---|---|
| `LOG_FORMAT=pretty, KUBERNETES_SERVICE_HOST=10.0.0.1, NODE_ENV=production` | `pretty` |
| `LOG_FORMAT=JSON` | `json` |
| `KUBERNETES_SERVICE_HOST=10.0.0.1` | `json` |
| `NODE_ENV=production` | `json` |
| `{}` | `pretty` |
| `LOG_FORMAT=xml, KUBERNETES_SERVICE_HOST=10.0.0.1` | `json` |
| `LOG_FORMAT=xml` | `pretty` |

### 4.3 Level: `LOG_LEVEL`

- An unset or empty value (after trimming) means `info`.
- The value is trimmed and matched case-insensitively against `trace`, `debug`, `info` and `warn`. So `INFO` means `info` and ` Debug ` means `debug`.
- `error`, `fatal` and `silent` (in any case), and any other value (for example `bogus`), are treated as `warn`. Errors and warnings are never suppressed.
- The same rule applies to the default logger and to `createLogger`.

### 4.4 `json` mode format (Cloud Logging structured JSON)

Each log entry is exactly one line on the destination, and the line is a valid JSON object. Every entry has:

| Field | Value |
|---|---|
| `severity` | pino `trace` and `debug` → `DEBUG`, `info` → `INFO`, `warn` → `WARNING`, `error` → `ERROR`, `fatal` → `CRITICAL` |
| `message` | The log message (string) |
| `timestamp` | ISO 8601 string, for example `2026-10-18T10:15:30.123Z` |

Error-level entries (`ERROR` and `CRITICAL`) also have:

- `serviceContext`: `{ "service": "production-retail-and-wholesale", "version": "<version from server/package.json>" }` (today `1.0.0`). The version is read from `server/package.json` and is not hard-coded.
- The error's stack trace inside `message` (the message string contains the stack, for example `Error: secret db detail\n    at …`), so Google Cloud Error Reporting can group the entries.

Other structured fields (`httpRequest`, `logging.googleapis.com/labels`, error fields) are top-level keys of the same object. Only the fields given in this spec, the Google package's standard fields and pino's own bookkeeping fields may appear. `json` mode writes only to stdout. Nothing from the logger goes to stderr, because the GKE agent would give stderr lines a default severity.

### 4.5 `pretty` mode

- It uses `pino-pretty`, which is loaded lazily, only when the mode is `pretty`. In `json` mode, `pino-pretty` is never required.
- Each entry shows the local time, the severity, the message and the key fields when present: request id, method, path, status and latency. A stack trace is printed on its own lines.
- Colour only when stdout is a TTY.
- The same events at the same levels as `json` mode. Only the presentation differs.
- **Fallback:** if `pino-pretty` cannot be loaded (for example a production install with `--omit=dev`, or the require throws), the logger uses `json` mode and logs exactly one `WARNING` saying that `pino-pretty` could not be loaded and JSON output is used instead. The process must never crash because of this.

### 4.6 Jest

When `JEST_WORKER_ID` is set, the default `logger` discards all output unless `LOG_IN_TESTS=1`. This rule applies only to the default instance and only under Jest. `createLogger(destination)` always writes to its destination. Tests that check log output use `createLogger` with an in-memory stream, or replace the default logger with one created that way.

### 4.7 `attachProcessHandlers(logger)`

- It registers `process.on('uncaughtException', …)` and `process.on('unhandledRejection', …)`.
- Each handler logs the error (or rejection reason) at `fatal`, which gives severity `CRITICAL`, with the stack in `message` (§4.4). Then, once that entry has been flushed, it calls `process.exit(1)`.
- A rejection reason that is not an `Error` (for example a string or `undefined`) is still logged at `CRITICAL`, and the process still exits with code 1.
- It is called only from `server/index.js`, inside the existing `if (require.main === module)` block. Requiring `server/index.js` (as tests do) does not attach it.

## 5. `server/middleware/requestLogger.js` (new)

### 5.1 Registration

It is registered first in `server/index.js`, before `express.json()`, so requests that fail in body parsing (malformed JSON) are logged and get a request id.

### 5.2 Request id

- If the incoming `X-Request-Id` header is 1 to 128 characters long and contains only `A-Z a-z 0-9 . _ - :`, it is reused.
- Otherwise (the header is absent, empty, too long, has other characters, or was sent twice so Node joined the values as `"a, b"`), a new id is generated with `crypto.randomUUID()`. A rejected incoming value is never logged or echoed.
- The id is set on the response as the `X-Request-Id` header, on every response, before the response is sent. The response body does not change.
- The id is available to later middleware (for `errorHandler`), for example on `req`. The exact property is a Plan decision.
- It is logged as `"logging.googleapis.com/labels": { "requestId": "<id>" }`.

### 5.3 Entry on response finish

One entry is logged when the response finishes:

| Status | Level / severity |
|---|---|
| < 400 | `info` / `INFO` |
| 400 to 499 | `warn` / `WARNING` |
| ≥ 500 | `error` / `ERROR` |

The entry contains:

- `httpRequest`:
  - `requestMethod`: for example `GET`.
  - `requestUrl`: the path only, never the query string. `/products?token=abc` is logged as `/products`.
  - `status`: a number.
  - `userAgent`: the `User-Agent` value. This is the one header value that may be logged.
  - `remoteIp`: the client IP as Express reports it.
  - `protocol`: for example `HTTP/1.1`.
  - `latency`: a string of seconds ending in `s`, for example `"0.012s"`.
- `logging.googleapis.com/labels.requestId`.
- Trace fields, per §5.4.
- A non-empty `message` naming the method, path and status, for example `GET /products 404`. The exact wording is not tested.

**Probe skip:** for `GET /` and `GET /health` with status < 400, nothing is logged. With status ≥ 400 on those paths, the entry is logged as usual. The skip applies only to those two exact paths and to the `GET` method.

### 5.4 Trace correlation

When the `X-Cloud-Trace-Context` header (format `TRACE_ID/SPAN_ID;o=1`, where the `;o=…` part is optional) is present and `GOOGLE_CLOUD_PROJECT` is set, the entry adds:

- `"logging.googleapis.com/trace": "projects/<GOOGLE_CLOUD_PROJECT>/traces/<TRACE_ID>"`
- `"logging.googleapis.com/spanId": "<SPAN_ID>"`

If the header is absent, `GOOGLE_CLOUD_PROJECT` is unset, or the header has no trace id, both fields are left out. A header without a span id gives only the trace field. Errors parsing the header never fail the request.

### 5.5 Never logged

The request and response bodies, any header value other than `User-Agent` (in particular the `x-auth-token` value and cookies), and query strings.

## 6. `server/middleware/errorHandler.js` (changed)

- `console.error(err)` is replaced by one logger entry per error that reaches the handler. This includes the `headersSent` path, which still calls `next(err)` and writes nothing.
- Level: `error` (`ERROR`) when the resolved status (from the existing `resolveStatus`) is ≥ 500, and `warn` (`WARNING`) for 4xx.
- Contents:
  - The error's `message`, `stack`, `name` and `code` (when present).
  - For Postgres errors, `constraint`, `table` and `column` (when present).
  - The request id label (`logging.googleapis.com/labels.requestId`).
  - `httpRequest` with at least `requestMethod` and the path-only `requestUrl`.
  - For `ERROR` entries, the stack inside `message` and `serviceContext`, per §4.4.
- It never logs the Postgres `detail`, `where` or query parameters (they can contain row values), the request body, or header values.
- The HTTP status and body do not change: `{ "error": "Internal server error" }` for 5xx, `{ "error": "<http.STATUS_CODES[status]>" }` for 4xx. `resolveStatus` stays exported and works as before.
- Non-`Error` values that are thrown (for example a string) are still logged without throwing, and the response is still the generic one.

## 7. Entries per request (decision Q1)

The two middlewares log independently and share the same `requestId`, so their entries can be joined in Cloud Logging.

| Case | Entries |
|---|---|
| A response the route builds itself (validation 400, 401/403, 404, 409 stock from `handleStockError`) | Exactly 1, from `requestLogger` |
| A request that reaches `errorHandler` (for example malformed JSON → 400, or a thrown error → 500) | Exactly 2: one from `errorHandler` (error details) and one from `requestLogger` (`httpRequest` summary), at the same severity |
| A successful request, not a probe | Exactly 1 `INFO` entry, from `requestLogger` |
| `GET /` or `GET /health` with status < 400 | None |

## 8. `server/index.js` (changed)

- `requestLogger` is registered first, before `express.json()`.
- The `console.log` startup line is replaced by `logger.info` with the message `Server listening on port <port>`.
- `attachProcessHandlers(logger)` is called inside `if (require.main === module)`.
- No route, status code or body changes. `module.exports = app` is unchanged.

## 9. Secrets

`DATABASE_URL`, passwords, tokens (`ADMIN_TOKEN`, the `x-auth-token` value) and cookies are never logged, in either mode, by any code in scope.

## 10. Configuration

| Variable | Effect |
|---|---|
| `LOG_FORMAT` | `json` or `pretty` (case-insensitive) forces the mode. Other values are ignored. |
| `KUBERNETES_SERVICE_HOST` | Set by Kubernetes in every pod. When set (and `LOG_FORMAT` does not force a mode), the mode is `json`. |
| `NODE_ENV` | `production` gives `json` (unless `LOG_FORMAT` forces a mode). |
| `LOG_LEVEL` | Default `info`. See §4.3. |
| `GOOGLE_CLOUD_PROJECT` | Turns on trace correlation. It is not set automatically in a pod. |
| `LOG_IN_TESTS` | `1` keeps the default logger's output under Jest. |

## 11. Error cases

| Case | Behaviour |
|---|---|
| `pino-pretty` missing in `pretty` mode | Use `json`, log one `WARNING`, do not crash |
| Invalid `LOG_FORMAT` | Ignored, rules 2 and 3 apply |
| Invalid or too-high `LOG_LEVEL` | `warn` |
| Invalid or duplicated `X-Request-Id` | A new UUID is generated. The bad value is not logged or echoed. |
| Malformed `X-Cloud-Trace-Context` | No trace fields. The request is not affected. |
| Malformed JSON body | 400 response as today, plus 2 `WARNING` entries (§7) |
| Uncaught exception or unhandled rejection (server started directly) | One `CRITICAL` entry, then exit code 1 |

## 12. Out of scope

`server/swaggerServer.js` and `server/scripts/generate-openapi-spec.js` (keep `console`), `server/models/*` (no query or pool logging), log shipping and Cloud Logging API credentials, Kubernetes manifests, Dockerfile, log rotation, metrics, `traceparent` support, any HTTP response change other than the added `X-Request-Id` header.

## 13. Documentation

- `README.md`: a "Logging" section covering:
  - the JSON format and its field names, and the severity mapping;
  - `LOG_LEVEL` and its "never below warn" rule;
  - `X-Request-Id`;
  - readable output locally and JSON in Kubernetes, and how `LOG_FORMAT`, `KUBERNETES_SERVICE_HOST` and `NODE_ENV` choose the mode;
  - that the GKE agent turns each JSON line into a `jsonPayload` entry with its `severity`;
  - how to find entries in Cloud Logging (for example `severity>=WARNING`);
  - that `GOOGLE_CLOUD_PROJECT` must be set in the Deployment for trace correlation.
- `server/API.md`: a note that every response carries an `X-Request-Id` header (the incoming value when it is valid, otherwise a generated UUID).

## 14. Acceptance criteria

Tests import and run the real code. No test reads `.md` files or comments.

### `server/__tests__/logger.test.js`

- **LG-1** `resolveLogFormat` returns the results in the §4.2 table, including `LOG_FORMAT=pretty` and `LOG_FORMAT=JSON` winning over everything, and `LOG_FORMAT=xml` falling through.
- **LG-2** With `pino-pretty` mocked, `pretty` mode asks for the `pino-pretty` target or module. When loading it throws, the logger falls back to `json` and emits exactly one `WARNING`.
- **LG-3** The same calls in `pretty` and `json` modes emit the same events at the same levels.
- **LG-4** With `createLogger` and an in-memory stream, every line parses as JSON. `info` → `INFO`, `warn` → `WARNING`, `error` → `ERROR`, `fatal` → `CRITICAL`. Each entry has `message` and an ISO `timestamp`.
- **LG-5** Error entries have `serviceContext.service === 'production-retail-and-wholesale'` and `serviceContext.version` equal to the `server/package.json` version, and `message` contains the stack.
- **LG-6** `LOG_LEVEL` of `error`, `silent` and `bogus` still prints a warning. `LOG_LEVEL=info` and `LOG_LEVEL=INFO` print info. Unset prints info.
- **LG-7** Under Jest the default `logger` writes nothing to stdout unless `LOG_IN_TESTS=1`.
- **LG-8** `attachProcessHandlers` (with `process.on` and `process.exit` mocked) registers `uncaughtException` and `unhandledRejection`. Each handler logs `CRITICAL` with the error and calls `process.exit(1)`.

### `server/__tests__/middleware/requestLogger.test.js`

- **RL-1** `httpRequest` has `requestMethod`, a path-only `requestUrl`, `status`, `userAgent`, `remoteIp` and a `latency` string matching `/^\d+(\.\d+)?s$/`.
- **RL-2** 200 → `INFO`, 404 → `WARNING`, 500 → `ERROR`.
- **RL-3** `GET /` and `GET /health` with 200 are not logged. With 500 they are logged.
- **RL-4** A valid incoming `X-Request-Id` is echoed in the response header and logged as the `requestId` label. When it is absent, a UUID is generated, echoed and logged. An invalid one (empty, over 128 characters, bad characters, duplicated) is replaced, and the bad value appears neither in the header nor in the log.
- **RL-5** Trace and span fields appear only when both `X-Cloud-Trace-Context` and `GOOGLE_CLOUD_PROJECT` are present, with the `projects/<p>/traces/<id>` format.
- **RL-6** The log output never contains the `x-auth-token` value, a cookie value or the query string.

### `server/__tests__/middleware/errorHandler.test.js`

- **EH-16..20 (updated)** Instead of `console.error`, the test asserts one logger entry per error: `ERROR` for 500 (message containing `secret db detail` and the stack, `code`, request id) and `WARNING` for 404. The `headersSent` case logs once, calls `next(err)` and writes nothing. Response statuses and bodies are unchanged.
- **EH-21** A Postgres-style error with `constraint`, `table`, `column`, `detail` and `where` logs the first three and not `detail` or `where`.

### `server/__tests__/index.test.js` (supertest, logger writing to an in-memory stream)

- **IX-L1** A model throwing `new Error('secret db detail')` returns 500 `{ "error": "Internal server error" }`. The log contains `secret db detail`, the stack and the request path. The response body contains none of them.
- **IX-L2** A 409 insufficient-stock response produces exactly one `WARNING` entry in total.
- **IX-L3** A malformed-JSON body gives 400 and exactly one `requestLogger` `WARNING` entry (`httpRequest.status` 400) plus exactly one `errorHandler` `WARNING` entry, both with the same `requestId`.
- **IX-L4** Every response has an `X-Request-Id` header, and response bodies are unchanged.

### General

- `npm test` passes from the repo root.
- No `console.*` calls remain in `server/index.js`, `server/middleware/errorHandler.js` or `server/middleware/requestLogger.js`.
