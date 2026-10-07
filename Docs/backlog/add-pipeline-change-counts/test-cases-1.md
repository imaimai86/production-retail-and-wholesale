# Test cases: add-pipeline-change-counts (round 1)

Inputs: `specs-1.md`, `plan-1.md`. Tests run the real `scripts/sdlc-mod.sh` (a copy inside a throwaway git repo, stub `sdlc.sh`) and read the real `README.md`, `CLAUDE.md` and wrapper. None reads a test file.

## Script: `server/__tests__/scripts/sdlc-mod.test.js` (`describe('sdlc-mod.sh changes')`)

| # | Spec item | Case | Expected |
|---|---|---|---|
| S1 | 1 | Worktree with 2 committed files, 1 untracked file, 1 modified tracked file | stdout `4 2`, exit 0, empty stderr |
| S2 | 2 | File committed, then edited again | `1 1` (counted once) |
| S3 | 3 | Linked `server/node_modules` and `graft` present, nothing else | `0 0`; two untracked files in a new folder then give `2 2` |
| S4 | 2.2 | `git mv` of a tracked file (staged rename) | `changed` 1, `uncommitted` 1, `files` holds only the new path |
| S5 | 2.2 | Untracked file whose name has a space | listed under its real name, counted once |
| S6 | 4 | `--json`, both `changes alpha --json` and `changes --json alpha` | keys exactly `slug, worktree, changed, uncommitted, files`; values correct; `files` sorted; `worktree` is the folder path |
| S7 | 4 | 60 committed files, `--json` | `changed` 60, `files` has 50 entries (sorted, `f01`..`f50`) |
| S8 | 5 | Run from the repo, the worktree, the tmp folder and the OS temp dir | identical output each time |
| S9 | 6 | Add an untracked file and edit a tracked file in the main working tree | output unchanged |
| S10 | 7 | Unknown slug, plain and `--json` | exit 1, stdout empty, stderr `No pipeline for ghost` |
| S11 | 8 | Record exists, worktree folder deleted, plain and `--json` | exit 1, stdout empty, stderr `Worktree for alpha is gone` (not `No pipeline for`) |
| S12 | 2.1 | No record, `$SDLC_WT_BASE/<slug>` exists | works: `1 1` |
| S13 | 2.1 | Record's `worktree` path missing, `$SDLC_WT_BASE/<slug>` exists | falls back: `1 1` |
| S14 | 10 | No `base` in the record; main is one commit ahead of `root` | base is `pick_base` (main): `1 0`; with `SDLC_BASE=root`: `2 0` |
| S15 | 10 | `base: root` in the record | `2 0`, also when `SDLC_BASE=main` (record wins) |
| S16 | 9 | Base is an orphan branch (no common ancestor), 1 commit + 1 untracked file | exit 0, `1 1`, empty stderr |
| S17 | 2.2 | Base is an unknown ref | exit 0, committed part 0 (`--json`: changed 0, files `[]`) |
| S18 | 2.2 | `origin` points at a nonexistent remote | still exit 0 and correct counts, empty stderr (no network call) |
| S19 | 2.5 | Usage and argument checks | no-args help lists `changes <slug> [--json]`; missing slug, `--json` only, bad slug, unknown flag, a second slug, repeated `--json` all exit 2 |

## Docs: `server/__tests__/docs/pipeline-change-counts-docs.test.js`

| # | Spec item | Case | Expected |
|---|---|---|---|
| D1 | 16 | `README.md` command list | contains `bash scripts/sdlc-mod.sh changes <slug> [--json]` |
| D2 | 16 | `README.md` control pane section | mentions `files changed` and `uncommitted` |
| D3 | 16 | `CLAUDE.md` `scripts/sdlc-mod.sh` command row | contains the word `changes` |
| D4 | 2.5 | Wrapper header comment | contains `scripts/sdlc-mod.sh changes <slug> [--json]` |

## Pane: spec items 11-15 (handed over, not written here)

The pane tests belong in `.claude/plugins/sdlc-monitor/hooks/register.test.ts` (plan step 2). That file is outside `server/__tests__/`, and the Red tests stage guard refused the edit ("write tests and docs only, never source"), so it was left unchanged. The cases below need adding in a stage that may edit it. They also cannot run under `npm test`: the pane harness is `claude-code/testing`.

Test-file changes the plan describes:
- `RunSpec` gains `changes?: {changed, uncommitted} | 'fail' | 'garbage'` and `base?: string`; `world()` writes `base` into the record JSON only when set.
- The `process.run` stub gets a branch for `argv[1]` ending in `sdlc-mod.sh` and `argv[2] === 'changes'`: it records the call and returns the JSON, exit 1, or unparseable text.
- Every test uses its own slug, because `changesCache` is module-level and keyed by slug.

| # | Spec item | Case | Expected |
|---|---|---|---|
| P1 | 11 | Running pipeline, changes 7/3 | overview row text matches `7 files changed (3 uncommitted)` |
| P2 | 3.1 | Same | the call is `bash <...>/sdlc-mod.sh changes <slug> --json` |
| P3 | 12 | Running 0/0 | row shows `no changes yet` |
| P4 | 12 | Failed (not running) 0/0 | no `files changed` and no `no changes yet` text |
| P5 | 13 | Unmanaged run (`legacy: true`) | no `changes` call made; no counts; no `Files` line |
| P6 | 13 | `changes` call exits 1 (discarded or worktree gone) | no counts, no `Files` line |
| P7 | 13 | `changes` prints non-JSON | treated as null: no counts, no `Files` line |
| P8 | 14 | Pipeline view, record `base: origin/dev`, 12/4 | text `Files  12 changed since origin/dev · 4 uncommitted` |
| P9 | 14 | Record without `base`, 0/0, state failed | text `Files  0 changed since base · 0 uncommitted` |
| P10 | 15 | Failed pipeline, refresh twice 2 s apart | still one `changes` call (cached) |
| P11 | 15 | Same, advance a further 11 s and refresh | one new `changes` call |
| P12 | 15 | Running pipeline, two refreshes | one call per refresh |
| P13 | 3.1 | `paused` / `starting` state | called on every refresh, like `running` |
| P14 | 5.7 (plan) | Discard a pipeline, then restart it | cache entry cleared: no stale count shown |

## Review items (not tested; they concern the tests or are not observable)

- No test reads, scans or asserts on the text of any test file.
- The pane tests (P1-P14) must be added to `register.test.ts` and run with the `claude-code/testing` harness before Review passes.
- `write_reg` does not yet write `base` (comes from `add-base-branch-dropdown`). S14 and S15 write the `base` field by hand, so they pass whichever order the two items ship in.
- The README control pane wording (D2) is only checked for key terms; review the prose by eye.
- Cost of the call at a 2 s refresh with two pipelines (plan Risks): judge by eye, not tested.
