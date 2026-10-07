### Q1: Which keys are mirrored into `.env.example`, and with what placeholder value
Decision Q3 says Ship mirrors a changed `.env` into the sibling `.env.example` ("add or update keys with placeholder values, never the real secret values"). The baseline stores only content hashes, not content, so the helper cannot tell which keys the cycle added or changed. "Update" is also undefined for a placeholder: a key that already exists in `.env.example` has a value that is already a placeholder, and overwriting it would lose the developer's documented example. The placeholder format must be fixed because tests will assert the exact resulting file, and a wrong rule could leak a real value.
**Suggested:** Parse `.env` line by line (`KEY=value`, ignoring blank lines and `#` comments, optional `export ` prefix). For every key in `.env` that is missing from `.env.example`, append `KEY=` (empty value, no real value, no comment text copied from `.env`). Keys already present in `.env.example` are left untouched (their value and position unchanged). Keys that exist only in `.env.example` are never removed. Lines that do not parse as `KEY=value` are ignored.

**Answer:**

### Q2: Which sensitive files trigger mirroring, and what if `.env.example` does not exist
The decision says "a changed `.env` (at any depth)". The secret rule also covers `.env.*` (for example `.env.local`, `.env.production`), and the sibling `.env.example` may not exist. It is unclear whether `.env.local` also mirrors, whether the example is created when missing, and where "sibling" points (same directory as the changed file).
**Suggested:** Mirroring applies to a changed `.env` and any changed `.env.*` other than `.env.example`, at any depth, into `.env.example` in the same directory as the changed file (several sources in one directory merge into the same example, using the Q1 rules). If that `.env.example` does not exist it is created. Other sensitive files (`*.pem`, `*.key`, `*.p12`, `id_rsa*`, `*.keystore`) are never mirrored. The `.env` itself is still skipped with reason `sensitive file`.

**Answer:**

### Q3: Mirroring when the `.env` or the `.env.example` was already dirty before the run
Reason precedence puts `pre-existing local changes` first, so a `.env` that was modified before the run and changed again is skipped as pre-existing. It is unclear whether it is still mirrored. Likewise, if `.env.example` itself was already modified or untracked at baseline, appending to it and committing would mix the developer's own work into the commit, which the pre-existing rule exists to prevent.
**Suggested:** Mirror only from a `.env`/`.env.*` that is a cycle change (its path is not dirty at baseline); a pre-existing-dirty `.env` is skipped with `pre-existing local changes` and not mirrored. If the target `.env.example` was dirty at baseline (modified, staged or untracked) and the mirror would change it, do not write it; list `.env.example` in `skipped` with reason `pre-existing local changes`. If a mirror adds no new keys, the file is not touched and no entry is produced.

**Answer:**

### Q4: Where the mirroring runs, and what is reported
The brief gives `sdlc-changes.cjs changed` as a read-only JSON producer and `sdlc-ship.sh` as the orchestrator, with no step for mirroring. The new behaviour needs a defined place, interface and report so the tests and wiring are unambiguous. It also needs a rule for `.env` files ignored by `.gitignore`: those never appear in `changed`, so there is no cycle change to mirror.
**Suggested:** Add a third subcommand `node scripts/sdlc-changes.cjs mirror-env "$LOG/baseline.json"` that writes or updates `.env.example` files per Q1 to Q3 and prints the mirrored paths, one per line. `changed` stays read-only. `scripts/sdlc-ship.sh` runs `mirror-env` first, then `changed`, so the updated `.env.example` is picked up as an ordinary candidate and committed in the `feat(...)` commit (and counted in `Committed N`). The mirror runs only for `.env`/`.env.*` files that git reports (untracked, modified or deleted); `.gitignore`d ones are ignored entirely and nothing is created. A deleted `.env` triggers no mirroring. The mirrored paths are printed by the Ship stage and the body of `ship-skipped.md` is unchanged. Tests are added to `sdlc-changes.test.js` (mirror rules) and `sdlc-ship.test.js` (committed `.env.example` has no secret value, `.env` not committed).

**Answer:**
