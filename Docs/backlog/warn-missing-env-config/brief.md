# warn-missing-env-config

Type: feature
Priority: P2 (normal)
Source: user report: `POST /users` with header `x-auth-token: change-me` returned `{"error":"Forbidden"}`. (The request body in that report also uses `username`, `password` and `role`; that part is already covered by `fix-user-validation`.)

## Problem
Verified by checking the file system and reading the code (no live request was sent):
- The server loads `<repo root>/.env` with `require('dotenv').config({ path: path.join(__dirname, '..', '.env') })` (`server/index.js:3`) and ignores the result. If the file does not exist, dotenv returns `{ error }` and nothing is printed.
- `requireAdmin` compares the header to `process.env.ADMIN_TOKEN` (`server/middleware/auth.js:13`). With no `.env`, `ADMIN_TOKEN` is `undefined`, so every request gets 403 `Forbidden`, whatever token is sent, with no log line and no hint.
- In the reported case the repo-root `.env` did not exist (a `server/.env` did, which the server never reads), so the correct token was rejected and nothing explained why.

## Expected behaviour
When the server is started, it prints a clear warning if the repo-root `.env` file is missing or `ADMIN_TOKEN` is not set, so the cause of a 403 on `/users` is visible immediately. No request or response behaviour changes.

## Decisions
- New `server/config/envCheck.js` exporting `checkEnvConfig(dotenvResult, env, warn)`. `warn` defaults to `console.warn` (a later change, `add-json-logging`, will route it through the logger). It returns the list of warning strings it printed.
- `server/index.js` keeps the result of the dotenv call (`const dotenvResult = require('dotenv').config(...)`) and calls `checkEnvConfig(dotenvResult, process.env)` ONLY inside the existing `if (require.main === module)` block, so requiring `index.js` (tests, tools) prints nothing.
- Warning 1, when `dotenvResult.error` has `code === 'ENOENT'`: `WARNING: no .env file found at <absolute path of the repo-root .env>. Copy .env.example to .env in the repo root (not server/) and restart.` For any other dotenv error: `WARNING: could not read .env (<error code>)`.
- Warning 2, when `process.env.ADMIN_TOKEN` is undefined or an empty string: `WARNING: ADMIN_TOKEN is not set; POST /users and GET /users will reject every request with 403.`
- Both warnings can appear together. Each is printed once, at startup, before the "Server listening" line.
- The server does not exit and the HTTP responses (including the 403 body `{ "error": "Forbidden" }`) are unchanged.
- No variable value is ever printed. The `.env` path is not a secret and may be printed.
- Do not check `DATABASE_URL` or the `PG*` variables here.
- Docs: add a short "Troubleshooting" section to `README.md`: a 403 on `/users` means `ADMIN_TOKEN` is unset or different from the `x-auth-token` header; `.env` must be in the repo root; `server/.env` is not read; the file is read only at startup, so restart after editing. Add one comment line to `.env.example` saying it belongs in the repo root.

## Scope
- In: `server/config/envCheck.js` (new), `server/index.js` (capture the dotenv result and one call), `README.md`, `.env.example` (comment only).
- Out of scope: any change to `middleware/auth.js`, to response bodies or status codes, request logging (that is `add-json-logging`), real authentication (JWT, roles), `fix-user-validation`, checking other variables.

## Tests
- New `server/__tests__/config/envCheck.test.js` (pure unit tests, `warn` is a jest mock): ENOENT error -> one warning that contains the given path and `.env.example`; another error code -> `could not read .env (EACCES)`; `ADMIN_TOKEN` undefined -> the ADMIN_TOKEN warning; `ADMIN_TOKEN` empty string -> the same warning; `ADMIN_TOKEN` set and no dotenv error -> no warnings and an empty return list; both problems -> two warnings in the order file first, token second; no warning text ever contains the token value (use `ADMIN_TOKEN=s3cr3t-value` in one case with an unrelated error present).
- Add to `server/__tests__/index.test.js`: requiring `../index` does not call `console.warn` (spy), even when `ADMIN_TOKEN` is unset.
- Add a wiring assertion (text check of `server/index.js`): `checkEnvConfig` is called inside the `require.main === module` block and not at top level.

## Docs
- `README.md` (Troubleshooting section) and the comment in `.env.example`.

## Open questions
- none
