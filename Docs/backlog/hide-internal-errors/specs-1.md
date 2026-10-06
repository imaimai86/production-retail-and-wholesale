# Spec: hide-internal-errors

Source: Engineering/bugs.md ("Unhandled errors return an HTML stack trace"); brief.md.

## Problem
No error-handling middleware exists, so any error passed to `next(err)` is rendered by Express's default handler as an HTML page containing the stack trace and absolute file paths. Internal details must never reach the client.

## Behaviour

### Registration
- One error-handling middleware with signature `(err, req, res, next)`.
- Registered in `server/index.js` after all routes and before `app.listen` / `module.exports`.
- May live in `server/middleware/errorHandler.js` and be required from `index.js`.

### Handling order
1. Log the full error server-side with `console.error`, including the stack, for every error the handler receives.
2. If `res.headersSent` is true: call `next(err)` and write no response.
3. Otherwise determine the status and send a JSON response.

### Status selection
- Read `err.status`, then `err.statusCode`.
- If the value is an integer from 400 to 499 inclusive, use it.
- Anything else (missing, non-integer, string, <400, 3xx, 5xx, >499) results in 500.

### Response body
Always JSON (`application/json`).

| Resolved status | Body |
|---|---|
| 5xx (always 500) | `{ "error": "Internal server error" }` |
| 4xx | `{ "error": http.STATUS_CODES[status] }`, e.g. 400 -> `"Bad Request"` |

- `err.message` is never placed in the body.
- No stack, message, `err.code`, file paths or SQL details appear in any response, in every environment (no `NODE_ENV` switch).
- Malformed JSON request bodies (body-parser SyntaxError, status 400) return 400 `{ "error": "Bad Request" }`.

## Unchanged behaviour
- Existing explicit error responses: `handleStockError` 409/404 bodies, validation 400s, 401/403 auth bodies, sale-not-found 404s.
- Unknown routes (Express's default "Cannot GET /x" 404 page) are out of scope.
- `openapi-spec.json` is not regenerated or changed.

## Inputs / Outputs
- Input: any error reaching the Express error pipeline (`next(err)`, a thrown synchronous error in a handler, or a body-parser error).
- Output: JSON response as above, plus a `console.error` log entry containing the full error and stack.

## Error cases
- Model throws `new Error('secret db detail')` -> 500 `{ "error": "Internal server error" }`; body does not contain `secret db detail`.
- Malformed JSON body -> 400 `{ "error": "Bad Request" }`, no stack.
- Error with `status: 404` -> 404 `{ "error": "Not Found" }`.
- Error with `statusCode: 422` and no `status` -> 422 `{ "error": "Unprocessable Entity" }`.
- Error with `status: 302`, `status: 600`, `status: "400"`, `status: 400.5` -> 500 generic body.
- Error with a `message`, `code` or SQL text -> none of it in the response.
- Headers already sent -> `next(err)` called, `res.status`/`res.json` not called.

## Documentation
Add a short note to `server/API.md` that unexpected errors return `500 { "error": "Internal server error" }`.

## Tests
- `server/__tests__/middleware/errorHandler.test.js` (unit, mock req/res): status selection (status, statusCode, out-of-range, non-integer), 4xx and 5xx bodies, no message/stack/code leakage, `console.error` called with the error, `headersSent` delegates to `next(err)` without writing.
- `server/__tests__/index.test.js` (supertest): a model that throws `new Error('secret db detail')` returns 500 JSON with the generic message and body lacks `secret db detail`; malformed JSON body returns 400 `{ "error": "Bad Request" }` without a stack.

## Acceptance criteria
1. A request that triggers an unexpected error returns `Content-Type` JSON and `500 { "error": "Internal server error" }`, not HTML.
2. A malformed JSON body returns `400 { "error": "Bad Request" }`.
3. No response body from the handler contains a stack, `err.message`, `err.code`, file path or SQL detail.
4. Errors with an integer `status`/`statusCode` in 400-499 return that status with `http.STATUS_CODES` text; all other values return 500.
5. Every handled error is logged via `console.error` with its stack.
6. When `res.headersSent` is true, the handler calls `next(err)` and writes nothing.
7. The middleware is registered after all routes in `server/index.js`.
8. Existing explicit error responses and their tests pass unchanged; `npm test` passes.
9. `server/API.md` contains the note; `openapi-spec.json` is unchanged.
