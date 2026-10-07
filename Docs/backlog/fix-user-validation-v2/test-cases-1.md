# Test cases: fix-user-validation-v2

Tests are written first and fail until the Implement stage. Admin token = `ADMIN_TOKEN`. `Users.create` is a `jest.fn` in the model mock.

## Route: `server/__tests__/index.test.js` (`POST /users validation`)

| ID | Request | Expected | `Users.create` | AC |
|---|---|---|---|---|
| U-1 | `{"name":"Asha"}` | 201 `{id, name:"Asha"}` | called once | 1, 3 |
| U-2 | `{"name":"  Asha  "}` | 201, name `Asha` | called with `{name:'Asha'}` | 3 |
| U-3 | name plus `username`, `password`, `role` | 201 `{id, name}` only | called with exactly `{name:'Asha'}` | 3 |
| U-4 | same name posted twice | both 201 | called twice | 1 |
| U-5 | `{}`, `{username:'a'}`, `{name:null}`, `{name:''}`, `{name:'   '}`, no body, empty body, `[]`, `"text"`, `null` | 400 `name is required` | not called | 1, 2 |
| U-5 | `{name:123}`, `{name:{}}`, `{name:[]}`, `{name:true}` | 400 `name must be a string` | not called | 1, 2 |
| U-5 | malformed JSON `{bad` | 400 `Bad Request` | not called | 1, 2 |
| U-6 | no token, body `{}` | 401 `Unauthorized` | not called | 4 |
| U-7 | non-admin token, body `{}` | 403 `Forbidden` | not called | 4 |
| U-8 | valid body, model rejects | 500 `Internal server error` | called | 5 |

The existing `create and list users` test must keep passing.

Note: `"text"` and `null` bodies may be rejected by `express.json` strict mode as `Bad Request`; if U-5 fails for those, the Implement stage sets `express.json({ strict: false })` (plan step 1).

## Docs

| ID | File | Check | AC |
|---|---|---|---|
| D-1 | `server/__tests__/docs/openapi-spec.test.js` | `POST /users` summary is `Create a new user` | 6 |
| D-2 | same | request schema has only `name` (string), `required` includes `name`, no `username`/`password`/`role` | 6 |
| D-3 | same | responses are exactly `201, 400, 401, 403, 500` | 6 |
| D-4 | same | committed `openapi-spec.json` equals the freshly generated spec (swagger-jsdoc, same options as `npm run generate-spec`) | 6 |
| D-5 | same | `API.md` `POST /users` line has `name is required`, `name must be a string` and says other fields are ignored | 7 |
| D-6 | `server/__tests__/engineering/bugs.test.js` | the `POST /users` docs entry heading in `Engineering/bugs.md` says fixed | 7 |

## Review items (not tested)
- AC 8: `npm test` passes from the repo root (run by the pipeline).
- Integration: check `api.integration.test.js` sends a valid `name` if it posts to `/users`.
- Swagger comment in `server/index.js` drops "Test update." and notes other fields are ignored (covered indirectly by D-1 to D-4).
