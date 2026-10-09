# add-jwt-login-acl

Type: feature
Priority: P2 (normal)
Source: user decision in the triage conversation: "Implement login and acl using jwt as a separate feature". Depends on `add-auth-token-table`, which must be done first.

## Problem
Authentication is a placeholder. `Auth.verify` (`server/middleware/auth.js`) accepts any non-empty `x-auth-token`, and the only access control is `Auth.requireAdmin`, which compares the header with `ADMIN_TOKEN` and guards only `/users`. There is no login, no password, no role, and no way for a sales or production staff member to get a token. `CLAUDE.md` plans JWT auth and accounts for admin, sales and production staff.

## Expected behaviour
- A user logs in with credentials and receives a signed JWT for a named client (for example `app` or `web`).
- Every issued JWT is recorded in `auth_tokens` (from `add-auth-token-table`), so one user can hold several tokens.
- Requests are authenticated by a valid JWT; an unknown or invalid token is rejected with 401.
- Endpoints are restricted by the user's role.

## Decisions
- JWTs are stored in `auth_tokens` as the SHA-256 hash of the token, with the client label, as set up by `add-auth-token-table`.
- `ADMIN_TOKEN` keeps working and maps to the `admin` user, so existing setups do not break.
- Failures use `{ "error": "<message>" }`; 401 for a missing, invalid or unknown token, 403 for a role that is not allowed.

## Scope
- In: login endpoint, JWT issue and verify, role checks on the existing endpoints, the user and token model changes the Spec stage settles.
- Out of scope: MFA, password complexity rules, audit logs (listed under future work in `Engineering/AGENTS.md`).

## Tests
- Unit tests in `server/__tests__/middleware/` and `server/__tests__/models/`, endpoint tests in `server/__tests__/index.test.js`, and integration tests in `server/__tests__/integration/` for login, token storage and role checks. The Spec stage fixes the cases.

## Docs
- `server/API.md`, `server/schema.md`, `README.md` (new env variables), swagger and `server/openapi-spec.json`.

## Open questions
- Where do passwords live? `users` has only `id` and `name`; a `password_hash` column and a hashing scheme (bcrypt or scrypt) are needed.
- Which roles exist (admin, sales, production?) and which role may call which endpoint?
- What is the JWT signing secret's env variable name, the token lifetime, and is there refresh, logout or revocation?
- Does `POST /users` start taking a password and role, and does that change the contract set by `fix-user-validation`?
- Should tokens issued before this feature (any string) stop working immediately?
