# Review 1: add-base-branch-dropdown

Diff reviewed: `git diff 6aa9c66` against `specs-1.md`. The diff touches `scripts/sdlc-mod.sh`, `README.md` and two lockfiles.

## Result
No source fix was needed in the wrapper. I read it against spec sections 2.1 to 2.9 and found no correctness or security defects. I did not run it or the tests: `bash -n` and the test suite were blocked by the permission prompts in this session.

Checked and found correct:
- **Name validation** runs before any existence check or fetch. `--evil`, `a..b`, spaces and an empty string exit 2. The name is passed to `git fetch` and `git` refs as an argument and never reaches a shell string. A leading `-` is rejected, so it cannot be read as an option.
- **Flag parsing:** a missing or repeated `--base` is a usage error (exit 2). `restart` takes `--yes` and `--base` in either order.
- **Precedence** is `--base`, then `SDLC_BASE`, then the default. An empty `SDLC_BASE` counts as unset. Only the default falls back, and an explicit missing name exits 7 with the exact message.
- **Exit 7 on a reuse:** it is recorded through `fail_start` and checked before the capacity (3) and merged (5) checks. It also fires when `sdlc/<slug>` or its worktree already exists.
- **Fetch** happens only when a new branch and worktree will be created. It is bounded to about 20 seconds without `timeout`, is skipped when there is no `origin`, and a failure is only logged.
- **Resolution rule:** `origin/<name>` wins unless the local branch is ahead of it or diverged. Names with `/` work.
- **Run record:** `base` is rewritten on every run, including a resume. `cmd_changes` falls back to `pick_base` only when the record has no `base`.

## Notes (no change made)
- **The control pane is not implemented in this diff.** `.claude/plugins/sdlc-monitor/hooks/register.tsx` and `types/index.d.ts` are unchanged. That means the dropdown, per-slug `bases` atom, queue carrying the base, Start page, `from <base>` in the pipeline view, the "base ignored" note and acceptance criteria 14 to 18. This is the main gap against the spec.
- **`CLAUDE.md` is not updated.** The `sdlc-mod` command row still lacks `--base`, which spec section 5 (Docs) requires.
- **Restart checks the base against unfetched refs.** `cmd_restart` runs the existence check before the fetch, which happens later in `cmd_run`. A remote-only branch that is not yet fetched locally is refused with exit 7 on `restart --base`, but `run --base` would find it. This matches spec 2.4 and 2.5 (the fetch is in the run half), so I left it. The user can run `git fetch origin <name>` first.
- **The two `package-lock.json` files changed for an unrelated reason.** The change appears to come from the session `npm install`: it removes `express`, `fs-extra` and `swagger-ui-express` from the root lock, and adds `swagger-ui-express` to `server/package-lock.json`. It is not part of this feature. I suggest dropping it from the commit unless it was intended.
