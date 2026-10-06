
## Round 1 (2026-10-06)

### Q1: Casing of TYPE
The index prefix is `Bug:` / `Feature:` (capitalised) but the brief's `Type:` line is lowercase (`bug`, `feature`). The TYPE column and the JSON `type` field come from either source, so the output (and the tests) need one canonical form. Without it the same item could show `Feature` or `feature` depending on where it was read.
**Suggested:** Normalise to lowercase `bug` / `feature` in both the table and JSON; `-` when neither source gives a value. Any other `Type:` value in a brief is shown lowercased as written.
**Answer:** accept, with one amendment: in JSON mode `type` and `priority` are `null` when absent and `note` is an empty string; the table still shows `-` for a missing type or priority and prints nothing for an empty note.

### Q2: Table layout and ordering details
The brief lists the columns but not how they are rendered (separator, header row, padding) nor how the TITLE and NOTE cells behave for long text. Tests need exact, stable expectations.
**Suggested:** A header row with the six column names, columns left-aligned and padded with spaces to the widest cell, separated by two spaces, no border lines, no trailing whitespace. STATUS values print lowercase (`pending`, `in-progress`, `blocked`, `completed`). Empty NOTE prints nothing. Rows are in index order, and the footer follows after one blank line.

**Answer:** accept

### Q3: Footer and "No items" output with `--json`
The brief says `--json` prints the filtered array "and nothing else", but also says the footer is printed when the filter matches nothing. These conflict for JSON mode.
**Suggested:** With `--json`, stdout is only the JSON array (`[]` when nothing matches); no footer, no `No items with status:` line. Footer information is available only in table mode.
**Answer:** accept

### Q4: Argument handling when both positional and `--status` are given, or extra arguments
The brief allows a first positional argument or `--status`, but does not say what happens if both appear, if `--status` has no value, or if other unknown flags or extra positionals are passed. These are "bad arguments" (exit 2) but the message is unspecified.
**Suggested:** Treat as bad arguments: exit 2, nothing on stdout, a one-line usage message on stderr (`Usage: backlog-list [status[,status...]] [--status <list>] [--json]`) for: both positional and `--status`, `--status` without a value, an unknown flag, or more than one positional. `--json` may be combined with either form and appear in any position. An empty list item (e.g. `pending,`) is an unknown status `""` and uses the standard Unknown status message.
**Answer:** accept

### Q5: Malformed or unrecognised index lines
The brief defines `[ ]`, `[x]`, `[!]` but not other markers (e.g. `[X]`, `[-]`), lines without a backticked slug, or duplicate slugs. Silent guessing could hide items or mis-count them.
**Suggested:** Only lines matching `- [ ]`, `- [x]` or `- [!]` followed by a backticked slug are items; `[X]` (uppercase) is accepted as completed. Any other line (header, blank, other markers, no slug) is ignored. If a slug appears twice, both lines are listed and counted. A `[!]` line without `(blocked: ...)` is blocked with an empty NOTE; a `[ ]`/`[x]` line containing `(blocked: ...)` keeps its status and the text is still removed from TITLE and shown in NOTE.
**Answer:** accept

### Q6: NOTE when both blocked reason and `no brief` apply
The NOTE column holds the blocked reason and also the `no brief` marker. A blocked item with a missing brief has both.
**Suggested:** Join them as `<reason>; no brief`. The JSON `note` field holds the same string, and `hasBrief` is the boolean.
**Answer:** accept
