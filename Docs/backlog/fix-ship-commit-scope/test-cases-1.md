# Test matrix: fix-ship-commit-scope (round 1)

Sources: `specs-1.md`, `plan-1.md`. All tests run under Jest with `npm test`, need no database, use temporary git repositories with a local `user.name`/`user.email`, and never assert the executable bit. The baseline file is created outside the repo (helper tests) or in a git-ignored `Docs/backlog/*/logs/` directory (ship tests).

Files:
- `server/__tests__/scripts/sdlc-changes.test.js` (helper: `snapshot`, `changed`)
- `server/__tests__/scripts/sdlc-ship.test.js` (`scripts/sdlc-ship.sh`, with copies of both scripts in a temp repo, baseline taken first)
- `server/__tests__/scripts/sdlc-ship-wiring.test.js` (`scripts/sdlc.sh` as text, `bash -n`, docs)

One assumption beyond the spec text: AC1 reads the snapshot JSON, so it relies on the flat `{ "<path>": "<sha>" | null }` layout fixed in `plan-1.md` section 2. Every other helper test checks behaviour through `changed` only.

## 1. Helper: `sdlc-changes.test.js`

| ID | AC | Scenario | Expected |
|---|---|---|---|
| H1 | AC1 | Modified, deleted, untracked, staged-new and staged-modified paths, then `snapshot` | Exit 0, empty stdout; each path present with its `git hash-object`, deleted path is `null` |
| H2 | AC1 | Untracked file inside a new directory | Recorded as the file path, not the directory |
| H3 | AC1/AC9 | Ignored files present at snapshot | Not recorded |
| H4 | AC1 | Output file already exists with garbage; clean tree | Overwritten; no entries |
| H5 | AC1/AC10 | Staged rename at snapshot | Old path `null`, new path hashed |
| H6 | AC2 | Clean snapshot, then new, edited and deleted tracked files | `include` = those three, sorted; `skipped` empty |
| H7 | AC2 | Staged new file and staged edit after snapshot | Both in `include` |
| H8 | AC3 | Dirty at baseline (modified, untracked, deleted, staged), unchanged since | Neither list |
| H9 | AC4 | Dirty at baseline (modified, untracked), edited since | `skipped`, `pre-existing local changes` |
| H10 | AC4 | Deleted at baseline then recreated; deleted at baseline and still deleted | Recreated: `pre-existing local changes`; still deleted: dropped |
| H11 | 4.2 | Dirty file edited and then restored to the baseline content | Dropped (hash equal) |
| H12 | 4.2 | Clean tree, clean snapshot | `{include: [], skipped: []}` |
| H13 | 4.3 | `scripts/**`, `README.md`, `CLAUDE.md`, `AGENTS.md`, `.gitlab-ci.yml`, `package.json`, lockfiles, `Docs/**`, `server/**`, `Engineering/**`, `.env.example` (also nested) | All in `include` |
| H14 | AC5 | `.env`, `.env.local`, `.env.production`, `key.pem`, `cert.key`, `store.p12`, `app.keystore`, `id_rsa`, `id_rsa.pub`, `.vscode/x.json`, `.idea/..`, `.claude/settings.json`, `node_modules/x/index.js`, `.DS_Store`; plus `.env.example` | Reasons `sensitive file`, `local or agent configuration`, `generated` as specified; `.env.example` included |
| H15 | AC6 | Same patterns nested (`server/.env`, `a/b/key.pem`, `client/.vscode/s.json`, `Engineering/.claude/x`, `server/node_modules/x`, ...) | Same reasons; `server/.env.example` included |
| H16 | 4.3 | Look-alike names (`environment.js`, `keys.md`, `monkey.js`, `vscode/x.json`, `my_node_modules/x.js`, ...) | Included, not skipped |
| H17 | AC7 | 1 MiB + 1 byte and exactly 1 MiB | First `too large`, second included |
| H18 | AC7 | Tracked large file deleted | In `include` (deleted is never `too large`) |
| H19 | AC8 | Precedence: dirty+edited `server/.env`; dirty+edited oversized file; 2 MiB `.pem`; oversized under `.claude/`; `node_modules/.env`; `.vscode/.env`; `.claude/node_modules/x.js` | `sensitive file`; `pre-existing local changes`; `sensitive file`; `local or agent configuration`; `sensitive file`; `sensitive file`; `local or agent configuration` |
| H20 | AC9 | Ignored files and a normal file after snapshot | Only the normal file listed |
| H21 | AC10 | `git mv` rename; unstaged move | `include` has old path and new path |
| H22 | AC10/4.3 | Rename into `.claude/` | Old path in `include`, new path skipped as configuration |
| H23 | 4.2 | Path containing a space | Listed intact (NUL parsing) |
| H24 | 4.4 | Mixed-case and nested names, skipped entries | Each list in byte order; no path in both lists or twice |
| H25 | 4.1 | Output shape | Single JSON line plus newline, keys `include` and `skipped` only |
| H26 | AC11 | No subcommand; unknown subcommand; `changed` and `snapshot` without argument | Exit 1, empty stdout, one stderr line |
| H27 | AC11 | Missing baseline file; non-JSON; wrong shape (`[]`, `"x"`, `5`, `null`, `{"a":5}`); baseline path is a directory | Exit 1, empty stdout, one stderr line |
| H28 | AC11 | `changed` and `snapshot` outside a git work tree | Exit 1, empty stdout, one stderr line |
| H29 | AC11 | `snapshot` to an unwritable path (missing directory) | Exit 1, empty stdout, one stderr line |

## 2. Ship script: `sdlc-ship.test.js`

| ID | AC | Scenario | Expected |
|---|---|---|---|
| S1 | AC12 | Changes in `scripts/`, `README.md`, `server/` | One `feat(<slug>): implement per <docs>/specs-1.md` commit with exactly those files; body lists them one per line; tree clean afterwards |
| S2 | AC12 | New `Docs/**` and `Engineering/**` files | Committed in the feat commit |
| S3 | AC13 | Pre-existing untracked file and modified tracked file | Not in commit; content byte-identical; still `??` and ` M` |
| S4 | AC13 | Pre-existing modified file edited further during the cycle | Not committed; listed as `pre-existing local changes`; disk content kept |
| S5 | AC14 | Files staged before baseline | Not in commit; still staged afterwards |
| S6 | AC15 | `server/.env` created after baseline | Not committed or tracked; `ship-skipped.md` and stdout contain `- server/.env: sensitive file`; file left on disk |
| S7 | 5.2 step 6 | Several skipped files | One `- <path>: <reason>` line each, helper order |
| S8 | AC16 | No cycle changes | `WARNING: nothing to commit`, no `feat` commit, exit 0, tick commit made, DONE reports 1 |
| S9 | AC16 | No cycle changes and slug absent from backlog | HEAD unchanged, DONE reports 0 |
| S10 | AC17 | Slug not in backlog, other changes exist | `WARNING: <slug> not found in <backlog>; not ticked`, no `chore(backlog)` commit, backlog untouched, exit 0 |
| S11 | 5.2 step 5 | Backlog line already `[x]` | No tick commit, exit 0 |
| S12 | 5.2 step 5 | Normal tick | Only the slug line changes; commit `chore(backlog): mark <slug> done` touches only the backlog; no `.bak` left |
| S13 | AC18 | Backlog dirty at baseline | Ticked on disk, not committed, warning mentions "already modified before the run" and "not committed"; developer's lines preserved; N excludes the tick |
| S14 | AC19 | Backlog edited during the cycle (not dirty at baseline) | Not in feat commit; committed only by tick commit; not listed as skipped; N counts it once |
| S15 | AC19 | Only the backlog changed during the cycle | `nothing to commit` warning, no feat commit, tick commit contains the backlog |
| S16 | AC20 | 3 feat files + 1 skipped + tick | Last stdout line `DONE: <slug> on feature-branch. Committed 4 file(s), skipped 1 (see <log>/ship-skipped.md).` |
| S17 | AC21 | Nothing skipped | `ship-skipped.md` is `No files skipped.` and it is printed |
| S18 | AC21 | 60 new files | Body has the first 50 paths then `... and 10 more`; all 60 committed; DONE counts 61 |
| S19 | AC21 | Exactly 50 files | 50 body lines, no `... and K more` |
| S20 | AC22 | `pre-commit` hook rejects the feat commit | Exit 1, git error on stderr, no DONE line, HEAD unchanged |
| S21 | AC22 | Hook rejects the backlog tick commit | Exit 1, no DONE line |
| S22 | AC23 | 0, 1, 3 and 5 arguments | Exit 1, usage message, no DONE line, nothing committed, backlog not ticked |
| S23 | AC23 | Missing baseline; invalid baseline | Exit 1, no DONE line, HEAD unchanged, backlog not ticked, new file not added |

## 3. Wiring and docs: `sdlc-ship-wiring.test.js`

| ID | AC | Scenario | Expected |
|---|---|---|---|
| W1 | AC24 | `scripts/sdlc.sh` text | No `git add server "$DOCS"` |
| W2 | 6 | Same | No inline `feat(` commit, no inline `chore(backlog)` commit, no `echo "DONE:` |
| W3 | AC25 | Ship call | Exactly one `bash scripts/sdlc-ship.sh "$SLUG" "$DOCS" "$LOG/baseline.json" "$BACKLOG"`, after the `6/6 Commit` banner |
| W4 | AC25/6 | Last command of the script | Is the Ship call (exit status is the run's) |
| W5 | AC25 | `snapshot` calls | Exactly two: one in the `FROM=spec` branch before `1/6 Spec`, one in the resume branch behind a missing-baseline check |
| W6 | AC25 | Baseline timing | First snapshot precedes the Spec stage |
| W7 | AC26 | Red tests commit | `git add "$DOCS" "$TEST_DIR"` appears twice; the `add failing tests and spec/plan docs` commit line is unchanged and directly follows its add |
| W8 | AC26 | Test repair commit | `repair invalid tests (...)` commit line unchanged and directly follows its add |
| W9 | AC27 | `bash -n` | Passes on `sdlc.sh` and `sdlc-ship.sh` |
| W10 | 2 | Invocation style | `sdlc-ship.sh` has `set -euo pipefail`; the two new scripts are never executed directly (no X_OK reliance) |
| W11 | AC28 | Resume fallback | Exact WARNING text appears once, in an `echo`, inside the missing-baseline check, before the snapshot |
| W12 | plan 0 | Existing wiring | `grep -m1 '^- \[ \]'` line kept; no `SDLC_INTEGRATION=` |
| W13 | 3.2 | `.gitignore` | `Docs/backlog/<slug>/logs/baseline.json` is ignored |
| D1 | AC29 | `README.md` | Mentions `ship-skipped.md`, all five skip reasons, `Ship`; keeps `SDLC_INTEGRATION_CI=run` |
| D2 | AC29 | `CLAUDE.md` | Exactly one line with `Docs/backlog/<slug>/logs/ship-skipped.md`, mentioning Ship and "only" |
| D3 | AC29 | `scripts/sdlc.sh` header (before `set -`) | Mentions baseline, `ship-skipped.md`, all five reasons; no `git add server "$DOCS"` or `SDLC_INTEGRATION=` |

## 4. Coverage map

AC1 H1-H5 | AC2 H6-H7 | AC3 H8 | AC4 H9-H10 | AC5 H14 | AC6 H15 | AC7 H17-H18 | AC8 H19 | AC9 H3, H20 | AC10 H5, H21-H22 | AC11 H26-H29 | AC12 S1-S2 | AC13 S3-S4 | AC14 S5 | AC15 S6 | AC16 S8-S9 | AC17 S10 | AC18 S13 | AC19 S14-S15 | AC20 S16 | AC21 S17-S19 | AC22 S20-S21 | AC23 S22-S23 | AC24 W1 | AC25 W3-W6 | AC26 W7-W8 | AC27 W9 | AC28 W11 | AC29 D1-D3

## 5. Expected state at the Red tests stage

`scripts/sdlc-changes.cjs` and `scripts/sdlc-ship.sh` do not exist yet and `sdlc.sh`, `README.md` and `CLAUDE.md` are unchanged, so every test in the three new files should fail until Implement. W2-W3-style assertions on text and `bash -n` of `sdlc-ship.sh` fail because the file is missing. Existing suites (`sdlc-gates`, `backlog-list-wiring`, `sdlc-mod`) must stay green.
