# add-json-logging

Type: feature
Priority: P2 (normal)
Source: user report: "hide internal error hides all details from log as well leaving no clue for debugging - always print errors and warnings in log - use json formatted logger", then: use a logger compatible with Google Cloud Logging (Stackdriver) format, then: print readable logs to the console when running locally, and when run in Kubernetes the logs must be picked up by Google Cloud Logging.

## Problem
Verified by reading the code (not by running the server):
- `server/middleware/errorHandler.js:17` calls `console.error(err)` for errors that reach the handler, so a stack is printed, but as unstructured text with no request context (no method, path, status or request id), so a log line cannot be tied to a request.
- Responses that the routes build themselves are never logged: 17 `res.status(4xx)` responses in `server/index.js` (validation 400, 401/403 auth, 404, 409 stock) leave no trace, so "why did this client get a 409" cannot be answered from the logs.
- Output is plain text, so Google Cloud Logging (and any log collector) cannot filter by severity or fields.
- Unhandled rejections and uncaught exceptions are not logged by the application, and the only other log call is `console.log` at `server/index.js:828`.
- No logging library is installed (`server/package.json` has only `dotenv`, `express`, `pg`).

## Expected behaviour
Every error and warning is always logged, with enough request context to debug it, and the HTTP responses do not change. The same log content has two output modes on stdout:
- Locally (no Kubernetes): human-readable console output.
- In Kubernetes (or production): one JSON object per line in the Google Cloud Logging structured format, which the GKE logging agent reads from the container's stdout and shows in Cloud Logging with the right severity and fields.

## Decisions
- Preconditions (the pipeline's agents cannot run `npm install`): the developer first runs `npm install pino @google-cloud/pino-logging-gcp-config --prefix server` and `npm install -D pino-pretty --prefix server`. The resulting `server/package.json` and `server/package-lock.json` changes are part of this item. Also requires `hide-internal-errors` to be merged, or the pipeline to be started from that branch, because `server/middleware/errorHandler.js` must exist.
- Libraries: `pino` with the pino options from Google's `@google-cloud/pino-logging-gcp-config`. The Plan stage must read the installed package's README and type definitions in `server/node_modules` to confirm the exact function name and signature before using it; do not guess its API.
- New `server/logger.js` exports `logger` (default instance) and `createLogger(destination)` (for tests, writes to the given stream). Output goes to stdout. Service context: `service` = `production-retail-and-wholesale`, `version` = the `version` in `server/package.json`.
- Format of the `json` mode (Cloud Logging structured JSON): `severity` (pino error -> `ERROR`, warn -> `WARNING`, info -> `INFO`, fatal -> `CRITICAL`), `message`, an ISO `timestamp`, and `serviceContext` on error entries. For error-level entries the stack trace must be inside `message` (so Google Cloud Error Reporting groups them).
- Output mode, chosen once at startup by a pure exported function `resolveLogFormat(env)` in `server/logger.js` that returns `'json'` or `'pretty'`:
  1. `LOG_FORMAT` = `json` or `pretty` (case-insensitive) wins.
  2. Otherwise `json` if `KUBERNETES_SERVICE_HOST` is set (Kubernetes sets it in every pod) or `NODE_ENV` is `production`.
  3. Otherwise `pretty`. An invalid `LOG_FORMAT` is ignored and rules 2 and 3 apply.
- `json` mode: the Google Cloud Logging format described below, written to stdout (and nothing else on stdout or stderr from the logger). Do not write to stderr, because the GKE agent would give it a default severity.
- `pretty` mode: `pino-pretty` (loaded lazily, only in this mode) showing local time, severity, message and the key fields (request id, method, path, status, latency), with the stack printed on separate lines. Colour only when stdout is a TTY. It prints the same events at the same levels as `json` mode. If `pino-pretty` cannot be loaded (for example a production install with `--omit=dev`), fall back to `json` mode and log one `WARNING` saying so; never crash.
- Level: `LOG_LEVEL` env var, default `info`. Errors and warnings are never suppressed: any `LOG_LEVEL` above `warn` (`error`, `fatal`, `silent`) or an invalid value is treated as `warn`.
- Under Jest (`JEST_WORKER_ID` set) the default logger discards its output unless `LOG_IN_TESTS=1`; this does not apply anywhere else. Tests that check log output use `createLogger` with an in-memory stream.
- New `server/middleware/requestLogger.js`, registered FIRST in `server/index.js` (before `express.json()`, so malformed-JSON errors are logged too). It logs one entry when the response finishes:
  - status < 400: `INFO`; 400-499: `WARNING`; 500 and above: `ERROR`.
  - `httpRequest` object with `requestMethod`, `requestUrl` (path only, never the query string), `status`, `userAgent`, `remoteIp`, `protocol` and `latency` (a string in seconds ending in `s`, for example `"0.012s"`).
  - Skip entries with status < 400 for `GET /` and `GET /health`, so probes do not flood the log. Failures on those paths are still logged.
  - Request id: reuse the incoming `X-Request-Id` header if present, otherwise generate one with `crypto.randomUUID()`. Send it back in the `X-Request-Id` response header (header only; no response body changes) and log it as `"logging.googleapis.com/labels": { "requestId": "<id>" }`.
  - Trace correlation: if the `X-Cloud-Trace-Context` header (`TRACE_ID/SPAN_ID;o=1`) is present AND `GOOGLE_CLOUD_PROJECT` is set, add `logging.googleapis.com/trace` = `projects/<GOOGLE_CLOUD_PROJECT>/traces/<TRACE_ID>` and `logging.googleapis.com/spanId`. Otherwise omit both.
  - Never log request or response bodies, header values, cookies, the `x-auth-token` value, or query strings.
- `errorHandler.js`: replace `console.error(err)` with a log entry at `ERROR` for status 500 and above and `WARNING` for 4xx, containing the error `message`, `stack`, `name`, `code` and, for Postgres errors, `constraint`, `table` and `column`. Do NOT log the Postgres `detail`, `where` or query parameters (they can contain row values). It must also include the request id and `httpRequest` path. The HTTP status and body are unchanged (`{ "error": "Internal server error" }` and so on).
- Process-level: add and export `attachProcessHandlers(logger)` in `server/logger.js`. `uncaughtException` and `unhandledRejection` log at `fatal` (severity `CRITICAL`) with the error, then exit with code 1 after the log is flushed. Call it from `server/index.js` only inside the existing `if (require.main === module)` block.
- Replace `console.log` at `server/index.js:828` with `logger.info` (message `Server listening on port <port>`).
- Never log `DATABASE_URL`, passwords or tokens, in either mode.
- `GOOGLE_CLOUD_PROJECT` is not set automatically in a pod; the README must say to set it in the Deployment if trace correlation is wanted.

## Scope
- In: `server/logger.js` (new), `server/middleware/requestLogger.js` (new), `server/middleware/errorHandler.js`, `server/index.js`, `server/package.json` and `server/package-lock.json` (from the precondition), docs below.
- Out of scope: `server/swaggerServer.js` and `server/scripts/generate-openapi-spec.js` (command-line tools that keep `console`), `server/models/*` (no query logging, no pool event logging), log shipping or Cloud Logging API credentials (the app only writes to stdout; the GKE agent collects it), Kubernetes manifests, Dockerfile, log rotation, metrics, `traceparent` header support, any HTTP response change.

## Tests
- `server/__tests__/logger.test.js` also covers mode selection through `resolveLogFormat`: `LOG_FORMAT=pretty` and `LOG_FORMAT=JSON` win over everything; with no `LOG_FORMAT`, `KUBERNETES_SERVICE_HOST=10.0.0.1` gives `json`, `NODE_ENV=production` gives `json`, and neither gives `pretty`; an invalid `LOG_FORMAT=xml` falls through to those rules. With `pino-pretty` mocked: `pretty` mode requests the `pino-pretty` target, and when loading it throws, the logger falls back to `json` and emits one `WARNING`. The same events and levels are emitted in both modes.
- `server/__tests__/logger.test.js`: using `createLogger` with an in-memory stream, each line parses as JSON; `severity` is `WARNING` for warn, `ERROR` for error, `INFO` for info, `CRITICAL` for fatal; has `message` and `timestamp`; error entries have `serviceContext.service` and the stack inside `message`; `LOG_LEVEL` of `error`, `silent` and `bogus` still prints a warning; `LOG_LEVEL=info` prints info; under Jest the default logger discards output unless `LOG_IN_TESTS=1`; `attachProcessHandlers` logs `CRITICAL` and exits with code 1 (mock `process.exit` and `process.on`).
- `server/__tests__/middleware/requestLogger.test.js`: `httpRequest` has method, path-only url, status, userAgent, remoteIp and a `latency` string ending in `s`; 200 -> `INFO`, 404 -> `WARNING`, 500 -> `ERROR`; `GET /` and `GET /health` with 200 are not logged but with 500 are; an incoming `X-Request-Id` is echoed and logged as a label, and one is generated when absent; trace fields appear only with both the header and `GOOGLE_CLOUD_PROJECT`; the log output never contains the `x-auth-token` value, a cookie value or the query string.
- Update `server/__tests__/middleware/errorHandler.test.js`: test `EH-16` currently asserts `console.error`; change it to assert the logger entry (severity, message, stack, code, request id) and that the response status and body are unchanged.
- Add to `server/__tests__/index.test.js` (supertest, logger writing to an in-memory stream): a model throwing `new Error('secret db detail')` returns the generic 500 body, and the log line contains `secret db detail`, the stack and the request path, while the response body does not contain them; a 409 stock response and a malformed-JSON 400 each produce one `WARNING` entry.

## Docs
- `README.md`: a "Logging" section: JSON format and field names, severity mapping, `LOG_LEVEL`, `GOOGLE_CLOUD_PROJECT`, `X-Request-Id`, local vs Kubernetes: readable console output locally, JSON in Kubernetes, how `LOG_FORMAT`, `KUBERNETES_SERVICE_HOST` and `NODE_ENV` choose the mode, that the GKE agent turns each JSON line into a `jsonPayload` entry with its `severity`, how to find entries in Cloud Logging (for example `severity>=WARNING`), and that `GOOGLE_CLOUD_PROJECT` must be set in the Deployment for trace correlation.
- `server/API.md`: note the `X-Request-Id` response header.

## Open questions
- none
