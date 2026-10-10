# Test cases: add-base-branch-dropdown (round 1)

Sources: `specs-1.md` (criteria 1-18), `plan-1.md`.

Wrapper tests: `server/__tests__/scripts/sdlc-mod-base.test.js` (Jest, run by `npm test`). Each test uses a throwaway git repo, a stub `scripts/sdlc.sh`, and a local bare repo as `origin` where needed. The existing `sdlc-mod.test.js` (including its `changes` base tests) must keep passing; the plan's step 11 may fold these cases into that file.

## A. Wrapper (`scripts/sdlc-mod.sh`), automated

| # | Criterion | Case | Expected |
|---|---|---|---|
| U1 | usage (2.1) | no arguments | exit 2, usage text shows `--base` |
| 1a | 1 | `run alpha --base feat` (local branch) | exit 0; `sdlc/alpha` tip = `feat` tip |
| 1b | 1 | base `release/v1.2` (dot and slash) | accepted; tip = that branch |
| 2a | 2 | branch only as `origin/rem` (local deleted) | tip = `origin/rem` |
| 2b | 2/13 | branch on origin never fetched here | the fetch finds it; tip = pushed commit |
| 3 | 3 | `--base sdlc/other` | tip = `sdlc/other` tip |
| 4a | 4 | origin ahead of local `main` | worktree at origin tip; record `base` = `origin/main` |
| 4b | 4 | local equals origin | record `base` = `origin/main` |
| 4c | 4 | local ahead of origin | local tip kept; `base` = `main` |
| 4d | 4 | local diverged from origin | local tip kept |
| 5a | 5 | `--base` and `SDLC_BASE` both set | `--base` wins |
| 5b | 5 | only `SDLC_BASE` | used |
| 5c | 2.2 | `SDLC_BASE=''` | counts as unset; default `main` |
| 5d | 5 | no flag, other branch checked out | default is `main`, not the checked-out branch |
| 5e | 5 | no `main`, `origin/HEAD` -> `origin/develop` | start from `develop` |
| 5f | 5 | no `main`, no `origin/HEAD` | start from current `HEAD` |
| 5g | 2.2 | `--base main` / `SDLC_BASE=gone` with the fallback available | never falls back: exit 7 |
| 6a | 6 | `run --base nope` | exit 7; record `message` = `base branch 'nope' not found (local or origin)`, `exit_code` `7`; no branch, no worktree |
| 6b | 6 | unknown `SDLC_BASE` | same |
| 6c | 2.9 | refused record | `base` is `nope` or empty |
| 7a | 7 | unknown base, `sdlc/alpha` and worktree exist | exit 7; branch tip and worktree unchanged |
| 7b | 7 | unknown base, branch exists, worktree removed | exit 7; nothing created |
| 7c | 7 | `restart alpha --yes --base nope` | exit 7, message on stderr, nothing deleted |
| 7d | 7 | `discard` with unknown `SDLC_BASE`, with and without `--yes` | exit 7 (not 6), message on stderr, nothing deleted |
| 7e | 2.1 | `discard` resolves its base from `SDLC_BASE` | output says `not in feat` |
| 7f | 2.1 | `discard alpha --base main --yes` | exit 2, nothing deleted |
| 7g | 2.7 | unknown base with `SDLC_MAX_PARALLEL=0`, or with a merged item | exit 7 (before 3 and 5) |
| 7h | 2.7 | valid base with `SDLC_MAX_PARALLEL=0` | exit 3 still |
| 8a | 8 | `--base` = `--evil`, `a..b`, `has space`, empty, `-x`, `semi;colon`, `$(id)` | exit 2; no branch, no worktree |
| 8b | 2.3 | `a..b` | message names the bad value |
| 8c | 2.3 | `SDLC_BASE` = `--evil`, `a..b`, `has space` | exit 2, nothing created |
| 8d | 2.3 | bad name plus `SDLC_MAX_PARALLEL=0` | exit 2 (validation first) |
| 8e | 2.3 | `restart` / `discard` with invalid `SDLC_BASE` | exit 2; nothing deleted |
| 8f | 2.1 | `--base` with no value (`run`, `restart`) | exit 2 |
| 8g | 2.1 | repeated `--base` | exit 2, nothing created |
| 9a | 9 | second run with `--base feat`, branch exists | tip unchanged; wrapper log has `base ignored: sdlc/alpha already exists` |
| 9b | 9 | branch exists, worktree gone | reused, base ignored, log line |
| 9c | 9 | fresh start | no `base ignored` in the log |
| 10a | 10 | `--base feat` | record `base` = `feat` |
| 10b | 10 | default, no origin | record `base` = `main` |
| 10c | 2.9 | record fields | `slug`, `state`, `exit_code`, `interrupted`, `message` intact (valid JSON) |
| 10d | 10 | resume with a different `--base` | record `base` rewritten |
| 10e | 2.9 | `changes` after `--base feat` | uses the recorded base |
| 11a | 11 | red-tests commit only on the chosen base | exit 5, message names that base; default base still starts |
| 11b | 2.8 | same, `SDLC_ALLOW_MERGED=1` | starts |
| 11c | 11 | brief committed only on the chosen base | `run fresh` (main) exits 1; `--base withbrief` exits 0, brief tracked in the worktree |
| 11d | 2.7 | brief missing in base | copied from the main working tree |
| 11e | 2.7 | base without the item in the index | allowed |
| 12a | 12 | `restart alpha --yes --base feat` | exit 0; tip = `feat`; record `base` = `feat` |
| 12b | 12 | `restart alpha --base feat --yes` | same |
| 12c | 2.1 | `restart` without `--yes` | exit 6, nothing deleted |
| 12d | 2.8 | `restart --yes --base merged-b` | exit 5, nothing deleted |
| 12e | 2.2 | `restart --yes` with `SDLC_BASE=feat` | tip = `feat` |
| 12f | 2.5 | `restart --yes`, origin ahead | fetch on the fresh branch: tip = origin commit |
| 13a | 13 | commit pushed to origin | picked up before the worktree is created |
| 13b | 13 | explicit base `feat`, origin ahead | tip = origin's newest `feat` |
| 13c | 13 | origin URL unreachable | exit 0, branch created, log matches `fetch ... failed or timed out` |
| 13d | 2.5 | base not on origin (local only) | starts from local |
| 13e | 2.5 | no `origin` remote | no error in log |
| 13f | 13 | branch and worktree exist, origin ahead | `origin/main` ref unchanged (no fetch) |
| 13g | 13 | only the branch exists | no fetch |
| 13h | 2.4 | unknown base with an origin | exit 7, nothing left behind |
| 13i | 13 | origin that hangs (`ext::sleep 120`) | start succeeds in under 40 s (about 20 s limit); failure logged. Slow test (about 20 s). |

## B. Control pane, outside this Jest suite

Criteria 14-18 target `register.tsx`, which is tested by `.claude/plugins/sdlc-monitor/hooks/register.test.ts` under the `claude-code/testing` runner, not Jest. This task may only add files under `server/__tests__/`, so these cases are listed here for the Implement stage to add to `register.test.ts` (stubbed `$.process.run`, as the existing tests do). Nothing in `server/__tests__/` exercises them.

| # | Criterion | Case | Expected |
|---|---|---|---|
| 14a | 14 | stubbed `for-each-ref` output with local, remote-only, `sdlc/*` and `origin/HEAD` | options hold each name once, no `origin/HEAD`, `main` first, `main` selected |
| 14b | 3.1 | branch list command fails | dropdown offers `main` only; pane keeps working |
| 14c | 3.2 | no `main`, `origin/HEAD` -> `develop` | `develop` selected; else first option |
| 15a | 15 | choose a branch on row `one` | `two` and `three` keep their value |
| 15b | 15 | launch `one` | its `bases` entry is cleared |
| 15c | 3.2 | row checkbox `sel-<slug>` | still present, selection semantics unchanged |
| 16a | 16 | Run selected with 3 slugs, 2 free slots | two launches, each `--base <own base>`; third queued with its base |
| 16b | 16 | `drainQueue` when a slot frees | launches the queued slug with the base chosen at queue time |
| 16c | 3.3 | slug and base reach the shell as separate arguments | not interpolated into the command string |
| 17a | 17 | Start page after a discard | dropdown shown; Start passes `--base` |
| 17b | 17 | Resume | no `--base` passed |
| 18a | 18 | run record with `base` | pipeline view shows `from <base>` |
| 18b | 3.4 | record without `base` | nothing shown |
| 18c | 18 | item with an existing `sdlc/<slug>` branch | note "base ignored: branch exists" next to the dropdown |
| 18d | 3.3 | refused start (exit 7) | recorded `message` shown like other refusals |

## C. Review items (not automated)

- Manual: `Select` rendering and keyboard use in a live terminal (spec section 5).
- Docs: `README.md` SDLC control section and the `CLAUDE.md` sdlc-mod row show `--base`, the resolution rule, base ignored on resume, exit 7 (spec "Docs"). Check by reading in Review.
- Rule about the tests themselves, not testable without reading test files: the wrapper tests must run offline, using only a local bare repo and `ext::` / `file://` remotes, and must not leave processes behind. Check in Review.
- Red state: before the Implement stage, `sdlc-mod-base.test.js` fails on the missing feature (most `--base` runs exit 2 today). A few cases pass already because current behaviour matches (for example 5b, 5d, 5f, 7e, 7f, 12e, 13e, 13f, 13g and the invalid-name cases that exit 2 for any unknown option). They guard against regressions.
- Timing: case 13i takes about 20 s once implemented; its 90 s Jest timeout and the 40 s bound leave room for slow machines. Review if it proves flaky.
