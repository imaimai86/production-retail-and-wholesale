
## Round 1 (2026-10-18)

### Q1: How many log entries a request that reaches errorHandler produces
The brief has two loggers that both fire for the same failed request: `requestLogger` logs one entry when the response finishes (WARNING for 4xx, ERROR for 5xx), and `errorHandler` logs its own entry (WARNING for 4xx, ERROR for 5xx) with the error details. A malformed-JSON body is a `SyntaxError` with `status: 400` from `express.json()`, which reaches `errorHandler`, so it produces TWO WARNING entries. But the Tests section says "a 409 stock response and a malformed-JSON 400 each produce one `WARNING` entry". The 409 comes from `handleStockError` in `server/index.js:17` (no `errorHandler`), so it does produce exactly one. The answer decides what the `index.test.js` assertion counts and whether the two middlewares must coordinate (a single merged entry) or log independently.
**Suggested:** Log independently. A request that reaches `errorHandler` produces exactly two entries: one from `errorHandler` (error details: message, stack, name, code, request id, path) and one from `requestLogger` (the `httpRequest` summary), both with the same `requestId` label so they can be joined in Cloud Logging. A response the route builds itself (409 stock, 400 validation, 401/403/404) produces exactly one entry, from `requestLogger`. The malformed-JSON test asserts exactly one `requestLogger` WARNING entry (with `httpRequest.status` 400) and exactly one `errorHandler` WARNING entry; the 409 test asserts exactly one WARNING entry in total.
**Answer:** accept

### Q2: Which incoming `X-Request-Id` values are reused
The brief says to reuse the incoming `X-Request-Id` header if present, echo it in the response header and log it as a label, but sets no limits. A client can send an empty value, a value of several kilobytes (Node allows headers up to 16 KB), a value with spaces or unusual characters, or the header twice (Node joins duplicates as `"a, b"`). Each would be echoed back and written into every log entry for that request, which allows log flooding and confusing labels. The answer decides when the incoming value is kept and when a new `crypto.randomUUID()` is generated instead.
**Suggested:** Reuse the incoming value only when it is 1 to 128 characters long and contains only `A-Z a-z 0-9 . _ - :` (this covers UUIDs, ULIDs and typical load-balancer ids). Otherwise, including an empty or duplicated header, ignore it and generate a new UUID. The rejected value is never logged or echoed.
**Answer:** accept

### Q3: Whether `LOG_LEVEL` is case-insensitive
The brief makes `LOG_FORMAT` case-insensitive (`JSON` works) but says nothing about `LOG_LEVEL`. pino level names are lowercase, so under a literal reading `LOG_LEVEL=INFO` or `LOG_LEVEL=Debug` is an "invalid value" and is treated as `warn`. That would quietly drop the info and debug logs the operator asked for. The answer decides how `LOG_LEVEL` is parsed and what the tests check.
**Suggested:** Trim and match case-insensitively against `trace`, `debug`, `info`, `warn` (so `INFO` means `info`). `error`, `fatal` and `silent` (in any case), and anything else, are treated as `warn`. An unset or empty value means `info`.
**Answer:** accept
