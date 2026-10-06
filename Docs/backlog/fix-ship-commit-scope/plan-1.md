# Plan: fix-ship-commit-scope (round 1)

Source: `specs-1.md` and `decisions.md` (Round 1, binding). No source edits are made by this plan.

## 0. Affected files and callers (from graft and the SDLC script)
`scripts/sdlc.sh` is a shell script, so graft has no symbols or edges for it. Its only references, found with `graft_find_all` over `server/__tests__`, are text-level:

| Reader of `scripts/sdlc.sh` | What it asserts | Impact |
|---|---|---|
| `server/__tests__/scripts/sdlc-gates.test.js` | `success_check` is defined and used at exactly 3 call sites; `RED GATE FAILED` line uses `tests_pass`; no `SDLC_INTEGRATION=` anywhere; `bash -n` passes; README and CLAUDE.md contain `SDLC_INTEGRATION_CI=run` and not `SDLC_INTEGRATION=off` | Do not touch those lines. The new header comment and docs must not contain `SDLC_INTEGRATION=`. |
| `server/__tests__/scripts/backlog-list-wiring.test.js` | `scripts/sdlc.sh` still contains `grep -m1 '^- \[ \]'` (line 23). The tick `sed` is tested only as a standalone expression, not read from the script. | Leave line 23 untouched. `sdlc-ship.sh` reuses the same `sed -E` expression. |
| `server/__tests__/scripts/sdlc-mod.test.js` | Uses a STUB `sdlc.sh` | No impact. |

The new scripts have no callers other than `sdlc.sh`. Existing helper to mimic for style: `scripts/sdlc-testcheck.cjs` (invoked as `node scripts/...`, no executable bit). The `.gitignore` is expected to already ignore `Docs/backlog/*/logs/`; verify while implementing (spec 3.2 relies on it).

## 1. Order of work
1. `scripts/sdlc-changes.cjs`
2. `scripts/sdlc-ship.sh`
3. `scripts/sdlc.sh`
4. `README.md`, `CLAUDE.md`
5. Tests (written by the Red tests stage; listed in section 6 for traceability)

The helper comes first because the ship script depends on its output.

## 2. `scripts/sdlc-changes.cjs` (new, CommonJS, no dependencies)
Functions (all synchronous, `child_process.execFileSync` / `spawnSync` with `git`, never a shell string):

- `fail(msg)`: writes one line to stderr, nothing to stdout, `process.exit(1)`. Every error path in spec 4.5 goes through it.
- `git(args)`: runs git in cwd, returns the stdout Buffer or calls `fail("git failed: ...")`. A first call to `git rev-parse --is-inside-work-tree` gives the "not a git work tree" error.
- `readStatus()`: runs `git status --porcelain=v1 -z --untracked-files=all`. Splits on NUL. Each record is `XY<space>path`. For `R` or `C` in X or Y, the next NUL field is the old path (with `-z` the new path comes first, then the old path). Returns `Map<path, {deleted?:true}>`: a rename yields the old path as deleted and the new path as present. A path whose X or Y is `D` and which is absent from disk counts as deleted. Filesystem existence decides the hash (below), not the status letters.
- `hashOf(path)`: `null` if `fs.lstatSync` fails (file absent) or the path is a directory (submodule or empty dir); otherwise the output of `git hash-object -- <path>`. Symlinks are hashed with `git hash-object` as well (it hashes the link target text via lstat semantics when run with `--no-filters` off; acceptable either way, it only needs to be stable between snapshot and changed).
- `snapshot(outFile)`: requires the argument; builds a flat object `{ "<path>": "<sha>" | null }` from `readStatus()` and `hashOf`; writes it with `fs.writeFileSync` (create or overwrite, key order sorted); prints nothing; exit 0. An unwritable path fails through `fail`.
- `loadBaseline(file)`: `fs.readFileSync`, `JSON.parse`, validates "plain object whose values are string or null"; any failure calls `fail`. A missing baseline is never treated as empty.
- `classify(path, baseline, size)`: implements the 4.3 rule order and returns a reason string or `null` (include):
  1. `sensitive file`: base name is `.env`, or starts with `.env.` and is not exactly `.env.example`; ends with `.pem`, `.key`, `.p12` or `.keystore`; or starts with `id_rsa`.
  2. `local or agent configuration`: any segment is `.vscode`, `.idea` or `.claude`.
  3. `generated`: any segment is `node_modules`, or base name is `.DS_Store`.
  4. `pre-existing local changes`: `path in baseline` (the candidate test already ensured the hash differs).
  5. `too large`: `size > 1048576` (`1 MiB` exactly stays included). Deleted files (hash `null`) have no size and are never `too large`.
  Segments come from `path.split('/')` (git always uses `/`); the base name is the last segment. The patterns are unanchored.
- `changed(baselineFile)`: loads the baseline, gets `readStatus()`, computes the current hash for each path, keeps a path as a candidate if it is absent from the baseline or its hash differs (`null` vs `null` is equal, so it is dropped). Classifies each candidate, sorts both lists by path with byte order (`Buffer.compare` or plain `<` on strings; paths are ASCII in the tests, but use `Buffer.compare(Buffer.from(a), Buffer.from(b))` to be exact), and prints exactly one `JSON.stringify({include, skipped})` line plus newline. Each path appears once because the status map is keyed by path.
- `main()`: dispatches on `argv[2]` (`snapshot` or `changed`); a missing or unknown subcommand or a missing argument calls `fail`. Everything is wrapped so that no uncaught exception can print a stack trace to stdout: a top-level `try/catch` calls `fail(err.message)`.

Edge decisions for the implementer:
- A path that is both baseline-present and now identical to baseline is dropped even if the staged state changed. Only content hash matters.
- A staged-then-edited file is one status record; the working-tree hash is the one that matters.
- Staged but unchanged-on-disk paths at baseline get the same hash later, so they stay out of both lists (AC3).

## 3. `scripts/sdlc-ship.sh` (new, bash, `set -euo pipefail`)
Header comment describing the arguments. Run from the repo root (`sdlc.sh` has already done `cd`). Invoked as `bash scripts/sdlc-ship.sh <slug> <docs-dir> <baseline-file> <backlog-file>`. Avoid bash 4-only features (`mapfile -d`): the repo already has macOS-style `sed -i.bak`, so use `while IFS= read -r -d ''` loops.

Order of code:
1. Argument check: `[ $# -eq 4 ] || { echo "Usage: bash scripts/sdlc-ship.sh <slug> <docs-dir> <baseline-file> <backlog-file>" >&2; exit 1; }`. Name the variables `SLUG DOCS BASELINE BACKLOG`, `LOG="$(dirname "$BASELINE")"`.
2. `JSON="$(node scripts/sdlc-changes.cjs changed "$BASELINE")"`. Under `set -e` a failure aborts, with the helper's stderr already shown. Wrap it as `JSON=$(...) || exit 1` to make the intent obvious. Nothing has been committed at that point (AC23).
3. Turn the JSON into data with `node -e` (stdin = `$JSON`, args = backlog path). Emit two NUL-delimited temp files in `$LOG` (or `mktemp -d`):
   - `include.nul`: `include` minus `<backlog-file>`;
   - `skipped.md`: lines `- <path>: <reason>` for `skipped` minus `<backlog-file>`, or the single line `No files skipped.` if the list is empty;
   - plus counts `N_FEAT` and `M`.
   The backlog file is removed from both lists (spec 5.2 step 2: never in `feat`, never listed as skipped on this account). Whether the backlog file is "dirty at baseline" is read from the baseline file by a small `node -e` check (`Object.prototype.hasOwnProperty.call(baseline, backlog)`). The baseline layout is flat `{path: hash|null}`, fixed by section 2 above.
4. `feat` commit:
   - If `N_FEAT == 0`: `echo "WARNING: nothing to commit"`.
   - Else: `git add -A --pathspec-from-file="$LOG/include.nul" --pathspec-file-nul` then `git commit -q -m "feat($SLUG): implement per $DOCS/specs-1.md" -m "$BODY" --pathspec-from-file=... --pathspec-file-nul` so the explicit pathspec keeps everything else staged by the developer out of the commit (AC14). The pathspec-from-file form also avoids ARG_MAX with large include lists; it requires git 2.26+. If the implementer wants wider compatibility, `xargs -0` for `git add` and an array expansion for `git commit --` are the fallback.
   - `BODY`: the first 50 paths one per line; when more than 50, append the line `... and K more` with K = total - 50 (AC21). Build it in the same `node -e` step to keep one source of truth.
   - A real `git add` or `git commit` failure aborts via `set -e` with git's stderr visible, and the DONE line is never reached (AC22). Do not use `|| true`.
5. Backlog tick (same `sed -E` expression as today, copied from `sdlc.sh` line 213 so the existing wiring test remains meaningful):
   - Find the line: `grep -q "^- \[ \] \`$SLUG\`" "$BACKLOG"`.
   - Not found: `echo "WARNING: $SLUG not found in $BACKLOG; not ticked"`; no commit. (Interpretation to keep: an already ticked `- [x]` line is also reported as "not found", because spec 5.2 step 5 says no matching `[ ]` line means that warning; the no-commit and no-failure rule is the same either way, and a guard `git diff --quiet -- "$BACKLOG"` before committing also covers "tick leaves the file unchanged".)
   - Found: `sed -i.bak -E "s/^- \[ \] (\`$SLUG\`)/- [x] \1/" "$BACKLOG" && rm -f "$BACKLOG.bak"`.
     - If the backlog file was in the baseline (dirty before the run): print `WARNING: $BACKLOG was already modified before the run; $SLUG was ticked but not committed`. No commit. `TICK_COMMITTED=0`.
     - Else, if `git diff --quiet -- "$BACKLOG"` is false: `git commit -q -m "chore(backlog): mark $SLUG done" -- "$BACKLOG"`, set `TICK_COMMITTED=1`. The `git add` is not needed for a tracked file with a pathspec commit, but the file may be new in theory, so use `git add -- "$BACKLOG"` first (it touches only this path).
6. `ship-skipped.md`: `cp` the prepared `skipped.md` to `"$LOG/ship-skipped.md"` and `cat` it to stdout (AC15, AC21). It is always written, including `No files skipped.`.
7. Final line: `BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)`; `N=$((N_FEAT + TICK_COMMITTED))`; `echo "DONE: $SLUG on $BRANCH_NAME. Committed $N file(s), skipped $M (see $LOG/ship-skipped.md)."` as the very last output line (AC20). `N_FEAT` is the full include count, not capped at 50.
8. Delete temp files in `$LOG` on exit via a `trap` (they are ignored anyway; keep `ship-skipped.md`).

## 4. `scripts/sdlc.sh` changes (minimal, in this order)
1. Header comment (after line 7, before `set -euo pipefail`): document the baseline snapshot (`$LOG/baseline.json`), that Ship commits only files changed during the cycle anywhere in the repo, what is skipped and why (the five reasons: sensitive file, local or agent configuration, generated, pre-existing local changes, too large), and `Docs/backlog/<slug>/logs/ship-skipped.md`. Do not write the literal `git add server "$DOCS"` or `SDLC_INTEGRATION=` anywhere (AC24, gates test).
2. Baseline, `FROM=spec` branch: inside the `if [ "$FROM" = "spec" ]; then` block (line 82), before `stage "1/6 Spec"` (line 87), add `node scripts/sdlc-changes.cjs snapshot "$LOG/baseline.json"`. A failure stops the run via `set -e`. This is the only `snapshot` call on the first-run path.
3. Baseline, resume branch: in the `else` block (lines 132-136) add, before or after the `RED_SHA` lookup:
   ```bash
   if [ ! -f "$LOG/baseline.json" ]; then
     echo "WARNING: no baseline from the original run; changes made before this resume are treated as pre-existing and will not be committed"
     node scripts/sdlc-changes.cjs snapshot "$LOG/baseline.json"
   fi
   ```
   The warning text is byte-exact (AC28).
4. Ship stage (lines 210-215): keep `stage "6/6 Commit"`; replace lines 211-215 with `bash scripts/sdlc-ship.sh "$SLUG" "$DOCS" "$LOG/baseline.json" "$BACKLOG"` as the last command, so its exit status is the run's exit status.
5. Do not touch the Red tests commit (lines 129-130), the Test repair commit (lines 196-197), the `success_check` call sites, or any other stage (AC26, gates test).

Open point resolved: spec 6 says the call exists in place of lines 211-215. The unused `BRANCH` variable is still used on line 79-80, so no cleanup is needed.

## 5. Documentation
- `README.md`, SDLC section (locate with `grep -n "SDLC" README.md`; keep the existing `SDLC_INTEGRATION_CI=run` text): add a short "Ship stage" paragraph covering what is committed (files changed during the cycle, anywhere in the repo), the five skip reasons, the baseline snapshot, and `Docs/backlog/<slug>/logs/ship-skipped.md`.
- `CLAUDE.md`, "SDLC pipeline" section: one line: Ship commits only files changed during the cycle and lists skipped files in `Docs/backlog/<slug>/logs/ship-skipped.md`. Keep the monitor-command and AskUserQuestion rules as they are.
- The `scripts/sdlc.sh` header comment covers AC29's third location.

## 6. Tests (for the Red tests stage; all under `server/__tests__/scripts/`, no DB, temporary git repos with local `user.name`/`user.email`, no `X_OK` checks)
- `sdlc-changes.test.js`: AC1 to AC11. Helper `mkRepo()` doing `git init`, initial commit and a local identity; run via `spawnSync('node', [<repo>/scripts/sdlc-changes.cjs, ...], {cwd})`. Test the `.pem` over 1 MiB and exactly 1 MiB cases, rename, `.gitignore`d file, and the error cases by running outside a git repo.
- `sdlc-ship.test.js`: AC12 to AC23. Copy `scripts/sdlc-changes.cjs` and `scripts/sdlc-ship.sh` into the temp repo, take a baseline first, then make changes. AC22 uses an invalid `user.email` or a `pre-commit` hook that exits 1 to force a commit failure. AC21 generates 51 or more files.
- `sdlc-ship-wiring.test.js`: AC24 to AC28, reading `scripts/sdlc.sh` as text. `bash -n` for `sdlc.sh` and `sdlc-ship.sh`; AC29 reads README, CLAUDE.md and the header comment.
- Existing tests that must stay green: `sdlc-gates.test.js` (extending its `bash -n` list is optional), `backlog-list-wiring.test.js`, `sdlc-mod.test.js`.

## 7. Verification checklist
1. `node scripts/sdlc-changes.cjs snapshot /tmp/b.json && node scripts/sdlc-changes.cjs changed /tmp/b.json` in a scratch repo: empty `include` and `skipped`.
2. `bash -n scripts/sdlc.sh scripts/sdlc-ship.sh`.
3. `npm test` from the repo root.
4. `grep -n 'git add server' scripts/sdlc.sh` returns nothing.

## 8. Risks
- Rename parsing in `-z` mode (new path first, then old path): covered by AC10.
- `git commit -- <pathspec>` with deleted files: works because `git add -A` has staged the deletions and the paths are known to HEAD.
- Git version for `--pathspec-from-file` (2.26+). If an older git must be supported, switch to `xargs -0` and an array.
- The baseline file is read by `sdlc-ship.sh` (backlog dirty check) as well as the helper. Both rely on the flat `{path: hash|null}` layout. Keep this layout in a comment at the top of `sdlc-changes.cjs`.
