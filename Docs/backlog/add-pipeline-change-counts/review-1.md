# Review 1: add-pipeline-change-counts

Reviewed `git diff 9e181b5` against `specs-1.md`.

## Verdict: not ready. The control pane part (spec section 3) is missing.

### Blocking
1. **Control pane not implemented.** The diff has no change to `.claude/plugins/sdlc-monitor/hooks/register.tsx` or `types/index.d.ts`, and `register.test.ts` has no tests for items 11-15. Missing:
   - `Run.changes` (and a `base` field for the pipeline view).
   - A `loadChanges` helper that calls `bash scripts/sdlc-mod.sh changes <slug> --json`. It returns `null` for an unmanaged run, a non-zero exit or unparseable output. It refreshes on every poll for running, paused and starting runs. For finished runs it reuses the cached result (including `null`) for 10 s.
   - The `· N files changed (M uncommitted)` / `· no changes yet` suffix in `oneLine`.
   - The `Files  N changed since <base|base> · M uncommitted` line in the pipeline view.

   I wrote these edits but could not apply them. Edits to files under `.claude/` were refused as sensitive-file permission requests, and I did not work around the refusal. **Action needed:** grant edit permission for `.claude/plugins/sdlc-monitor/`, or apply the change by hand, then add the pane tests for items 11-15.

### Script (`scripts/sdlc-mod.sh`, `cmd_changes`): no defects found
- The null-separated (`-z`) `status` and `diff` parsing handles spaces and quoting in paths. Renames and copies skip the extra "old path" entry and count the new path.
- A file committed and then edited counts once (Set union). `changed` is the true total and `files` is capped at 50, sorted.
- A missing merge-base gives a committed part of 0 and exit 0. A missing record or worktree gives the two distinct error messages with exit 1 and empty stdout.
- All git calls use `git -C "$wt"`. There is no network call. Temp files are removed on both paths.
- `--json` works before or after the slug. Usage text, header comment, README and CLAUDE.md are updated as in section 4.

### Minor notes (not changed)
- A `base` value in a hand-edited record that begins with `-` would be read by `git merge-base` as an option. It is local, trusted data and the failure is swallowed, so I left it.
- `package-lock.json` and `server/package-lock.json` show large diffs (~950 lines). They look like side effects of the session-start `npm install`, not part of this feature. Ship should skip them or they should be restored.
