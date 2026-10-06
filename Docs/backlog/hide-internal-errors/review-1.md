# Review 1: hide-internal-errors

Reviewed the diff against specs-1.md. The handler, its registration after all routes, and the API.md note match the spec. I made no source changes.

Observations, not changed:
- A 4xx status with no `http.STATUS_CODES` entry (for example 499) gives a body of `{ "error": undefined }`, which serialises to `{}`. I tried a `'Bad Request'` fallback, but test EH-07 (`errorHandler.test.js`) pins the literal `http.STATUS_CODES[status]` behaviour for 499. The spec also defines the body that way, so I reverted. Consider a spec and test update if a fallback is wanted.
- If `err.status` is invalid but `err.statusCode` is a valid 4xx, the handler uses `statusCode`. The spec's "read status, then statusCode" allows this.
- No leakage found: `err.message`, `err.code` and the stack are only logged, never sent.
