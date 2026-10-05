# Test repair 1

## server/__tests__/index.test.js :: POST /sales validation and errors › S-R10 an unexpected error returns 500

**Claim verified:** yes, a test-isolation defect, not a source defect.

**What was wrong:** S-R9 queues `Sales.create.mockRejectedValueOnce(INVENTORY_NOT_FOUND)`, but the route returns 400 on `location: ''` before calling the model (spec section 3: validation first, then 404). The queued once-value is never consumed. `beforeEach` uses `jest.clearAllMocks()`, which does not drop queued once-implementations, so S-R10's `post(valid)` got the leaked INVENTORY_NOT_FOUND and returned 404 instead of 500.

**Proof:** spec section 3 (validation order) and section 9 (unknown errors are not 400/404/409, so they fall through to 500). S-R10 expects 500 for an unexpected `Error('boom')`, and this is correct.

**Change (S-R9 only):** all existing assertions are untouched (400 status, `Sales.create` not called). After them I added one assertion, `await expect(Sales.create(valid)).rejects.toMatchObject({ code: 'INVENTORY_NOT_FOUND' })`. It consumes the unused queued rejection so it cannot leak, and it also checks that the rejection really was queued. S-R10 is unchanged. No test was deleted, renamed, skipped or weakened, and no source file was edited.

**Verification:** not run. The sandbox required approval for `npx jest`. Run `npm test` from the repo root to confirm.
