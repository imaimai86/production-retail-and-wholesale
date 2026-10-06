# add-db-health-check

Type: feature
Priority: P2 (normal)
Source: user request after a local setup failed with "SASL: client password must be a string"; no test or endpoint checks that the database connection works (`GET /` returns `{"status":"ok"}` without touching the database, `server/index.js:27`).

## Problem
There is no way for a developer, a container orchestrator or CI to tell whether the server can reach its database. A bad password or an unreachable host only shows up as a 500 on the first real request.

## Expected behaviour
`GET /health` runs `SELECT 1` through the existing pool and reports whether the database answered.

## Decisions
- Route: `GET /health` (HEAD works as a side effect of Express). No other methods.
- Success: HTTP 200, body `{ "status": "ok", "db": "up" }`.
- Failure (query rejects, or does not answer within the timeout): HTTP 503, body `{ "status": "error", "db": "down" }`.
- The body never contains an error message, code, host, user, SQL, stack or connection string. The real error is logged once with `console.error`.
- Timeout: 2000 ms (exported constant `HEALTH_TIMEOUT_MS`), implemented with `Promise.race` and a cleared timer, so a hung connection returns 503 instead of hanging the probe.
- Response header `Cache-Control: no-store` on both outcomes.
- No authentication: register the route after `GET /` and BEFORE `app.use(Auth.verify)` in `server/index.js`, so probes need no `x-auth-token`.
- The handler never calls `next(err)`; it always answers itself, so it does not depend on the error handler.
- Implementation lives in a new file `server/health.js` exporting `healthCheck` (the Express handler) and `HEALTH_TIMEOUT_MS`. It uses `db.query('SELECT 1')` from `server/models/db.js`. Do NOT add anything to the exports of `models/db.js` (another change asserts that it exports exactly `query` and `transaction`).
- OpenAPI: add a JSDoc block for `GET /health` (tag `Health`, responses 200 and 503, no auth) and regenerate `server/openapi-spec.json` with `npm run generate-spec`.
- `GET /` stays exactly as it is.

## Scope
- In: `server/health.js` (new), `server/index.js` (one `require` and one `app.get`), `server/openapi-spec.json` (regenerated), `server/API.md`.
- Out of scope: Dockerfile or orchestrator probe config, readiness vs liveness split, checking anything other than the database, changes to `models/db.js`, other routes.

## Tests
- New `server/__tests__/health.test.js` (supertest against `../index`, with `../models/db` mocked):
  - query resolves -> 200 and exactly `{ "status": "ok", "db": "up" }`.
  - query rejects with `new Error('password authentication failed for user "app"')` -> 503, body exactly `{ "status": "error", "db": "down" }`, and the response text does not contain `password`, `app` or `authentication`.
  - query never settles (use Jest fake timers) -> 503 after `HEALTH_TIMEOUT_MS`.
  - works without an `x-auth-token` header; `Cache-Control` is `no-store` in both outcomes.
  - the error is logged with `console.error` exactly once per failed check.
  - `GET /` still returns 200 `{ "status": "ok" }` without calling `db.query`.
- Add one case to `server/__tests__/docs/openapi-spec.test.js`: the spec has `GET /health` with responses 200 and 503.

## Docs
- `server/API.md`: add a Health section with both responses and the note that it needs no token.

## Open questions
- none
