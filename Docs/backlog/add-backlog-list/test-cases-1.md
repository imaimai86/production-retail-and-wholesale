# Test cases: add-backlog-list

Based on `specs-1.md` and `plan-1.md`. Tests live in `server/__tests__/scripts/`:
- `backlog-list.test.js` (BL): CLI via `spawnSync` with `BACKLOG_ROOT` set to a temp directory under `os.tmpdir()`, `git init` where branches are needed, plus in-process `require` tests.
- `backlog-list-wiring.test.js` (WR): text checks only, no `X_OK` assertions.

Red tests stage: every test fails until `scripts/backlog-list.cjs` and the wiring/docs exist.

## Matrix

| ID | Criterion | Case | Expected | Test |
|---|---|---|---|---|
| BL-01 | 9 | `require` the script | Exports `parseIndex`, `parseTitle`, `parseBrief`, `parseArgs`, `normalizeStatuses`, `formatTable`, `formatJson`, `main`; nothing written to stdout | `require()` |
| BL-02 | 1 | Markers ` `, `x`, `X`, `!` | All four parsed as items | `parseIndex` |
| BL-03 | 1 | Header, blank, `[-]`, line without backticked slug | Ignored | `parseIndex` |
| BL-04 | 1 | Duplicate slug | Both entries kept, both counted (footer total) | `parseIndex`, criterion 1 |
| BL-05 | 1 | `Bug:` / `Feature:` prefix, any case | TYPE lowercased, title without prefix | `parseTitle` |
| BL-06 | 1 | Old-format line (no prefix) | Whole text is the title, no type | `parseTitle`, criterion 1 |
| BL-07 | 1 | Trailing `(blocked: reason)` | Removed from title, reason in note | `parseTitle`, criterion 1 |
| BL-08 | 1 | `[!]` without `(blocked:)` | blocked, note has no reason | criterion 1 |
| BL-09 | 1 | `[x]` / `[ ]` with `(blocked:)` | Status kept, text moved to note | criterion 1 |
| BL-10 | 1 | 300-char title | Not truncated | `parseTitle`, table layout |
| BL-11 | 2 | `[ ]` + local `sdlc/<slug>` | in-progress | criterion 2 |
| BL-12 | 2 | `[ ]` + only `refs/remotes/origin/sdlc/<slug>` | in-progress | criterion 2 |
| BL-13 | 2 | `[x]` / `[!]` with a branch | Status unchanged | criterion 2 |
| BL-14 | 2 | Similar branch names (`sdlc/abcd`, `feature/abc`) | Not in-progress | criterion 2 |
| BL-15 | 2 | Root is not a git repo | Exit 0, no in-progress, stderr empty | criterion 2 |
| BL-16 | 2 | in-progress in table and footer | Lowercase status, footer counts it | criterion 2 |
| BL-17 | 3 | No argument, `all`, single value, comma list, `--status`, each status | Correct slugs in index order | criterion 3 filters |
| BL-18 | 3 | Aliases `open`, `done`; mixed case `PENDING`, `Open,DONE` | Mapped to pending / completed | criterion 3 filters |
| BL-19 | 3 | Table mode with a filter | Only matching rows, index order | criterion 3 |
| BL-20 | 3 | `bogus`, `pending,`, `,pending`, `pending,,blocked`, `""` | Exit 2, stdout empty, exact `Unknown status "<value>"...` (`""` for an empty item) | criterion 3 |
| BL-21 | 3 | Unknown value with mixed case, with `--json` | Value echoed as typed, exit 2, stdout empty | criterion 3 |
| BL-22 | 3 | Positional + `--status`, `--status` with no value (also followed by a flag), unknown flag, 2 positionals | Exit 2, stdout empty, exact usage line | criterion 3 |
| BL-23 | 3, 6 | Bad arguments and a missing index together | Exit 2 (arguments checked first) | criterion 3 |
| BL-24 | 3 | `parseArgs` / `normalizeStatuses` unit | `--json` in any position; usage and Unknown errors thrown with code 2 | `parseArgs / normalizeStatuses` |
| BL-25 | 4 | Prefix and brief `Type:` both present | Prefix wins | criterion 4 |
| BL-26 | 4 | No prefix, brief `Type: Bug` / `feature` | Lowercased brief value | criterion 4 |
| BL-27 | 4 | `Priority: P1 (blocks use)` | `P1` | criterion 4 |
| BL-28 | 4 | No brief, no Priority line, no P0-P3 token | `null` in JSON, `-` in table | criterion 4 |
| BL-29 | 5 | Footer with a filter | Counts computed over all items | criterion 5 |
| BL-30 | 5 | Folders with `brief.md` but no index line | `Not in index: alpha, zeta` (sorted); folders without a brief and plain files excluded | criterion 5 |
| BL-31 | 5 | No such folders | No `Not in index` line | criterion 5 |
| BL-32 | 5 | Footer placement | One blank line, footer, then `Not in index` as the last line | criterion 5 |
| BL-33 | 5 | Missing brief | `no brief`; blocked + no brief is `<reason>; no brief` | criterion 5 |
| BL-34 | 5 | Filter matches nothing | `No items with status: blocked`, blank line, footer, exit 0; filter text as typed | criterion 5 |
| BL-35 | 5 | Index has no items | Exit 0, `No items with status: all`, `total 0` | criterion 5 |
| BL-36 | 7 | Table layout | Exact header and padded rows, two-space separators, `-` for missing, empty NOTE blank | table layout |
| BL-37 | 7 | Whitespace and decoration | No trailing whitespace, no ANSI colours, no border lines, one final newline | table layout |
| BL-38 | 6 | `--json` shape | Array; exactly the seven fields; `hasBrief` boolean | criterion 6 |
| BL-39 | 6 | JSON absent values | `type`/`priority` null, `note` `""` | criterion 6 |
| BL-40 | 6 | JSON extras | No footer or `No items` line; `[]` when empty | criterion 6 |
| BL-41 | 6 | `--json` with `--status`, any position | Works | criterion 6 |
| BL-42 | 6 | Missing `Docs/backlog/index.md` (table, JSON, filter) | Exit 1, stderr `Docs/backlog/index.md not found`, stdout empty | criterion 6 |
| BL-43 | 3 | `BACKLOG_ROOT` with cwd `/` | Works from any working directory | root resolution |
| BL-44 | 3 | `BACKLOG_ROOT` unset | Falls back to the repo root, exit 0, valid JSON | root resolution |
| BL-45 | 7 | Hash the tree, `git status`, branch list before and after several runs (including errors) | Identical | criterion 7 |
| BL-46 | 7 | Script source | No file-write or network calls | criterion 7 |
| WR-01 | 8 | `.claude/commands/backlog-list.md` | Exists; contains `scripts/backlog-list.cjs` and `$ARGUMENTS` | criterion 8 |
| WR-02 | 8 | Root `package.json` | `scripts.backlog` is `node scripts/backlog-list.cjs` | criterion 8 |
| WR-03 | 8 | `scripts/sdlc.sh` | Still contains `grep -m1 '^- \[ \]'` | criterion 8 |
| WR-04 | 8 | Sample index with `[!]` line, `grep -m1` | Selects the `[ ]` line, nothing if only `[!]` left | criterion 8 |
| WR-05 | 8 | Tick `sed` on the `[!]` slug | File unchanged; the target `[ ]` slug is ticked | criterion 8 |
| WR-06 | 10 | README | "Backlog" section with markers, statuses and the three examples | criterion 10 |
| WR-07 | 10 | `CLAUDE.md` | Commands table row for `/backlog-list` with `npm run backlog` | criterion 10 |
| WR-08 | 10 | `Docs/backlog/index.md` | Legend names the markers and in-progress/`sdlc/<slug>`; it does not start with `- [ ]`; all item lines keep their format | criterion 10 |
| WR-09 | 11 | `triage.md` | Does not mention `backlog-list` (unchanged) | scope |

## Notes
- Table expectations in BL-36 are a hand-written literal, so padding bugs in the implementation cannot be mirrored by the test.
- Temp directories are under `os.tmpdir()` so a parent repo cannot leak into in-progress detection (plan risk "Git detection").
- Remote-tracking refs are made with `git update-ref refs/remotes/origin/sdlc/<slug> HEAD`, with no network.
- Assumption beyond the spec: `--status` followed by another flag (`--status --json`) counts as "without a value" (exit 2, usage).
