# Test repair 1

Both claims verified: `scripts/sdlc-testcheck.cjs:107` emits `failing test is NOT claimed as a test defect (source bug, not test repair): <key>`, and specs-1.md L69 requires that message "exactly as today". `decisions.md` does not exist.

## server/__tests__/scripts/sdlc-testcheck.test.js

Both tests use the shared `NOT_CLAIMED` constant (line 30), so one change repairs both.

- **merge-retry a key that failed again stays failing and precheck rejects it**
- **merge-retry a key missing from the re-run JSON stays failing**

Wrong: the constant `failing test is NOT claimed as a test defect` plus `": "` omitted the parenthetical `(source bug, not test repair)`, so `toContain` could never match the unchanged precheck message.

Proof: specs-1.md L69 and criterion 3 (L80), plus the message at `sdlc-testcheck.cjs:107`.

Changed: `NOT_CLAIMED` is now `failing test is NOT claimed as a test defect (source bug, not test repair)`. No assertion was removed or loosened. Each assertion now matches a longer, stricter string. The two other `NOT_CLAIMED` assertions (lines 101 and 112, precheck tests) get the same stricter string.
