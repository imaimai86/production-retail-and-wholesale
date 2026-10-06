# add-backlog-list

Type: feature
Priority: P3 (nice to have)
Source: user request: "add command `backlog-list` to list all items in backlog with status filter pending completed blocked etc".

## Problem
The only way to see the backlog is to open `Docs/backlog/index.md` and read it by hand. The index shows just pending (`[ ]`) and completed (`[x]`); there is no way to mark an item as blocked, no priority or type at a glance, and no way to spot an item that has a brief but no index line (for example `fix-database-url`) or an index line without a brief.

## Expected behaviour
`/backlog-list [status]` (and `npm run backlog -- [status]`) prints the backlog as a table, optionally filtered by status, without changing anything.

## Decisions
- Implementation: a dependency-free Node script `scripts/backlog-list.cjs` does the work (so it is testable). It is run with `node`, never directly, so it does not need the executable bit (the pipeline's agents cannot run `chmod`). When it is `require`d it exports its parsing functions and does not run `main`; it runs `main` only when executed directly.
- Slash command `.claude/commands/backlog-list.md`: runs `node scripts/backlog-list.cjs $ARGUMENTS` with the Bash tool and shows the output unchanged in a code block (no arguments means all items). Root `package.json` gets the script `"backlog": "node scripts/backlog-list.cjs"`.
- Status markers in `Docs/backlog/index.md` (line format stays `- [<marker>] \`slug\` - <Bug|Feature>: <title>`): `[ ]` pending, `[x]` completed, `[!]` blocked. A blocked item states why with a trailing `(blocked: <reason>)`, which is shown in a NOTE column. Older lines without the `Bug:` or `Feature:` prefix (for example `fix-stock-checks`) must still parse.
- Derived status `in-progress`: an item whose marker is `[ ]` and for which a branch `sdlc/<slug>` exists locally (`git branch --list`) or as a remote-tracking ref (`git branch -r --list "origin/sdlc/<slug>"`). No network access. A completed or blocked item is never in-progress. The five statuses are mutually exclusive: `pending` means `[ ]` WITHOUT such a branch. If git is unavailable or the directory is not a repository, skip the in-progress detection silently.
- Filter: first positional argument or `--status`, a comma-separated list of `pending`, `in-progress`, `blocked`, `completed`, `all` (default `all`), case-insensitive, with aliases `open` for pending and `done` for completed. An unknown value prints `Unknown status "<value>". Valid: pending, in-progress, blocked, completed, all` to stderr and exits 2.
- Output (plain text, no colours): a table in index order with columns `STATUS`, `SLUG`, `TYPE`, `PRI`, `TITLE`, `NOTE`. TYPE comes from the line prefix, else the `Type:` line of the brief, else `-`. PRI is the `P0` to `P3` from the `Priority:` line of `Docs/backlog/<slug>/brief.md`, else `-` (older briefs have none). TITLE is the text after the prefix, without the blocked note, not truncated.
- Footer lines, always computed over ALL items regardless of the filter: `pending N · in-progress N · blocked N · completed N · total N`; then, only when non-empty, `Not in index: <slugs>` (folders under `Docs/backlog/` that contain a `brief.md` but have no index line) and the NOTE `no brief` on index lines whose `Docs/backlog/<slug>/brief.md` is missing.
- If the filter matches nothing: print `No items with status: <filter>` and exit 0 (the footer is still printed).
- `--json`: instead of the table, print a JSON array of objects `{ "status", "slug", "type", "priority", "title", "note", "hasBrief" }` for the filtered items and nothing else.
- Exit codes: 0 success; 1 when `Docs/backlog/index.md` is missing (message `Docs/backlog/index.md not found`); 2 for bad arguments.
- Read-only: the script writes no files and runs only `git branch --list` style read commands. It finds the repo root from its own location (`path.join(__dirname, '..')`), overridable with the environment variable `BACKLOG_ROOT` (used by the tests), so it works from any directory.
- `scripts/sdlc.sh` is not changed. Its pick rule `grep -m1 '^- \[ \]'` and its tick `sed` already ignore `[!]` lines; a test asserts this.
- Docs: `Docs/backlog/index.md` header gets a one-line legend of the markers and the derived in-progress status.

## Scope
- In: `scripts/backlog-list.cjs` (new), `.claude/commands/backlog-list.md` (new), root `package.json` (one script), `Docs/backlog/index.md` (header legend only), `README.md`, `CLAUDE.md`.
- Out of scope: commands that set or clear the blocked marker (edit the index by hand), changing `scripts/sdlc.sh` or `.claude/commands/triage.md`, editing any brief, network calls, colours, interactive prompts.

## Tests
- New `server/__tests__/scripts/backlog-list.test.js`: each case builds a temporary directory with `Docs/backlog/index.md` and briefs (a `git init` repository where branches are needed) and runs `node scripts/backlog-list.cjs` with `BACKLOG_ROOT` pointing at it. Cases:
  - `[ ]`, `[x]` and `[!]` lines get the statuses pending, completed and blocked; an old-format line without `Bug:` or `Feature:` parses; the `(blocked: reason)` text appears in NOTE and not in TITLE.
  - A pending item with a local branch `sdlc/<slug>` is `in-progress`; one with only a remote-tracking ref (`git update-ref refs/remotes/origin/sdlc/<slug> HEAD`) is also `in-progress`; a completed item with such a branch stays `completed`; outside a git repository nothing is in-progress and nothing throws.
  - Filters: single value, comma list, `all`, no argument, `--status pending`, aliases `open` and `done`, mixed case; unknown value exits 2 with the exact message on stderr and nothing on stdout.
  - TYPE and PRI: from the line prefix and the brief; `-` when absent; `Priority: P1 (blocks use)` gives `P1`.
  - Footer counts ignore the filter; a folder with `brief.md` and no index line appears under `Not in index`; an index line with no brief shows `no brief`; an empty filter result prints `No items with status: blocked` and exits 0.
  - `--json` output parses and has exactly the listed fields; index missing exits 1 with the message.
  - Read-only: the directory tree (file hashes) and `git status` are identical before and after a run.
- New `server/__tests__/scripts/backlog-list-wiring.test.js` (text checks, no `X_OK` assertions): `.claude/commands/backlog-list.md` exists and contains `scripts/backlog-list.cjs` and `$ARGUMENTS`; root `package.json` has a `backlog` script that runs the script; `scripts/sdlc.sh` still contains `grep -m1 '^- \[ \]'`; applying that grep and the tick `sed` pattern to a sample index with a `[!]` line neither selects nor changes it.

## Docs
- `README.md`: a "Backlog" section with the markers, the statuses, and examples (`npm run backlog`, `npm run backlog -- pending,in-progress`, `/backlog-list blocked`).
- `CLAUDE.md`: one row in the commands table for `/backlog-list`.
- `Docs/backlog/index.md`: the one-line legend in the header.

## Open questions
- none
