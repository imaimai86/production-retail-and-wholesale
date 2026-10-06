# hide-internal-errors

Source: Engineering/bugs.md ("Unhandled errors return an HTML stack trace").

There is no error-handling middleware, so Express's default handler returns an HTML page with the stack trace and absolute file paths for any error passed to `next(err)`. Add a final JSON error handler so internal details are never sent to the client.

## Decisions
- Add one error-handling middleware `(err, req, res, next)` registered after all routes in `server/index.js` (and before `app.listen` / `module.exports`). It may live in a new file such as `server/middleware/errorHandler.js` and be required from `index.js`.
- Status: use `err.status` or `err.statusCode` when it is an integer from 400 to 499; otherwise 500.
- Body: always JSON.
  - 5xx: `{ "error": "Internal server error" }`.
  - 4xx: `{ "error": "<standard HTTP status text>" }`, using `http.STATUS_CODES[status]` (for example 400 -> "Bad Request"). Never put `err.message` in the body. Malformed JSON request bodies (body-parser SyntaxError, status 400) must therefore return `{ "error": "Bad Request" }`.
- Never include the stack, message, `err.code`, file paths or SQL details in any response, in every environment (no NODE_ENV switch).
- Log the full error server-side with `console.error` (including the stack) for every handled error.
- If `res.headersSent` is true, delegate with `next(err)` and do not write a response.
- Existing explicit error responses are unchanged (`handleStockError` 409/404 bodies, validation 400s, the 401/403 auth bodies, sale-not-found 404s).
- Unknown routes (Express's default "Cannot GET /x" 404 page) are out of scope.
- Docs: add a short note to `server/API.md` that unexpected errors return `500 { "error": "Internal server error" }`. Do not regenerate or change `openapi-spec.json`.
- Tests: add `server/__tests__/middleware/errorHandler.test.js` (unit, with mock req/res) and cases in `server/__tests__/index.test.js` using supertest: a model that throws `new Error('secret db detail')` returns 500 JSON with the generic message and the body does not contain "secret db detail"; malformed JSON body returns 400 JSON `{ "error": "Bad Request" }` without a stack.
