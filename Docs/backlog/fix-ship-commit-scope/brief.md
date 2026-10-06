# fix-ship-commit-scope

Type: bug
Priority: P1 (blocks use)
Source: user report after `add-integration-success-check` finished with DONE while `scripts/sdlc.sh`, `scripts/sdlc-integration.sh`, `README.md` and `CLAUDE.md` were left uncommitted; and two earlier runs of the Ship stage that failed or committed secrets (see Problem).

## Problem
Verified by reading `scripts/sdlc.sh`; the cases below were all observed in real runs:
- The Ship stage stages only `server/` and the item's docs folder: `git add server "$DOCS"` (`scripts/sdlc.sh:215`). Changes anywhere else (`scripts/`, `README.md`, `CLAUDE.md`, `AGENTS.md`, `.gitlab-ci.yml`, root `package.json`) are never committed, yet the run prints DONE. In the `add-integration-success-check` run the implementation commit contained only `review-1.md`.
- `git add server` also swept in an untracked, unrelated `server/.env` containing credentials (`fix-database-url` run; the commit was local and was rewritten by hand).
- `git commit` has no pathspec (`scripts/sdlc.sh:216`), so it also commits anything the developer had already staged.
- When nothing under the staged paths changed, `git commit` exits 1 ("nothing to commit") and `set -e` ends the run as a failure after all gates passed (`scripts/sdlc.sh:216` and `:218`; the second one also fails when the slug has no line in `Docs/backlog/index.md`).
- There is no record of which files existed or were already modified before the run started, so the script cannot tell the cycle's changes from the developer's own uncommitted work.

## Expected behaviour
The Ship stage commits exactly the files the cycle changed: every relevant file created, modified or deleted since the run started, anywhere in the repo, and nothing else. The developer's own uncommitted work, secrets and editor or agent configuration are never committed. The run no longer fails because there was nothing to commit. The DONE message lists what was committed and what was skipped and why.

## Decisions
- Preconditions: this item edits `scripts/sdlc.sh`, which `add-integration-success-check` also edits. Start the pipeline only after that item's work is committed (or merged) on the branch you start from.
- New executables must not depend on the executable bit (the pipeline's agents cannot run `chmod`). `scripts/sdlc.sh` calls the new helpers as `bash scripts/sdlc-ship.sh ...` and `node scripts/sdlc-changes.cjs ...`, and tests must not assert `X_OK`.
- Baseline snapshot: right after the branch is checked out and before the Spec stage, when `FROM=spec`, `scripts/sdlc.sh` runs `node scripts/sdlc-changes.cjs snapshot "$LOG/baseline.json"`. The snapshot lists every path that `git status --porcelain=v1 -z --untracked-files=all` reports (modified, deleted, untracked, staged) with a content hash from `git hash-object` (or `null` for a deleted file). The file lives in `$LOG`, which is git-ignored.
- With `FROM=implement` the existing `$LOG/baseline.json` is reused. If it does not exist, create one now and print `WARNING: no baseline from the original run; changes made before this resume are treated as pre-existing and will not be committed`.
- `node scripts/sdlc-changes.cjs changed "$LOG/baseline.json"` prints JSON `{ "include": [paths], "skipped": [{ "path": "...", "reason": "..." }] }`. A path is a candidate when it is new, modified or deleted now and its state differs from the baseline (a path absent from the baseline, or present with a different hash). Rename is treated as delete plus add. Paths ignored by `.gitignore` never appear.
- Skip rules (a candidate matching one goes to `skipped`, never to `include`):
  - Already modified before the run and changed again by it: reason `pre-existing local changes`. (Never commit the developer's own work mixed in.)
  - Secrets: `.env`, `.env.*` except `.env.example`, `*.pem`, `*.key`, `*.p12`, `id_rsa*`, `*.keystore`: reason `sensitive file`.
  - Editor and agent configuration: `.vscode/**`, `.idea/**`, `.claude/**`: reason `local or agent configuration`.
  - `node_modules/**`, `.DS_Store`: reason `generated`.
  - Files larger than 1 MiB: reason `too large`.
  - Everything else is relevant, including `scripts/**`, `README.md`, `CLAUDE.md`, `AGENTS.md`, `.gitlab-ci.yml`, `package.json` and lockfiles, `Docs/**`, `server/**`, `Engineering/**`.
- New `scripts/sdlc-ship.sh <slug> <docs-dir> <baseline-file> <backlog-file>` (bash, `set -euo pipefail`) does the whole Ship stage and `scripts/sdlc.sh` calls it in place of lines 215-219:
  1. Get the include and skipped lists from the helper.
  2. If `include` is empty: print `WARNING: nothing to commit`, make no commit, continue.
  3. Otherwise `git add -A -- <include paths>` and `git commit -q -m "feat(<slug>): implement per <docs-dir>/specs-1.md" -m "<body>" -- <include paths>`. The pathspec after `--` guarantees that anything else the developer had staged is not committed. The body lists up to 50 committed paths, one per line.
  4. Tick the backlog: change `- [ ] \`<slug>\`` to `- [x] \`<slug>\`` in the backlog file. If the line is not found, print `WARNING: <slug> not found in <backlog-file>; not ticked` and make no backlog commit. If the backlog file was already modified before the run (baseline), edit it but do not commit it and print a warning. Otherwise commit only that file with `git commit -q -m "chore(backlog): mark <slug> done" -- <backlog-file>`.
  5. Write the skipped list to `$LOG/ship-skipped.md` (a line per path with its reason) and print it.
  6. Print `DONE: <slug> on <branch>. Committed N file(s), skipped M (see <log>/ship-skipped.md).` and exit 0.
- Failure behaviour: if `git add` or `git commit` fails for any real reason (not "nothing to commit"), exit 1 with the git error.
- The Red tests commit (`scripts/sdlc.sh:129-130`) and the Test repair commit (`:200-201`) are not changed.
- `scripts/sdlc.sh` header comment documents the behaviour and `ship-skipped.md`.

## Scope
- In: `scripts/sdlc-changes.cjs` (new), `scripts/sdlc-ship.sh` (new), `scripts/sdlc.sh` (baseline call and the Ship stage), docs below.
- Out of scope: the Red tests and Test repair commits, the Spec, Plan and Implement stages, `.claude/commands/*`, the integration step, pushing branches or opening PRs, any application source.

## Tests
- New `server/__tests__/scripts/sdlc-changes.test.js`: each case creates a temporary git repository (`git init`, local user config) and runs the helper with `child_process`. Cases: `snapshot` records modified, untracked, deleted and staged paths with hashes; after the snapshot a new file, an edited tracked file and a deleted tracked file are in `include`; a file that was already dirty and is unchanged is in neither list; a file that was already dirty and then edited is in `skipped` with reason `pre-existing local changes`; `.env`, `.env.local`, `.vscode/x.json`, `.claude/settings.json`, `key.pem` and `node_modules/x/index.js` are skipped with the right reason while `.env.example` is included; a file over 1 MiB is skipped as `too large`; a `.gitignore`d file is never listed; a rename appears as one delete and one add.
- New `server/__tests__/scripts/sdlc-ship.test.js`: runs `bash scripts/sdlc-ship.sh` against a temporary git repository with a baseline taken first. Cases: changes in `scripts/`, `README.md` and `server/` are all in one `feat(...)` commit and the commit body lists them; a pre-existing untracked file and a pre-existing modified tracked file stay uncommitted and untouched on disk; something the developer staged beforehand is not in the commit and is still staged afterwards; `.env` left in `server/` is not committed and appears in `ship-skipped.md`; no cycle changes gives `WARNING: nothing to commit`, no `feat` commit and exit 0; a slug missing from the backlog gives a warning, no backlog commit and exit 0; a backlog file that was dirty at baseline is ticked but not committed; the final line reports the counts; a failing `git commit` (for example an invalid user config) exits 1.
- New `server/__tests__/scripts/sdlc-ship-wiring.test.js`: reads `scripts/sdlc.sh` as text and asserts: it no longer contains `git add server "$DOCS"`; it calls `scripts/sdlc-changes.cjs snapshot` only inside the `FROM=spec` path and `bash scripts/sdlc-ship.sh` for the Ship stage; the Red tests and Test repair `git add` and `git commit` lines are unchanged; `bash -n` passes on `scripts/sdlc.sh` and `scripts/sdlc-ship.sh`.

## Docs
- `README.md` (SDLC section): what the Ship stage commits, what it skips and why, `ship-skipped.md`.
- `CLAUDE.md` (SDLC pipeline section): one line saying that Ship commits only files changed during the cycle and lists skipped files in `Docs/backlog/<slug>/logs/ship-skipped.md`.
- Header comment of `scripts/sdlc.sh`.

## Open questions
- none
