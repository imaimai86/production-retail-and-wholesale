
## Round 1 (2026-10-06)

### Q1: Should the stored name be trimmed?
The existing helper `isNonEmptyString` rejects whitespace-only names but does not change the value. A request with `"  Bob "` is valid, so we must decide whether to store `"  Bob "` or `"Bob"`. This affects the response body and the tests.
**Suggested:** Accept it and store the trimmed value (`"Bob"`); the 201 response returns the trimmed name.
**Answer:** accept

### Q2: Is there a maximum length for `name`?
The `users.name` column is `TEXT NOT NULL` with no length limit, and the brief does not mention one. Without a limit, a very large name is accepted. A limit would be new behaviour that the brief does not ask for.
**Suggested:** No maximum length. Only a non-empty string (after trimming) is required.
**Answer:** accept

### Q3: How should unknown or legacy body fields (`username`, `password`, `role`) be handled?
Clients following the old docs send `username`, `password` and `role`. The route could ignore them (as `Users.create` does today) or reject them with 400. A request with a valid `name` plus extra fields currently works, and rejecting would break "a valid request keeps working". A request with only the old fields is already rejected for the missing `name`.
**Suggested:** Ignore unknown fields. Only `name` is read, and the 400 `name is required` response tells the old-docs client what to send.
**Answer:** accept

### Q4: Which docs need fixing besides the `POST /users` request body?
The `GET /users` swagger block in `server/index.js` also documents `username` and `role` in the response, but the table has only `id` and `name`. The brief scopes "the `POST /users` route and its docs", so the GET docs are not covered explicitly. `server/API.md` has only a one-line `POST /users` entry.
**Suggested:** Also correct the `GET /users` response schema to `id` and `name`, since it is the same wrong-field defect and the OpenAPI spec is regenerated anyway. Add the 400 response and the `name` request body to the `POST /users` docs, and remove the stray "Test update." text from the summary.
**Answer:** accept

### Q5: What error response shape and message should be used for invalid requests?
Existing routes (e.g. the inventory transfer route) return `400 { "error": "<field> is required" }`. The brief says only "a proper client error". The message wording is what the tests will assert.
**Suggested:** Follow the existing convention: `400 { "error": "name is required" }` when `name` is missing, null or empty or whitespace-only, and `400 { "error": "name must be a string" }` when it is present but not a string (e.g. a number or object). No user row is created in either case.
**Answer:** accept
