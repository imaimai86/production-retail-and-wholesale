# Plan: hide-internal-errors

Spec: `Docs/backlog/hide-internal-errors/specs-1.md`. No schema, model or openapi changes.

## Findings (graft + targeted reads)
- `server/index.js` is the only entry point. Order: `express.json()` (L24), `GET /` (L26), `Auth.verify` (L30), routes, then the `require.main === module` listen block (L823) and `module.exports = app` (L829). Last route is `GET /sales/:id/invoice` (ends L821).
- All route handlers use `try/catch -> next(err)`. `handleStockError` (L15-19) falls through to `next(err)` for non-stock errors (callers at L563, 680, 728, 759). It sends 409 and 404 itself, so those bodies are untouched.
- `express.json()` runs before `Auth.verify`, so a malformed JSON body reaches the error handler with `err.status === 400` even without an auth header. This gives the required 400 `Bad Request`.
- `server/middleware/` currently holds only `auth.js`, a class with static methods. The new file uses a plain exported function instead, since the spec asks for one function.
- Tests: `server/__tests__/middleware/` (has `auth.test.js`) and `server/__tests__/index.test.js`. The latter uses `jest.mock('../models/products', ...)` factories plus supertest and sets `ADMIN_TOKEN=secret`.

## Steps (in order)

### 1. Create `server/middleware/errorHandler.js`
- `const http = require('http');`
- `function resolveStatus(err)`:
  - Check `err.status`, then `err.statusCode`, and take the first value that is defined. Using only the first defined value is fine per spec ("Read status, then statusCode"). If `status` is present but invalid, fall through to `statusCode`.
  - Valid means `Number.isInteger(v) && v >= 400 && v <= 499`. Strings (`"400"`) and `400.5` fail `Number.isInteger`.
  - Otherwise return 500.
  - Guard against a non-object `err` (null, string) with `err && ...`.
- `function errorHandler(err, req, res, next)` (keep all 4 params so Express treats it as an error handler):
  1. `console.error(err && err.stack ? err.stack : err)`. The spec says log "the full error, including the stack", so pass the error itself: `console.error(err)`. Node prints the stack for Error objects. Red tests assert `console.error` was called with the error, so use `console.error(err)`.
  2. `if (res.headersSent) return next(err);`
  3. `const status = resolveStatus(err);`
  4. `const message = status >= 500 ? 'Internal server error' : http.STATUS_CODES[status];`
  5. `return res.status(status).json({ error: message });`
- Never read `err.message` or `err.code` when building the body.
- `module.exports = errorHandler;` and optionally `module.exports.resolveStatus` if tests want it. This is not required.

### 2. Register in `server/index.js`
- Add `const errorHandler = require('./middleware/errorHandler');` next to the `Auth` require (L12).
- Insert `app.use(errorHandler);` after the `GET /sales/:id/invoice` route (after L821) and before the `if (require.main === module)` block (L823).
- Leave `handleStockError`, the validation responses and all route code unchanged.

### 3. Docs: `server/API.md`
- Add a short "Errors" section at the end, or after the auth paragraph at L4-5, saying that unexpected errors return `500 { "error": "Internal server error" }`.
- Do not touch `openapi-spec.json` or the swagger comments.

### 4. Tests (written in the Red tests stage; listed here for completeness)
- `server/__tests__/middleware/errorHandler.test.js` (unit, mock req/res with `status` returning `res` and a `json` spy, `console.error` spied and silenced):
  - `status` and `statusCode` precedence.
  - Out-of-range and non-integer inputs: 302, 600, `"400"`, 400.5, missing.
  - 4xx and 5xx bodies, including 404 -> "Not Found" and 422 -> "Unprocessable Entity".
  - No `message`, `code`, SQL text or stack in the JSON payload.
  - `console.error` is called with the error.
  - `headersSent: true` -> `next(err)` is called and `res.status`/`res.json` are not.
- `server/__tests__/index.test.js` (supertest):
  - Make a mocked model throw `new Error('secret db detail')`, for example via `Products.getAll = jest.fn().mockRejectedValueOnce(...)`, then restore it. Assert 500, a JSON content type, body `{ error: 'Internal server error' }` and no `secret db detail`.
  - Send a malformed JSON `POST` with `Content-Type: application/json`. Assert 400 `{ error: 'Bad Request' }` and no `stack`/`SyntaxError`.
  - Silence `console.error` in these tests.

### 5. Verify
- Run `npm test` from the repo root.
- Confirm that the existing stock 409/404, validation 400, auth 401/403 and sale-not-found 404 tests pass unchanged.
- Run `git diff --stat` to confirm `openapi-spec.json` is untouched.

## Risks / notes
- `handleStockError` returns `err.message` for `INVENTORY_NOT_FOUND`. This is an explicit existing response, is out of scope per the spec, and must not change.
- The handler must be the last `app.use`. A later route or middleware would bypass it (acceptance criterion 7).
- The unknown-route default 404 page is out of scope.

## Files touched
| File | Change |
|---|---|
| `server/middleware/errorHandler.js` | new |
| `server/index.js` | 1 require + 1 `app.use` |
| `server/API.md` | short note |
| `server/__tests__/middleware/errorHandler.test.js` | new |
| `server/__tests__/index.test.js` | 2 added tests |
