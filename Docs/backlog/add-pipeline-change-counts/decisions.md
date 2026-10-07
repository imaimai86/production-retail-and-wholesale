
## Round 1 (2026-10-07)

### Q1: Message and exit code when the run record exists but the worktree is gone
The brief says `changes <slug>` exits 1 with `No pipeline for <slug>` when there is "no record and no worktree", and the Tests section expects "a worktree deleted by hand exits 1". It does not say what is printed when a run record exists but its worktree folder (and the `$WT_BASE/<slug>` fallback) is missing. Without an exact message, the spec and the test cannot assert on stderr, and `--json` callers cannot tell this case from an unknown slug.
**Suggested:** Same behaviour as an unknown slug: exit 1 and print `No pipeline for <slug>` on stderr (nothing on stdout, for both plain and `--json`). The pane treats any non-zero exit as "no counts" (`changes: null`).
**Answer:** Use a distinct message: when the run record exists but its worktree folder and the $WT_BASE/<slug> fallback are both missing, exit 1 and print `Worktree for <slug> is gone` on stderr, nothing on stdout (plain and --json). An unknown slug (no record and no worktree) keeps `No pipeline for <slug>`. The pane still treats any non-zero exit as no counts (changes: null).

### Q2: Pipeline view line when counts are unavailable or both zero
The brief defines the overview row for null, 0/0 and non-zero counts, but for the pipeline view it only defines the line `Files  N changed since <base> · M uncommitted`. It does not say whether the line is shown when `changes` is null (unmanaged or discarded run, or a failed `changes` call), or when both numbers are 0.
**Suggested:** Omit the `Files` line when `changes` is null. Show it with the real numbers (e.g. `Files  0 changed since base · 0 uncommitted`) whenever `changes` is not null, including 0/0, whatever the run state.
**Answer:** accept
