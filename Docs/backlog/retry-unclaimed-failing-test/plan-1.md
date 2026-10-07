# Plan: retry-unclaimed-failing-test

Based on `specs-1.md`. Graft (`graft_file_api`, `graft_find_all`) showed `scripts/sdlc-testcheck.cjs` is a flat CLI script with no importers: `results()` and `claims()` are only used inside it, and `precheck`, `namecheck` and `redcheck` call `results()`. `scripts/sdlc.sh` is a shell file that graft does not index, so I read only the lines I need (`jest_json_now` at L103, the Test repair block at L232-238, the header at L1-16). No source edits are made in this plan.

## Affected files
| File | Change |
|---|---|
| `scripts/sdlc-testcheck.cjs` | New subcommands `unclaimed`, `retry-plan` (the helper for criterion 8) and `merge-retry`. Small refactor of `results()`. Usage text. |
| `scripts/sdlc.sh` | New function `retry_unclaimed` and its call. Header comment line. |
| `README.md` | SDLC section: behaviour, WARNING text, `flaky-tests.md` line format. |
| `server/__tests__/scripts/sdlc-testcheck.test.js` | New. |
| `server/__tests__/scripts/sdlc-gates.test.js` | Extended with text checks (criterion 9). |

Checked, no change needed: `.gitignore` line 5 is `Docs/backlog/*/logs/`, so `$LOG/flaky-tests.md` and `$LOG/retry-*.json` are never added by `git add "$DOCS" "$TEST_DIR"` (criterion 12). `namecheck`, `redcheck`, `diffcheck` and `precheck` are untouched.

## Order of work
Tests come first, because the Red tests stage locks them. The order is below.

### Step 1: `scripts/sdlc-testcheck.cjs`
1. **Refactor `results()` (L17-30).** The key rule must be identical in `results()` and `merge-retry`, so extract two small helpers and make `results()` use them. Behaviour does not change.
   - `fileOf(f)` returns the existing `rel(path.relative(path.join(process.cwd(), 'server'), f.name) || f.name)` value.
   - `readJson(file)` returns the parsed JSON, or `null` on a read or parse error. It is used only for re-run files. `now.json` keeps the `JSON.parse` call that throws, as today.
2. **Add `retrySet(nowJson, issuesFile)`.** It returns an array of `results(nowJson).failed` keys that are not in `new Set(claims(issuesFile).map(x => x.key))`. It uses `claims()` unchanged, so a missing file means nothing is claimed.
3. **Add `unclaimed <now.json> <test-issues.md>`.** It prints each key of `retrySet`, one per line, and exits 0. Missing arguments give the usage message on stderr and exit 1. Add a small `usage(msg)` helper, like the one `resumecheck` has inline.
4. **Add `retry-plan` (the helper chosen for criterion 8).** It reads keys from stdin, which is the output of `unclaimed`, and splits each on the last `::`. For each distinct file it prints one line `<file>\t<pattern>`.
   - The pattern is empty (so the whole file runs without `-t`) if any key of that file has the name `<suite failed to run>`.
   - Otherwise the pattern is `^(?:` + names escaped and joined with `|` + `)$`, or just `^name$` for a single name.
   - Each name is escaped with `n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`.
   - Test names are already normalised, so they contain no tabs or newlines.
   - A custom named function `escapeRe` is exported through a `module.exports` guard only if the Red tests need it. Otherwise the tests go through the CLI, so no export is added.
5. **Add `merge-retry <now.json> <test-issues.md> <flaky-tests.md> <retry.json>...`.**
   1. Compute `retrySet`. If it is empty, exit 0 and write nothing.
   2. For each re-run path, call `readJson`. Skip `null` and any file with no `testResults` array. Build `passedKeys` and `failedKeys` over all re-run files from `results()`-style logic. Do this by factoring a `collect(json)` helper, used by both `results()` and `merge-retry`, that returns `{all, failed, passedFiles}`. `passedFiles` holds files whose entry has `status === 'passed'`, used for suite keys.
   3. For a named key, flaky means it is in some re-run's `all` and in none of the `failed` sets. For a `<file>::<suite failed to run>` key, flaky means the file is in some re-run's `passedFiles`. Anything else stays failing.
   4. Rewrite `now.json` in place. Reload it, walk `testResults`, and for each flaky named key set `a.status = 'passed'` on the matching assertion. For a flaky suite key set `f.status = 'passed'`. Write it with `JSON.stringify` to the same path. No other entry is touched. Claimed keys are never in `retrySet`, so they cannot be changed (criterion 4).
   5. If at least one key is flaky, `fs.appendFileSync(flakyFile, ...)` with one line per key in the form `<key> :: first run: failed :: re-run: passed`. For each flaky key also `console.log('WARNING: flaky test passed on re-run, not rejected: ' + key)`. If nothing is flaky, do not write `now.json` and do not create the file (criterion 7). Exit 0.
6. **Usage text.** Update the header comment (L3-8) with lines for `unclaimed`, `retry-plan` and `merge-retry`. Update the final `console.error` usage at L107 to list `unclaimed|retry-plan|merge-retry`.

### Step 2: `scripts/sdlc.sh`
1. **Add `retry_unclaimed` directly after `jest_json_now` (L103).** `CHECK` and `ROOT` are already defined by then, as used at L235. The function is:
   ```bash
   # retry_unclaimed: one-time re-run of the UNCLAIMED failing tests in now.json; merges flaky passes back into it.
   retry_unclaimed() {
     local keys n=0 file pat
     keys=$($CHECK unclaimed "$LOG/now.json" "$DOCS/test-issues.md") || return 1
     [ -n "$keys" ] || return 0
     rm -f "$LOG"/retry-*.json
     printf '%s\n' "$keys" | $CHECK retry-plan | while IFS=$'\t' read -r file pat; do
       n=$((n+1))
       if [ -n "$pat" ]; then (cd server && npx jest "$file" -t "$pat" --json --outputFile="$ROOT/$LOG/retry-$n.json" >/dev/null 2>&1) || true
       else (cd server && npx jest "$file" --json --outputFile="$ROOT/$LOG/retry-$n.json" >/dev/null 2>&1) || true; fi
     done
     $CHECK merge-retry "$LOG/now.json" "$DOCS/test-issues.md" "$LOG/flaky-tests.md" "$LOG"/retry-*.json
   }
   ```
   - The `rm -f` removes stale `retry-*.json` files from an earlier attempt. Otherwise the glob would pick up a leftover result.
   - The loop runs in a pipe subshell, so `n` does not survive it. That is fine, because the files are found by the glob.
   - `|| true` and the discarded output follow the `jest_json_now` style.
   - If no retry file was written (jest crashed), the glob is passed literally. `merge-retry` treats an unreadable path as no results, so the keys stay failing.
2. **Call it.** Insert `retry_unclaimed` right after `jest_json_now "$LOG/now.json"` (L232) and before the `FROM_N -eq 5` precheck (L233) and the second precheck (L238). Leave both `precheck` lines, including `"$MAX_REPAIR_TESTS"`, as they are. Do not touch `jest_json_now "$LOG/after.json"` (L250) or `success_check`.
3. **Header comment.** Add one line after L8 or in the Env block, for example: `#        Test repair re-runs UNCLAIMED failing tests once; a pass is a flaky test: WARNING, listed in $LOG/flaky-tests.md, not rejected.`
4. No new environment variable, no opt-out switch, no new executable file.

### Step 3: `README.md`
Add a short subsection or paragraph to the SDLC section, near "SDLC pipeline: integration tests" (L73) or the Test repair text. It covers:
- The one-time re-run of unclaimed failing tests in the Test repair stage.
- The stdout line `WARNING: flaky test passed on re-run, not rejected: <key>`.
- The `flaky-tests.md` line format `<key> :: first run: failed :: re-run: passed`, and that it is written to `Docs/backlog/<slug>/logs/` and is git-ignored.
- That a test that fails again, or is missing from the re-run, is rejected as today.

### Step 4: tests
**New `server/__tests__/scripts/sdlc-testcheck.test.js`.** It follows the style of `sdlc-gates.test.js`: `fs`, `path`, `spawnSync`, and `root = path.resolve(__dirname, '../../..')`.
- Build a temp dir with `fs.mkdtempSync`. Helper `jestJson(entries)` writes a minimal jest JSON of the form `{testResults:[{name: <abs path under root/server/__tests__>, status, assertionResults:[{fullName, status}]}]}`. Helper `run(args)` calls `node scripts/sdlc-testcheck.cjs ...` with `cwd: root`.
- Cover criteria 1-6 and 8:
  - `unclaimed` prints only the unclaimed failing keys, and prints nothing when all failures are claimed or the claim file is missing.
  - `merge-retry` marks a passed key as passed, appends the exact flaky line, and prints the WARNING.
  - `merge-retry` leaves a key that failed again, or is missing from the re-run, failing, and `precheck` on the merged file exits 1 with the `NOT claimed` message.
  - `merge-retry` leaves a claimed failing key unchanged even when it passes in the re-run, and does not list it.
  - `precheck` exits 0 when every unclaimed failure was flaky, with valid claims (the reason text contains "spec").
  - All other entries of `now.json` are deep-equal before and after, except the flaky status.
  - `flaky-tests.md` is not created when nothing is flaky.
  - A suite-failed-to-run key becomes passed.
  - An unparseable or non-existent re-run file does not crash and the keys stay failing.
  - `retry-plan` with names containing `(`, `.` and `[` gives an anchored, escaped pattern, and `new RegExp(pattern)` matches the original name and not a near-miss. Several names in one file give an alternation. A suite key gives an empty pattern.
  - Missing arguments for `unclaimed` and `merge-retry` give exit 1 with usage on stderr.

**Extend `server/__tests__/scripts/sdlc-gates.test.js`** (criterion 9) using the existing `lines` and `lineWith`:
- A `retry_unclaimed` definition exists.
- The index of the `retry_unclaimed` call line, the first line that matches `^\s*retry_unclaimed\s*$`, is greater than the index of the `jest_json_now "$LOG/now.json"` line and less than the index of the first line containing `precheck "$LOG/now.json"`.
- Every `precheck "$LOG/now.json"` line still contains `MAX_REPAIR_TESTS`.
- The function body contains `npx jest`, ` -t `, `--json --outputFile`, `|| true` and `merge-retry`.
- No executable-bit assertion is made.

## Verification
- `npm test` from the repo root.
- Manual check: run `node scripts/sdlc-testcheck.cjs unclaimed <fixture> <claims>` and `merge-retry` on a fixture.
- `bash -n scripts/sdlc.sh` for a syntax check.

## Risks and notes
- **Rule consistency.** Using the shared `fileOf`, `norm` and `collect` for both the first run and the re-run prevents a key mismatch, for example `__tests__/...` against `server/__tests__/...`.
- **`-t` and fullName.** Jest's `fullName` joins describe and test titles with spaces, and `norm` only collapses `›` and whitespace. The anchored full-name pattern therefore matches the single test. A test name that `norm` altered (for example one that contains a literal `›`) will not match, so it stays failing and is rejected as today. This is safe and needs no extra handling.
- **No `local` in the pipe subshell issue.** `n` is only used for file names inside the subshell, so there is no dependence on it afterwards.
- **FROM=test-repair precheck.** Because `retry_unclaimed` runs before it, a flaky failure no longer aborts that early check, as the spec requires.
