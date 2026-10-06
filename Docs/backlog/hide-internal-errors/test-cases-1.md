# Test cases: hide-internal-errors

Spec: `specs-1.md`. Plan: `plan-1.md`.

Files:
- Unit: `server/__tests__/middleware/errorHandler.test.js` (mock req/res, `console.error` spied)
- Integration: `server/__tests__/index.test.js`, `describe('global error handler')` (supertest)

## Unit matrix (errorHandler)

| ID | Scenario | Expected | AC |
|---|---|---|---|
| EH-01 | Function arity | 4 parameters | 7 |
| EH-02 | Plain `Error` | 500 `{error:'Internal server error'}` | 1 |
| EH-03 | `status: 404` | 404 `Not Found` | 4 |
| EH-04 | `statusCode: 422`, no `status` | 422 `Unprocessable Entity` | 4 |
| EH-05 | `status: 400` and `statusCode: 404` | `status` wins: 400 | 4 |
| EH-06 | `status: 'abc'`, `statusCode: 403` | falls through to 403 | 4 |
| EH-07 | 4xx values 400, 401, 403, 404, 409, 418, 422, 429, 499 | that status, `http.STATUS_CODES` text | 4 |
| EH-08 | Invalid `status`: 302, 399, 500, 503, 600, 0, -404, `"400"`, 400.5, NaN, Infinity, null, true, `{}` | 500 generic | 4 |
| EH-09 | `statusCode: '422'` (string) | 500 generic | 4 |
| EH-10 | Error is null, undefined, a string or a number | 500 generic, no throw | 1 |
| EH-11 | Error with message, `code`, `detail`, SQL, stack | body is exactly the generic one; none of it present | 3 |
| EH-12 | 4xx error with message and `code` | only the status text | 3 |
| EH-13 | Any response | body has the single key `error` | 3 |
| EH-14 | `NODE_ENV` development, production, test, unset | identical generic body | 3 |
| EH-15 | Normal handling | one `status`, one `json`, `next` not called | 1 |
| EH-16 | Any error | `console.error` called once with the error | 5 |
| EH-17 | 4xx error | also logged | 5 |
| EH-18 | `headersSent` true | still logged | 5 |
| EH-19 | `headersSent` true | `next(err)` called; `status`/`json` not called | 6 |
| EH-20 | `headersSent` true with 4xx error | same delegation | 6 |

## Integration matrix (supertest)

| ID | Scenario | Expected | AC |
|---|---|---|---|
| E-R1 | `Products.getAll` rejects `Error('secret db detail')` | 500, JSON content type, generic body, no `secret db detail`, no HTML/`.js` | 1, 3 |
| E-R2 | Same | `console.error` called with the error | 5 |
| E-R3 | Error with `code` 23505 and SQL detail | none in response text | 3 |
| E-R4 | Rejected error with `status: 404` | 404 `{error:'Not Found'}`, message hidden | 4 |
| E-R5 | Malformed JSON body with auth | 400 JSON `{error:'Bad Request'}`, no stack/SyntaxError | 2, 3 |
| E-R6 | Malformed JSON body without auth header | 400 `Bad Request` (body parser runs before auth) | 2 |
| E-R7 | `GET /products` without token | 401 unchanged | 8 |
| E-R8 | Transfer with no stock | 409 `Insufficient stock` unchanged | 8 |
| E-R9 | Last layer on `app._router.stack` | handler of arity 4 | 7 |

## Not covered by Jest
- AC 8 (full suite passes unchanged) is checked by running `npm test`.
- AC 9 is checked by reading `server/API.md` and running `git diff --stat` to confirm `openapi-spec.json` is untouched. The `API.md` note is a doc edit with no test.
- Unknown-route default 404 page is out of scope.

## Expected Red state
Before implementation `server/middleware/errorHandler.js` does not exist, so the unit file fails at require. In `index.test.js` E-R1 to E-R6 and E-R9 fail (HTML 500/400 responses). E-R7 and E-R8 pass already as regression guards.
