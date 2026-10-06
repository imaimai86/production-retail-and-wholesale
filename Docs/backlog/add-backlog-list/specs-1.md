# Spec: add-backlog-list

Type: feature · Priority: P3. Sources: `brief.md` and `decisions.md` (Round 1 answers are binding).

## 1. Purpose
`/backlog-list [status]` and `npm run backlog -- [status]` print the backlog from `Docs/backlog/index.md` as a table, optionally filtered by status. The command is read-only.

## 2. Components
| Item | Change |
|---|---|
| `scripts/backlog-list.cjs` | New, dependency-free Node script. Exports its parsing functions when `require`d and does not run `main`. Runs `main` only when executed directly. Run with `node`; it needs no executable bit. |
| `.claude/commands/backlog-list.md` | New slash command. Runs `node scripts/backlog-list.cjs $ARGUMENTS` with the Bash tool and shows the output unchanged in a code block. No arguments means all items. |
| `package.json` (root) | One new script: `"backlog": "node scripts/backlog-list.cjs"`. |
| `Docs/backlog/index.md` | Header gets a one-line legend of the markers and the derived in-progress status. No item line changes. |
| `README.md` | New "Backlog" section: markers, statuses, examples (`npm run backlog`, `npm run backlog -- pending,in-progress`, `/backlog-list blocked`). |
| `CLAUDE.md` | One new row in the commands table for `/backlog-list`. |
| Unchanged | `scripts/sdlc.sh`, `.claude/commands/triage.md`, every brief. |

## 3. Root and environment
- The repo root is `path.join(__dirname, '..')`, overridable with the env var `BACKLOG_ROOT`. The script works from any working directory.
- Input: `<root>/Docs/backlog/index.md`, `<root>/Docs/backlog/<slug>/brief.md` and git branch metadata.
- The script writes no files. The only commands it runs are read-only git commands (`git branch --list`, `git branch -r --list`). It makes no network calls.

## 4. Parsing the index
1. An index line is an item only if it matches `- [<marker>] \`<slug>\`` with marker `' '`, `x`, `X` or `!`. Everything else is ignored: header, blank lines, other markers such as `[-]`, and lines without a backticked slug.
2. Markers: `[ ]` is pending, `[x]` or `[X]` is completed, `[!]` is blocked.
3. Duplicate slugs: every line is listed and counted.
4. Text after the slug is ` - <rest>`:
   - If `<rest>` starts with `Bug:` or `Feature:`, that prefix gives TYPE and the title is the text after it. The prefix is matched case-insensitively and TYPE is lowercased.
   - Otherwise (old-format lines such as `fix-stock-checks`) the whole `<rest>` is the title.
5. A trailing `(blocked: <reason>)` is removed from the title and its reason goes to the note. This applies to any marker, so a `[ ]` or `[x]` line containing it keeps its status. A `[!]` line without it is blocked with an empty reason.
6. The title is trimmed and never truncated.

## 5. Derived fields
- **Status.**
  - `in-progress` means the marker is `[ ]` AND the branch `sdlc/<slug>` exists locally (`git branch --list`) or as the remote-tracking ref `origin/sdlc/<slug>` (`git branch -r --list "origin/sdlc/<slug>"`).
  - `pending` means `[ ]` without such a branch.
  - Completed and blocked items are never in-progress. The five statuses are mutually exclusive.
  - If git is unavailable or the root is not a repository, in-progress detection is skipped silently. No error is raised and nothing is written to stderr.
- **Type.** The line prefix, else the `Type:` line of the brief (value lowercased as written, e.g. `bug`, `feature`), else absent.
- **Priority.** The `P0`-`P3` token from the `Priority:` line of the brief (`Priority: P1 (blocks use)` gives `P1`). Absent if the brief is missing, has no such line, or has no `P0`-`P3` token.
- **hasBrief.** True iff `Docs/backlog/<slug>/brief.md` exists.
- **Note.** The blocked reason and the text `no brief` (when `hasBrief` is false) are joined as `<reason>; no brief`. If only one applies, that one alone. If neither applies the note is empty.

## 6. Arguments
`node scripts/backlog-list.cjs [status[,status...]] [--status <list>] [--json]`
- The status list comes from the first positional argument or from `--status`. The default is `all`.
- Values are comma-separated, case-insensitive, and may be `pending`, `in-progress`, `blocked`, `completed`, `all`. Aliases: `open` is pending, `done` is completed. `all` matches every item.
- `--json` may be combined with either form and may appear in any position.
- Unknown value, including an empty list item such as `pending,`: stderr gets `Unknown status "<value>". Valid: pending, in-progress, blocked, completed, all`, stdout stays empty, exit 2. `<value>` is the offending item as typed (`""` for an empty item).
- Bad usage (a positional together with `--status`, `--status` without a value, an unknown flag, or more than one positional): stderr gets `Usage: backlog-list [status[,status...]] [--status <list>] [--json]`, stdout stays empty, exit 2.

## 7. Table output (default mode)
- Plain text, no colours, no border lines.
- Header row: `STATUS  SLUG  TYPE  PRI  TITLE  NOTE`. Columns are left-aligned and padded with spaces to the widest cell (header included), separated by two spaces, with no trailing whitespace on any line.
- Rows are in index order, filtered by status. STATUS prints lowercase (`pending`, `in-progress`, `blocked`, `completed`). A missing TYPE or PRI prints `-`. An empty NOTE prints nothing.
- One blank line, then the footer. The footer is computed over ALL items regardless of the filter:
  - `pending N · in-progress N · blocked N · completed N · total N`
  - then, only when non-empty, `Not in index: <slug>, <slug>`. These are the folders under `Docs/backlog/` that contain a `brief.md` but have no index line, sorted alphabetically and joined by `, `.
- The `no brief` note on index lines whose brief is missing is part of the NOTE column (section 5).
- If the filter matches no items, the line `No items with status: <filter>` (the filter text as typed) replaces the rows and header, followed by the blank line and the footer. Exit 0.

## 8. JSON output (`--json`)
- stdout is only a JSON array of the filtered items in index order, and nothing else. When nothing matches it is `[]`. There is no footer and no `No items` line.
- Each object has exactly `status`, `slug`, `type`, `priority`, `title`, `note`, `hasBrief`.
  - `type` and `priority` are `null` when absent.
  - `note` is `""` when empty.
  - `type` is lowercase.
  - `hasBrief` is a boolean.

## 9. Exit codes
| Code | When |
|---|---|
| 0 | Success, including a filter that matches nothing. |
| 1 | `Docs/backlog/index.md` is missing. stderr gets `Docs/backlog/index.md not found`, stdout is empty. |
| 2 | Bad arguments (section 6). |

Argument errors (2) are checked before the index is read.

## 10. Acceptance criteria
1. `[ ]`, `[x]`, `[!]` lines give pending, completed and blocked. An old-format line without `Bug:` or `Feature:` parses. `(blocked: reason)` appears in NOTE and not in TITLE.
2. A `[ ]` item with a local `sdlc/<slug>` branch is in-progress. A `[ ]` item with only `refs/remotes/origin/sdlc/<slug>` is also in-progress. A completed or blocked item with such a branch keeps its status. Outside a git repository nothing is in-progress and nothing throws.
3. Filters work as specified: a single value, a comma list, `all`, no argument, `--status pending`, aliases `open` and `done`, and mixed case. An unknown value exits 2 with the exact message on stderr and nothing on stdout. The bad-usage cases of section 6 exit 2 with the usage message.
4. TYPE comes from the prefix, then the brief, else `-` in the table and `null` in JSON. PRI comes from the brief (`P1 (blocks use)` gives `P1`), else `-` and `null`.
5. Footer counts ignore the filter. A folder with `brief.md` and no index line appears under `Not in index`. An index line without a brief shows `no brief` (joined with any blocked reason as `<reason>; no brief`). An empty result prints `No items with status: blocked` and exits 0.
6. `--json` output parses, has exactly the seven fields, uses `null`/`""` for absent values, and prints no footer. A missing index exits 1 with the message.
7. Read-only: file hashes of the tree and `git status` are identical before and after a run.
8. Wiring: `.claude/commands/backlog-list.md` exists and contains `scripts/backlog-list.cjs` and `$ARGUMENTS`. Root `package.json` has a `backlog` script that runs the script. `scripts/sdlc.sh` still contains `grep -m1 '^- \[ \]'`. That grep and the tick `sed` pattern, applied to a sample index with a `[!]` line, neither select nor change it.
9. `require`ing the script exports the parsing functions and does not run `main`.
10. Docs: the README "Backlog" section, the `CLAUDE.md` row and the `index.md` legend are present.

## 11. Out of scope
Commands that set or clear the blocked marker (edit the index by hand), changes to `scripts/sdlc.sh` or `triage.md`, editing any brief, network calls, colours, interactive prompts.

## 12. Test plan pointers
- `server/__tests__/scripts/backlog-list.test.js`: temporary directories with `BACKLOG_ROOT`, and `git init` where branches are needed. Covers criteria 1-7 and 9.
- `server/__tests__/scripts/backlog-list-wiring.test.js`: text checks for criterion 8, with no `X_OK` assertions.
