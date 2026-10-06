# Plan: add-backlog-list

Based on `specs-1.md`. No source edits are made by this plan. Graft shows no existing callers to update. This is a new leaf script plus docs and wiring.

## Affected files (found with graft, then checked)
| File | Change | Why |
|---|---|---|
| `scripts/backlog-list.cjs` | New | The feature. Follows `scripts/sdlc-testcheck.cjs`: CommonJS `.cjs`, no dependencies, `execFileSync('git', ...)` helper. |
| `.claude/commands/backlog-list.md` | New | Slash command, modelled on the existing files in `.claude/commands/`. |
| `package.json` (root) | Add script `backlog` | Root `scripts` has only `test`, `test:integration`, `generate-spec` and `start:swagger`. |
| `Docs/backlog/index.md` | Legend line in the header | Item lines stay unchanged. |
| `README.md` | New "Backlog" section | Place it after "SDLC pipeline: integration tests". |
| `CLAUDE.md` | One new row in the commands table | After the `sdlc-integration.sh` row. |
| `server/__tests__/scripts/backlog-list.test.js` | New (Red tests stage) | Criteria 1-7 and 9. |
| `server/__tests__/scripts/backlog-list-wiring.test.js` | New (Red tests stage) | Criterion 8, text checks only. |

Not touched: `scripts/sdlc.sh`, `.claude/commands/triage.md`, `server/**` source, and every brief.

Callers and conflicts:
- `require.main` appears only in `server/index.js:826`. The script uses the same idiom.
- Nothing imports the new script, so there is no blast radius.
- The wiring test reads `scripts/sdlc.sh`. It must not change that file.

## Order of work

### 1. `scripts/backlog-list.cjs` (core)
Pure functions first, I/O last. Exports: `parseIndex`, `parseTitle`, `parseBrief`, `parseArgs`, `normalizeStatuses`, `formatTable`, `formatJson`, `main`.

1. `resolveRoot(env)` returns `env.BACKLOG_ROOT || path.join(__dirname, '..')`.
2. `parseIndex(text)` returns `[{marker, slug, rest}]`.
   - Regex: `^- \[( |x|X|!)\] \`([^\`]+)\`(?: - (.*))?$`.
   - It ignores other markers such as `[-]`, so lines like `- [-] \`x\`` are skipped.
   - Duplicates are kept as separate entries.
3. `parseTitle(rest)` returns `{type, title, blockedReason}`.
   - Strip a leading `Bug:` or `Feature:`, matched case-insensitively. Lowercase it for `type`.
   - Strip a trailing `\s*\(blocked:\s*(.*)\)\s*$` and move its reason to the note.
   - Trim the title. Never truncate it.
4. `parseBrief(root, slug)` returns `{hasBrief, type, priority}`.
   - It reads `Docs/backlog/<slug>/brief.md` if present.
   - `Type:` gives the lowercased value, taken as the first word.
   - `Priority:` gives the first `\bP[0-3]\b` token. Both are `null` if absent.
5. `branchExists(root, slug)` runs `git -C root branch --list sdlc/<slug>` and `git -C root branch -r --list "origin/sdlc/<slug>"`.
   - It uses `execFileSync` with `stdio: ['ignore','pipe','ignore']`.
   - It wraps everything in try/catch and returns false on any error. It never writes to stderr.
   - It only runs for `[ ]` items.
   - It caches the result per slug, because duplicate slugs repeat the lookup.
6. `deriveItem(entry, root)` computes the status.
   - `x`/`X` gives completed. `!` gives blocked.
   - `[ ]` gives in-progress if a branch exists, else pending.
   - Type is the prefix, else the brief value, else null.
   - Note is `[reason, hasBrief ? null : 'no brief'].filter(Boolean).join('; ')`.
7. `notInIndex(root, items)` lists the folders under `Docs/backlog/` that have `brief.md` and no index line.
   - It uses `readdirSync` with `withFileTypes`, skips non-directories, and sorts the result.
8. `parseArgs(argv)` returns `{statuses, raw, json}` or throws `{code: 2, message}`.
   - One positional or `--status <list>`, plus `--json` anywhere.
   - Usage errors: a positional together with `--status`, `--status` without a value, an unknown flag, or more than one positional.
   - Usage message: `Usage: backlog-list [status[,status...]] [--status <list>] [--json]`.
9. `normalizeStatuses(raw)` splits on `,`, lowercases and applies aliases (`open` is pending, `done` is completed).
   - `all` matches everything.
   - An unknown or empty item throws `Unknown status "<value>". Valid: pending, in-progress, blocked, completed, all`. The value is the item as typed, and `""` for an empty item.
10. `formatTable(items, all, extras, rawFilter)`.
    - Header `STATUS SLUG TYPE PRI TITLE NOTE`. Each column is padded to its widest cell and joined with two spaces.
    - Trim trailing whitespace on every line.
    - `-` for a missing TYPE or PRI.
    - Blank line, then the footer `pending N · in-progress N · blocked N · completed N · total N`, computed over all items.
    - Add `Not in index: a, b` only when non-empty.
    - If the filter matches nothing, print `No items with status: <raw>` instead of the header and rows.
11. `formatJson(items)` returns `JSON.stringify` of objects with exactly `status, slug, type, priority, title, note, hasBrief`.
    - `null` for absent type and priority, `""` for an empty note.
    - No footer. `[]` when empty.
12. `main(argv, env, io)` runs in this order: parse args, then the index check, then output.
    - Argument errors exit 2 before the index is read.
    - A missing index writes `Docs/backlog/index.md not found` to stderr and exits 1, with stdout empty.
    - Otherwise print and exit 0.
    - Use `process.exitCode` or return the code, so it can be tested without `process.exit` killing Jest.
13. Bottom of the file: `module.exports = {...}; if (require.main === module) process.exitCode = main(process.argv.slice(2), process.env);`.
    - Keep it free of the executable bit and the shebang requirement.
    - Make sure it writes no files.

### 2. Wiring
1. `package.json`: add `"backlog": "node scripts/backlog-list.cjs"` to `scripts`. Do not add or change other keys.
2. `.claude/commands/backlog-list.md`: a short prompt.
   - Run `node scripts/backlog-list.cjs $ARGUMENTS` with the Bash tool.
   - Show the output unchanged in a code block.
   - No arguments means all items.
   - The file must contain `scripts/backlog-list.cjs` and `$ARGUMENTS`.

### 3. Docs
1. `Docs/backlog/index.md`: add one legend line under the header. It covers `[ ]` pending, `[x]` completed, `[!]` blocked, and in-progress derived from an `sdlc/<slug>` branch.
   - Keep `scripts/sdlc.sh`'s `grep -m1 '^- \[ \]'` and the tick `sed` working. The legend must not start with `- [ ]`, so write it as plain text.
2. `README.md`: new "Backlog" section with the markers, the statuses, and these examples: `npm run backlog`, `npm run backlog -- pending,in-progress`, `/backlog-list blocked`.
3. `CLAUDE.md`: add a row to the commands table: `/backlog-list [status]` or `npm run backlog -- [status]`, with the purpose "List the backlog, optionally filtered by status".

### 4. Tests (Red tests stage writes them first; Implement makes them pass)
- `backlog-list.test.js`
  - Uses `fs.mkdtempSync` roots with `BACKLOG_ROOT`, and `git init` plus `git branch` where branches are needed. For remote-tracking refs it creates `refs/remotes/origin/sdlc/<slug>` via `git update-ref`.
  - Covers criteria 1-7 and 9.
  - For criterion 7 it hashes the tree and runs `git status` before and after a run.
- `backlog-list-wiring.test.js`
  - Text checks for criterion 8, with no `X_OK` assertions.
  - Checks the command file contents and the `backlog` script in `package.json`.
  - Checks that `scripts/sdlc.sh` still contains `grep -m1 '^- \[ \]'`.
  - Applies that grep and the tick `sed` pattern to a sample index with a `[!]` line, and asserts neither selects nor changes it.
  - Checks the README section, the `CLAUDE.md` row and the `index.md` legend (criterion 10).

### 5. Verify
- `npm test` from the repo root, which also runs `scripts/` tests through `server/__tests__/scripts/`.
- Manual smoke test: `npm run backlog`, `npm run backlog -- blocked --json`, and `node scripts/backlog-list.cjs bogus` (expect exit 2).
- `git status` must show only the files listed above.

## Risks and notes
- **Legend vs `sdlc.sh`:** a legend line that begins `- [ ]` would be picked as the next item, so the wording matters. The wiring test guards this.
- **Duplicate slugs:** every line is listed and counted, so the footer total equals the number of matching lines.
- **Git detection:** run `git -C <root>`. The root is a temp directory in tests, and a non-repo root must stay silent. The parent directory may be a repo, so a temp directory under the repo tree could give false results. Tests should create temp directories under `os.tmpdir()`.
- **Exit handling:** `main` returns a code rather than calling `process.exit`, so the Jest tests can call it in-process. The CLI tests use `spawnSync('node', [script, ...])` for exit codes and stderr.
