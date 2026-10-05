The repair is valid. The original S-R10 failed because of a test-isolation defect, and the fix keeps every assertion and touches only S-R9.

**1. Was the original test wrong?** Yes, but the defect was in S-R9, which leaks state into S-R10. S-R10 itself is correct.
- S-R9 queues `Sales.create.mockRejectedValueOnce(INVENTORY_NOT_FOUND)` (`index.test.js:288`). It then posts `location: ''`, which must return 400 without calling the model. Spec §3 says: "Validation order. All 400 validation first, then 404, then 409." S-R9's own `expect(Sales.create).not.toHaveBeenCalled()` confirms the queued rejection is never consumed.
- `beforeEach` uses `jest.clearAllMocks()` (`index.test.js:93`). In Jest 29 that clears call records but not queued once-implementations, so the leftover rejection reaches S-R10's `post(valid)`. The route then maps `INVENTORY_NOT_FOUND` to 404 instead of 500.
- S-R10 expects 500 for an unexpected `Error('boom')`. The spec §9 error table gives only 400, 404 and 409 for the handled conditions, so an unknown error falling through to 500 is consistent with it. The failure-alone-passes claim fits this mechanism. I did not run the tests, and the repair note says it did not either.

**2. Is the new test equally strict?** Yes. In S-R9 the 400 assertion and the `Sales.create` not-called assertion are unchanged. They run before the added line, so the not-called check is still meaningful. The added line, `await expect(Sales.create(valid)).rejects.toMatchObject({ code: 'INVENTORY_NOT_FOUND' })`, drains the queued rejection. It also checks the rejection was actually queued. S-R10 is untouched.

**3. Any tricks?** No.
- No expected status or body was changed.
- No matcher was loosened.
- No case was removed, skipped or renamed.
- The test does not assert whatever the code returns.
- No source file was edited. The diff is one comment plus one assertion in a single test.

**4. Is the scope justified?** Yes. The diff is three added lines inside S-R9, which is the leaking test the claim names.

A global `mockReset` or a per-test cleanup would be a tidier fix. Draining the queue inline is still a legitimate, minimal change that weakens nothing.

VERDICT: VALID
