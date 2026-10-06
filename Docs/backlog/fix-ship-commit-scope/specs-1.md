# Spec: fix-ship-commit-scope (round 1)

Type: bug, P1. Sources: `brief.md` and `decisions.md` (Round 1: Q1-Q5 all accepted, binding).

## 1. Purpose
The Ship stage of `scripts/sdlc.sh` must commit exactly the files the cycle changed, anywhere in the repo, and nothing else. It must never commit the developer's own uncommitted work, secrets, or editor/agent configuration. It must not fail the run merely because there is nothing to commit. The DONE message reports what was committed and what was skipped.

## 2. Components
| Component | Kind | Role |
|---|---|---|
| `scripts/sdlc-changes.cjs` | new (Node, CommonJS) | `snapshot` and `changed` subcommands |
| `scripts/sdlc-ship.sh` | new (bash, `set -euo pipefail`) | whole Ship stage |
| `scripts/sdlc.sh` | modified | baseline call before Spec; calls `sdlc-ship.sh` in place of the current Ship lines (the `git add server "$DOCS"` through the `DONE` echo, currently lines 211-215; the brief's 215-219 refers to the post-`add-integration-success-check` numbering); header comment |
| `README.md`, `CLAUDE.md` | modified | docs |

Neither new file may rely on the executable bit. `sdlc.sh` invokes them as `node scripts/sdlc-changes.cjs ...` and `bash scripts/sdlc-ship.sh ...`. Tests must not assert `X_OK`.

Precondition (process, not behaviour): the work of `add-integration-success-check` is already committed on the starting branch.

## 3. Baseline snapshot

### 3.1 `node scripts/sdlc-changes.cjs snapshot <baseline-file>`
- Input: path of the output file. Working directory is the repo root.
- Reads `git status --porcelain=v1 -z --untracked-files=all` and records every reported path: modified, deleted, untracked, staged (including added and renamed entries).
- Rename entries are recorded as two paths: the old path (deleted, hash `null`) and the new path (hash of its content).
- For each path, record a content hash from `git hash-object` of the working-tree file, or `null` if the file does not exist (deleted).
- Paths ignored by `.gitignore` are never recorded (git status does not report them).
- Output: writes JSON to `<baseline-file>` (creating it, overwriting any existing file). The file maps each path to its hash or `null`. Exact JSON layout is internal to the helper pair (snapshot and changed) and is not asserted by tests beyond what is observable through the helper's behaviour. Stdout is empty; exit 0.

### 3.2 Use in `scripts/sdlc.sh`
- `FROM=spec`: right after the branch is checked out and before the Spec stage, run `node scripts/sdlc-changes.cjs snapshot "$LOG/baseline.json"`. `$LOG` is `Docs/backlog/<slug>/logs` (git-ignored). This is the only place `snapshot` is called for the first run.
- `FROM=implement`: reuse the existing `$LOG/baseline.json`. If it does not exist, create it now with `snapshot` and print exactly:
  `WARNING: no baseline from the original run; changes made before this resume are treated as pre-existing and will not be committed`
- If `snapshot` fails, `sdlc.sh` stops with a failure (via `set -e`); the run does not continue without a baseline.

## 4. Change detection: `node scripts/sdlc-changes.cjs changed <baseline-file>`

### 4.1 Output
Prints to stdout a single JSON object `{ "include": [<path>...], "skipped": [{ "path": "<path>", "reason": "<reason>" }...] }` and exits 0. Nothing else is written to stdout.

### 4.2 Candidate selection
Read the current `git status --porcelain=v1 -z --untracked-files=all`. A path is a **candidate** when it is new, modified or deleted now (staged or not) and its state differs from the baseline, i.e. it is absent from the baseline, or present in the baseline with a different hash than now (a deleted file has hash `null`).
- A path present in the baseline with the same hash as now (including both `null`) is in neither list.
- A rename is one delete (old path) plus one add (new path).
- `.gitignore`d paths never appear.

### 4.3 Skip rules and precedence
Each candidate goes to exactly one place: `include`, or one `skipped` entry. Rules are evaluated in this order; the first match decides the reason (Q1):
1. `sensitive file`: base name is `.env`, or starts with `.env.` except exactly `.env.example`; or ends in `.pem`, `.key`, `.p12`, `.keystore`; or starts with `id_rsa` (covers `id_rsa`, `id_rsa.pub`, etc.).
2. `local or agent configuration`: any path segment equals `.vscode`, `.idea` or `.claude` (for example `.claude/settings.json`).
3. `generated`: any path segment equals `node_modules`, or base name is `.DS_Store`.
4. `pre-existing local changes`: the path is present in the baseline (and, being a candidate, its hash differs now).
5. `too large`: the file on disk is larger than 1 MiB (1,048,576 bytes). Deleted files have no size and are never `too large`.
Anything not matched is relevant and goes to `include`. This explicitly includes `scripts/**`, `README.md`, `CLAUDE.md`, `AGENTS.md`, `.gitlab-ci.yml`, `package.json`, lockfiles, `Docs/**`, `server/**`, `Engineering/**`, and `.env.example`.

Matching depth (Q2): patterns are unanchored, matching at any directory depth. Directory patterns match by path segment (`server/node_modules/x`, `client/.vscode/s.json`, `Engineering/.claude/x` are all skipped). File patterns match on the base name at any depth (`server/.env` is `sensitive file`; `a/b/key.pem` is `sensitive file`). `.env.example` is the only `.env.*` exception, at any depth.

### 4.4 Ordering and determinism
Paths in `include` and `skipped` are in a stable order (sorted by path, byte order). Each path appears at most once across both lists.

### 4.5 Errors (Q3)
On any of the following, print a one-line message to stderr, print nothing to stdout, and exit 1:
- no subcommand, or an unknown subcommand;
- missing `<baseline-file>` argument;
- baseline file does not exist, is unreadable, or is not parsable as the expected JSON (a missing baseline is never treated as empty);
- not run inside a git work tree, or `git` fails.
The same applies to `snapshot` for: missing output argument, not a git work tree, git failure, unwritable output path.

## 5. Ship stage: `bash scripts/sdlc-ship.sh <slug> <docs-dir> <baseline-file> <backlog-file>`

### 5.1 Arguments and environment
- Exactly 4 arguments; otherwise print a usage message and exit 1 (Q3). Nothing is committed.
- Run from the repo root. `<log>` (the logs directory, `$LOG`) is the directory containing `<baseline-file>`; `ship-skipped.md` is written to `<log>/ship-skipped.md`. (`sdlc.sh` passes `"$LOG/baseline.json"`.)
- `set -euo pipefail`.

### 5.2 Steps
1. Obtain the include and skipped lists from `node scripts/sdlc-changes.cjs changed <baseline-file>`. If the helper fails, exit 1 with its message and commit nothing (Q3).
2. Remove `<backlog-file>` from `include` (Q4). It is never part of the `feat` commit and is never listed as skipped on this account.
3. If the remaining `include` is empty: print `WARNING: nothing to commit`, make no `feat` commit, and continue to step 4.
4. Otherwise:
   - `git add -A -- <include paths>`.
   - `git commit -q -m "feat(<slug>): implement per <docs-dir>/specs-1.md" -m "<body>" -- <include paths>`.
   - The pathspec after `--` guarantees anything else the developer had staged is not committed and stays staged.
   - `<body>` lists the committed paths, one per line, at most 50. If more than 50 paths are committed, the body lists the first 50 and ends with the line `... and K more` where K is the remaining count (Q5).
5. Backlog tick:
   - Change the line `- [ ] \`<slug>\`` to `- [x] \`<slug>\`` in `<backlog-file>`.
   - If no such line exists: print `WARNING: <slug> not found in <backlog-file>; not ticked`, make no backlog commit, continue.
   - If `<backlog-file>` was already modified before the run (present in the baseline): edit it, do not commit it, print a warning saying it was already modified before the run and was ticked but not committed.
   - Otherwise commit only that file: `git commit -q -m "chore(backlog): mark <slug> done" -- <backlog-file>`. A tick that leaves the file unchanged (already `[x]`) makes no commit and does not fail.
6. Write the skipped list to `<log>/ship-skipped.md` and print it (Q5). One line per skipped path, in helper order: `- <path>: <reason>`. If nothing was skipped, the file is still written with the single line `No files skipped.`, and that line is printed.
7. Print as final line `DONE: <slug> on <branch>. Committed N file(s), skipped M (see <log>/ship-skipped.md).` and exit 0.
   - `<branch>` is the current branch name.
   - N = number of paths in the `feat` commit (0 if none), plus 1 if the backlog tick commit was made (Q4). N is not limited by the 50-line body cap.
   - M = number of skipped entries.
   - `<log>` is printed as the path of the logs directory as given by the baseline file's directory.

### 5.3 Failure behaviour
If `git add` or any `git commit` fails for a real reason (not "nothing to commit"), exit 1 and surface the git error on stderr. The DONE line is not printed. Because the include list is non-empty before committing and the pathspec is explicit, "nothing to commit" is handled by the empty-list branch, not by tolerating git's exit code.

### 5.4 Invariants
- Files modified or untracked before the run (baseline) are never staged by this script, never modified on disk (except the backlog tick, 5.2 step 5), and never committed.
- Anything the developer staged before the Ship stage is still staged afterwards.
- Secrets, editor/agent config, `node_modules`, `.DS_Store` and files over 1 MiB are never committed.

## 6. Changes to `scripts/sdlc.sh`
- Remove `git add server "$DOCS"`, the `feat` commit, the inline backlog `sed`/commit and the inline DONE echo; replace them by one call `bash scripts/sdlc-ship.sh "$SLUG" "$DOCS" "$LOG/baseline.json" "$BACKLOG"`. The call's exit status is the run's exit status (failure of the call fails the run).
- Add the baseline call (section 3.2), only on the `FROM=spec` path (plus the `FROM=implement` fallback above).
- The Red tests commit (`git add "$DOCS" "$TEST_DIR"` + `git commit ... add failing tests and spec/plan docs`) and the Test repair commit (`... repair invalid tests ...`) stay byte-for-byte unchanged.
- Header comment documents: the baseline snapshot, what Ship commits, what it skips and why, and `ship-skipped.md`.
- Out of scope: Spec, Plan and Implement stages, `.claude/commands/*`, the integration step, pushing, PRs, application source.

## 7. Documentation
- `README.md` (SDLC section): what the Ship stage commits (files changed during the cycle, anywhere in the repo), what it skips and why (the five reasons), and `ship-skipped.md`.
- `CLAUDE.md` (SDLC pipeline section): one line stating that Ship commits only files changed during the cycle and lists skipped files in `Docs/backlog/<slug>/logs/ship-skipped.md`.
- Header comment of `scripts/sdlc.sh` (section 6).

## 8. Acceptance criteria
Helper `snapshot`/`changed` (`server/__tests__/scripts/sdlc-changes.test.js`, temporary git repos):
- AC1: `snapshot` records modified, untracked, deleted and staged paths with hashes (`null` for deleted).
- AC2: after a snapshot, a new file, an edited tracked file and a deleted tracked file are in `include`.
- AC3: a file dirty at baseline and unchanged since is in neither list.
- AC4: a file dirty at baseline and edited since is in `skipped` with reason `pre-existing local changes`.
- AC5: `.env`, `.env.local`, `.vscode/x.json`, `.claude/settings.json`, `key.pem`, `node_modules/x/index.js` are skipped with reasons `sensitive file`, `sensitive file`, `local or agent configuration`, `local or agent configuration`, `sensitive file`, `generated`; `.env.example` is in `include`.
- AC6: the same patterns match when nested (for example `server/.env`, `server/node_modules/x`, `client/.vscode/s.json`).
- AC7: a file over 1 MiB is skipped as `too large`; exactly 1 MiB is included.
- AC8: precedence: a dirty-at-baseline, edited `server/.env` is `sensitive file`; a 2 MiB `.pem` is `sensitive file`; a dirty-at-baseline edited oversized file is `pre-existing local changes`.
- AC9: a `.gitignore`d file is never listed.
- AC10: a rename appears as one delete (old path) and one add (new path).
- AC11: errors per 4.5 give exit 1, one stderr line, empty stdout (missing/invalid baseline, unknown or missing subcommand, missing argument, outside a git repo).

Ship script (`server/__tests__/scripts/sdlc-ship.test.js`, temporary git repo, baseline taken first):
- AC12: changes in `scripts/`, `README.md` and `server/` land in one `feat(<slug>): implement per <docs-dir>/specs-1.md` commit whose body lists them.
- AC13: a pre-existing untracked file and a pre-existing modified tracked file stay uncommitted and byte-identical on disk.
- AC14: something staged beforehand is not in the commit and is still staged afterwards.
- AC15: `.env` created in `server/` after the baseline is not committed and appears in `ship-skipped.md` as `- server/.env: sensitive file`.
- AC16: no cycle changes gives `WARNING: nothing to commit`, no `feat` commit, exit 0; the DONE line reports 0 committed (plus backlog tick if made).
- AC17: slug missing from the backlog gives `WARNING: <slug> not found in <backlog-file>; not ticked`, no backlog commit, exit 0.
- AC18: a backlog file dirty at baseline is ticked on disk but not committed, with a warning.
- AC19: the backlog file, if changed during the cycle and not dirty at baseline, is not in the `feat` commit; it is committed only by the tick commit; N counts it once.
- AC20: the final stdout line is `DONE: <slug> on <branch>. Committed N file(s), skipped M (see <log>/ship-skipped.md).` with correct counts.
- AC21: with no skipped files, `ship-skipped.md` contains `No files skipped.`; with more than 50 committed files the body has 50 paths then `... and K more`, and N counts all files.
- AC22: a failing `git commit` (for example an invalid user config) exits 1 with the git error and without a DONE line.
- AC23: wrong argument count prints usage and exits 1; a failing helper (bad baseline) exits 1 with no commit.

Wiring (`server/__tests__/scripts/sdlc-ship-wiring.test.js`, reads `scripts/sdlc.sh` as text):
- AC24: no longer contains `git add server "$DOCS"`.
- AC25: `scripts/sdlc-changes.cjs snapshot` is called only in the `FROM=spec` path (and the documented `FROM=implement` missing-baseline fallback); `bash scripts/sdlc-ship.sh` is called for the Ship stage.
- AC26: the Red tests and Test repair `git add`/`git commit` lines are unchanged.
- AC27: `bash -n` passes on `scripts/sdlc.sh` and `scripts/sdlc-ship.sh`.
- AC28: the `FROM=implement` fallback prints the exact WARNING text from 3.2 when the baseline is missing.

Docs:
- AC29: `README.md`, `CLAUDE.md` and the `scripts/sdlc.sh` header contain the described text (section 7).

## 9. Test constraints
- Tests live under `server/__tests__/scripts/`, run with `npm test`, need no database, and use temporary git repositories with local user config. No test asserts the executable bit.
