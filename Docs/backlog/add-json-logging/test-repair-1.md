# Test repair 1

## server/__tests__/index.test.js :: global error handler › E-R1..4

- **What was wrong:** the test spied on `console.error` and asserted `expect(errorSpy).toHaveBeenCalledWith(err)`. specs-1.md §6 says "`console.error(err)` is replaced by one logger entry per error", and §14 says no `console.*` calls remain in `errorHandler.js`. The assertion therefore tested behaviour the spec removes. The claim is valid.
- **What I changed:**
  - Removed the `console.error` spy in the `global error handler` describe. It now swaps `loggerModule.logger` for `createLogger(inMemorySink)` in `beforeEach` and restores it in `afterEach`. This is the same pattern as the `logging` describe (specs-1.md §4.6).
  - Replaced `expect(errorSpy).toHaveBeenCalledWith(err)` with a check that the sink holds at least one parsed entry with `severity === 'ERROR'` whose `message` contains both `secret db detail` and `err.stack`. This still asserts that the error is logged server-side (E-R2), and checks more than the old assertion did (severity, message and stack).
- All other assertions (status, body, content-type, no leakage) are unchanged. The `global error handler` tests pass.
