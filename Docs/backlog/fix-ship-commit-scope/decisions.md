
## Round 1 (2026-10-06)

### Q1: Which skip reason wins when a candidate matches several rules?
A path can match more than one skip rule (for example `server/.env` that was already dirty before the run and was edited again, or a 2 MiB `.pem`). The brief gives one `reason` per skipped entry and the tests assert the reason, so the precedence must be fixed.
**Suggested:** One entry per path, with the first matching rule in this order: `sensitive file`, `local or agent configuration`, `generated`, `pre-existing local changes`, `too large`. Secrets and config therefore keep their own reason even when the file was also dirty at baseline.
**Answer:** accept

### Q2: At what depth do the skip patterns match?
The brief names the patterns (`.env`, `.env.*`, `*.pem`, `.vscode/**`, `.claude/**`, `node_modules/**`, `.DS_Store`) and the motivating case is `server/.env`, but it does not say whether they match only at the repo root or at any directory depth (for example `server/node_modules/x`, `client/.vscode/s.json`, `Engineering/.claude/x`).
**Suggested:** Match at any depth, by path segment or file name (like an unanchored `.gitignore` pattern). `id_rsa*`, `*.key`, `*.p12`, `*.keystore` and `*.pem` match on the file's base name; `.env.example` is the only `.env.*` exception, at any depth.
**Answer:** accept

### Q3: How do the helpers fail on bad input?
The brief does not define behaviour for a missing or unparsable baseline file passed to `changed`, a missing or unknown subcommand, a missing argument to `sdlc-ship.sh`, or running outside a git repository. Silently treating a bad baseline as empty would make every pre-existing change look like a cycle change and commit the developer's work.
**Suggested:** `sdlc-changes.cjs` exits 1 with a one-line message on stderr for each of these cases and prints nothing on stdout. `sdlc-ship.sh` checks for exactly 4 arguments (usage message, exit 1) and exits 1 if the helper fails, without committing anything. A missing baseline is never treated as empty by `changed` (only `sdlc.sh` creates one, per the `FROM=implement` rule).
**Answer:** accept

### Q4: Can the backlog file be part of the `feat` commit?
If `Docs/backlog/index.md` changed during the cycle (for example an agent edited it), the helper would list it in `include` and it would go into the `feat` commit, before the dedicated tick commit. The brief does not say whether the backlog file is excluded from `include` or how this interacts with the "dirty at baseline" rule.
**Suggested:** Exclude the `<backlog-file>` path from the `feat` commit in `sdlc-ship.sh` (it is only ever committed by the tick step, and only when it was not dirty at baseline). It is not listed under skipped and is not counted in "Committed N file(s)" unless the tick commit is made, in which case it adds 1 to N.
**Answer:** accept

### Q5: What does `ship-skipped.md` contain when nothing was skipped, and what are the formats?
The brief says "a line per path with its reason" and that the list is printed, but not the line format, the empty case, or the truncation rule for the commit body when more than 50 paths are committed.
**Suggested:** Each line is `- <path>: <reason>`, in the order the helper returns them. If nothing was skipped, the file is still written, containing the single line `No files skipped.`, and that line is printed. When more than 50 paths are committed, the body lists the first 50 and ends with the line `... and K more` (K = remaining count). `N` in the DONE line counts all committed files in the `feat` commit (plus the backlog file when its tick commit is made), regardless of the 50-line body limit.
**Answer:** accept

