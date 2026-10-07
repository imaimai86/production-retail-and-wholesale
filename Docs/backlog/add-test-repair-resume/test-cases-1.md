# Test cases: add-test-repair-resume

Tests: `server/__tests__/scripts/sdlc-test-repair-resume.test.js` (new) and `server/__tests__/scripts/sdlc-manual-input.test.js` (updated for the six-value `FROM` list and message). `sdlc-mod.test.js` needs no change (it asserts no `FROM` list). Test kinds: **exec** = runs the code (`resumecheck` on a temporary git repo, or `sdlc.sh` in a temporary copy with a fake `claude`), **text** = asserts on the text of `scripts/sdlc.sh` (the source under test, never a test file).

## Matrix

| ID | AC / spec | Kind | Case | Expected |
|---|---|---|---|---|
| T1 | AC3 | exec | red commit, valid claim, tests untouched, implementation commit | exit 0, empty stdout and stderr |
| T2 | AC3, S4.4 | exec | implementation is an uncommitted tracked change | exit 0 |
| T3 | AC3, S4.4 | exec | implementation is an untracked non-ignored file | exit 0 |
| T4 | AC4, S4.1 | exec | empty SHA (no red commit) | exit 1, one `REJECT:` naming the slug; claim check still evaluated (a missing claim adds a second reject) |
| T5 | AC4, S4.2 | exec | claim file missing | exit 1, reject mentions missing |
| T6 | AC4, S4.2 | exec | claim file empty | exit 1, reject mentions empty |
| T7 | AC4, S4.2 | exec | claim file without valid `<file> :: <name> :: <reason>` lines | exit 1, reject mentions no valid claim |
| T8 | AC4, S4.3 | exec | a test file modified | exit 1, path listed, exact restore command printed, file not restored |
| T9 | AC4, S4.3 | exec | untracked test file | exit 1, path and exact restore command, file kept |
| T10 | S4.3 | exec | git-ignored untracked file under `server/__tests__` | exit 0 (ignored files excluded) |
| T11 | AC4, S4.4 | exec | no change since red commit | exit 1, "no implementation change" |
| T12 | AC4, S4.4 | exec | only `Docs/` changes (committed and uncommitted) | exit 1, "no implementation change" |
| T13 | AC5 | exec | empty claim + modified test + no implementation | exit 1, at least three `REJECT:` lines, all reasons present |
| T14 | AC6, S4.6 | exec | repair commit after the red commit | exit 1, `REJECT: test repair was already accepted in commit <sha>: use FROM=review` |
| T15 | S4.6 | exec | repair commit of another slug | exit 0 (no false positive) |
| T16 | S5 | exec | read-only | repository status and HEAD unchanged after rejects |
| T17 | S5 / plan 1.5 | exec | unknown SHA | exit 1, `REJECT:` line, no stack trace |
| T18 | S5 | exec | missing arguments | non-zero exit, usage message |
| T19 | plan 1.1 | exec | unknown command usage text | lists `resumecheck` |
| T20 | AC1, S2 | exec | `FROM` = `bogus`, `Implement`, `test_repair`, `TEST-REPAIR`, `Review` in a copy laid out as `<tmp>/scripts/sdlc.sh` | exit 1, exact message with all six values, directory holds only `.git` and `scripts`, no branch created |
| T21 | AC2 | exec | each of the six valid values | no "unknown FROM"; proceeds to the `brief.md` check |
| T22 | AC11 | exec | `bash -n` on `sdlc.sh` and `sdlc-mod.sh` | exit 0 |
| T23 | AC7 | exec | `FROM=test-repair`, no red commit and no claim | exit 1, `REJECT:` lines, fake `claude` never called, HEAD unchanged |
| T24 | AC7, S4.3 | exec | `FROM=test-repair`, tests modified and an untracked test file | exit 1, restore command printed, nothing restored, no agent |
| T25 | AC7, S3.6 | exec | `FROM=test-repair`, no implementation change | exit 1, claim file still present and unchanged, no agent |
| T26 | AC1 | text | validation line precedes the first `git` call and the first `mkdir` | order holds |
| T27 | S2 | text | unknown-value message | exact six-value text |
| T28 | S2 | text | stage numbering | `implement=4, test-repair=5, review=6` |
| T29 | S9 | text | header comment | lists the six `FROM` values |
| T30 | S3.3 | text | red commit lookup for `test-repair` | uses the red-tests grep only, not the repair pattern |
| T31 | AC10, S7 | text | WARNING line | exact text, placed before `rm -f "$DOCS/test-issues.md"` |
| T32 | AC8, S3.2 | text | Implement stage and `rm -f` | inside an `-le 4` guard nested in the outer block, so `test-repair` skips them |
| T33 | S3.8 | text | Test repair block guard | outer guard is `-le 5` |
| T34 | S2 | text | review comparison | uses `-eq 6` |
| T35 | AC9, S6 | text | hint | exact text; `hint` passed for `claims fail pre-check` and `auditor failed to run`; absent from every verdict rejection |
| T36 | S4.5 | text | up-front pre-check failure | `REJECT: claims would not pass the pre-check` present |
| T37 | AC2 | exec | `sdlc-manual-input.test.js`: message and six accepted values | updated expectations |

## Not covered by an automated test (reasons)

- AC8 full run (status stage `Test repair`, `red.json` regeneration, repair block, then Review and Ship) and AC9 runtime hint behaviour need real jest runs and agents. They are covered by the text checks T30-T35 and by the manual dry run in plan step 8.3 in a scratch clone.
- AC10 runtime: that the file is still deleted after the WARNING needs the Implement loop (agents); covered by T31 and the unchanged `rm -f`.
- AC11 `sdlc-mod.sh` pass-through, header comment and `README.md` text: the pass-through is existing behaviour (`sdlc-mod.test.js` passes `FROM` through); documentation wording is a review item below.

## Review items (no automated test)

- R1. `README.md` SDLC section lists the six `FROM` values and describes the `FROM=test-repair` preconditions, the printed-but-never-run restore command and the `FROM=implement` warning.
- R2. `scripts/sdlc-mod.sh` header comment (line 19 area) lists `spec|plan|red-tests|implement|test-repair|review`.
- R3. `scripts/sdlc.sh` header comment explains `test-repair` (skips Implement, keeps the claim file, checks preconditions first).
- R4. The test files in this change do not read, scan or assert on the text of any test file (rule about the tests themselves; reviewed by hand, not tested).
- R5. Text assertions on `scripts/sdlc.sh` are structural and may need updating if the shell is reorganised; behaviour is covered by the execution tests T20-T25.
