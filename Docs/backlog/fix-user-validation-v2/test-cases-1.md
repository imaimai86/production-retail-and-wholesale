# Test cases: fix-user-validation-v2

Spec: `specs-1.md`. Plan: `plan-1.md`. All tests mock `Users`; none need a database.

## Route tests: `server/__tests__/index.test.js`, `describe('POST /users validation')`
`Users.create` is now a `jest.fn`, so calls and arguments are asserted.

| ID | Criterion | Input | Expected |
|---|---|---|---|
| T-U1 | 1 | `{name:'Bob'}` + admin | 201, name `Bob`, numeric id, `create` called once |
| T-U2 | 2 | `{name:'  Bob '}` | 201, `create` called with `{name:'Bob'}`, response name `Bob` |
| T-U3 | 3 | valid name + `username`, `password`, `role` | 201, `create` called with exactly `{name}`, no extra fields in response |
| T-U4 | 4 | `{}`, no body, `null`, `''`, `'   '`, tab/newline only, legacy fields only | 400 `{error:'name is required'}`, `create` not called |
| T-U5 | 5 | `5`, `0`, `true`, `false`, `{}`, `['Bob']` | 400 `{error:'name must be a string'}`, `create` not called |
| T-U6 | 6 | 10,000-char name | 201, name returned in full |
| T-U7a | 7 | no token, body `{}` | 401 `Unauthorized` (not 400), `create` not called |
| T-U7b | 7 | non-admin token, body `{name:5}` | 403 `Forbidden` (not 400), `create` not called |
| T-U8 | error table | `create` rejects | 500 via the error handler |
| existing | 12 | "create and list users" | unchanged, still passes |

## Spec tests: `server/__tests__/docs/openapi-spec.test.js`
| ID | Criterion | Check |
|---|---|---|
| T-S1 | 8 | `POST /users` request schema: `name` string, required; no `username`/`password`/`role` |
| T-S2 | 8 | responses include 201 and 400; summary is `Create a new user`, no "Test update" |
| T-S3 | 8 | 201 schema: `id` integer, `name` string |
| T-S4 | 9 | `GET /users` 200 item properties are exactly `id`, `name` |
| T-S5 | 10 | fresh `swagger-jsdoc` output (same options as the generator script) deep-equals the committed `openapi-spec.json` |
| T-S6 | docs 4 | `API.md` contains `name is required` and `name must be a string` |

## Review items (not unit-testable here)
- Criterion 11: `Engineering/bugs.md` marks the `POST /users` docs entry as fixed and leaves the other entries untouched. Check by reading the diff.
- Criterion 10, cross-check: `npm run generate-spec` in `server/`, then `git diff --exit-code server/openapi-spec.json`.
- Criterion 12: `npm test` from the repo root, and `bash scripts/sdlc-integration.sh`.
- The `server/openapi-spec.json` diff touches only the `/users` entries.
- The Swagger summary has no stray text and no 401/403 blocks were added.
