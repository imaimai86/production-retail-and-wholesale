# Review 1: fix-stock-checks

Reviewed `git diff 34bac9c` against `specs-1.md`.

## Result
The implementation matches the spec: validation order, conditional decrements, 409/404 mapping, no-op on same status, restore/re-create on PATCH and DELETE, and the migration (merge before the unique constraint).

## Fixed
- `server/models/sales.js`: `updateStatus` and `remove` read the sale row without a lock. Two concurrent PATCH or DELETE requests on the same sale could both see the old status, so stock would be decremented or restored twice. Both now use `SELECT ... FOR UPDATE`, so the second request sees the committed state.

## Noted, not changed
- `product_id` is only checked for presence, so a non-integer value such as an object reaches Postgres and returns 500. The spec only requires missing or empty to return 400.
- A missing `price` or `gst` on POST /sales still fails on the NOT NULL `gst` column (500). This is pre-existing and out of scope.

`npm test`: 11 suites, 132 tests pass.
