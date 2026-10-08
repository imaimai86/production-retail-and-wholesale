# Spec: add-base-branch-dropdown (round 1)

Sources: `brief.md` (including its Decisions), `decisions.md` (Round 1 Q1, Q2; Round 2 Q1; all binding). No source code in this document.

## 1. Purpose
Let the developer choose, per task, the branch a new SDLC pipeline starts from, in the control pane (dropdown, `main` by default) and in the wrapper CLI (`--base`). The base is resolved to the fresher of `origin/<name>` and local `<name>`, so a stale local `main` no longer yields old code.

## 2. Wrapper CLI (`scripts/sdlc-mod.sh`)

### 2.1 Command forms
- `run <slug> [--base <name>]`
- `restart <slug> [--yes] [--base <name>]`
- Flags may appear in any order after the slug. `restart` currently parses only a positional `--yes`; its parsing is replaced so `--yes` and `--base <name>` work in either order.
- `discard <slug> [--yes] [--stop]` gets **no** `--base` flag (out of the brief's decisions). It resolves its base through the same `pick_base` using `SDLC_BASE` or the default only.
- A `--base` with no value, or a repeated `--base`, is a usage error (exit 2). The usage text is updated to show `--base`.

### 2.2 Base selection (single place: `pick_base`)
Precedence: `--base` > env `SDLC_BASE` > default.
- **Default (neither given):** `main`; if `main` does not exist (neither local nor `origin/main`), the branch `origin/HEAD` points to; if that cannot be found, the current `HEAD` (as today). The fallback applies only to the default.
- **Explicit base (`--base` or `SDLC_BASE`):** never falls back. A missing branch exits 7.
- `cmd_run`, `cmd_discard`, `cmd_restart` all call `pick_base`. The merged-item guard and the brief lookup use the resolved base.
- An empty `SDLC_BASE` counts as unset.

### 2.3 Name validation (exit 2)
`<name>` must match `^[A-Za-z0-9._/-]+$`, must not start with `-`, and must not contain `..`. Otherwise exit 2 with a message naming the bad value. Examples that exit 2: `--evil`, `a..b`, a name with spaces, an empty string. Validation applies to `--base` and to `SDLC_BASE`, and always runs first (before any existence check or fetch). Nothing is created.

### 2.4 Existence check (exit 7)
- A name that is neither a local branch nor `origin/<name>` exits 7 with the exact message `base branch '<name>' not found (local or origin)`.
- Per Round 1 Q1, this applies **always**: also on a resume or re-run where `sdlc/<slug>` or its worktree already exists, and also for `discard` and `restart`. The message names the unknown base and is printed as a warning on stderr.
- For `run`, the refusal is recorded through `fail_start` (run record field `message`, `exit_code` 7). Nothing is created or changed in git (no branch, no worktree, no fetch side effects beyond refs).
- For `discard` and `restart` the refusal goes to stderr with exit 7 and nothing is deleted or restarted. (A discard therefore cannot proceed while `SDLC_BASE` names a missing branch; the developer unsets or fixes it.)

### 2.5 Fetch (new branch/worktree only)
- Before creating a NEW branch/worktree, run `git fetch --quiet origin <name>` for the chosen name, limited to 20 seconds, using a mechanism that works on macOS (no `timeout`; e.g. a perl alarm or a killed background process).
- A failure (offline, remote branch absent, local-only branch, timeout) is only logged in the wrapper log and never stops the start. The wrapper must not wait longer than about 20 seconds in total for it.
- Order: validate name, fetch only when a new branch/worktree will be created, then resolve (so the existence check uses refs after the fetch where applicable). If the existence check fails, exit 7 happens without leaving a new branch or worktree.
- No fetch when `sdlc/<slug>` or its worktree exists (reuse).
- For `restart`, the fetch happens when the restart creates the fresh branch/worktree, not during the discard half.
- The fetch is skipped for the default fallback to `HEAD` when no `origin` exists, without error.

### 2.6 Resolution rule
`<name>` resolves to `origin/<name>` when that ref exists and the local branch `<name>` (if it exists) is an ancestor of it (local equal to or behind origin). Otherwise it resolves to the local `<name>`. A local branch ahead of origin (or diverged) is kept. If only `origin/<name>` exists, it resolves to `origin/<name>`. Works for names containing `/` (including `sdlc/<other>`), so one task can start from another task's branch.

### 2.7 Creating the worktree
- New branch and worktree: `sdlc/<slug>` is created from the resolved ref (its tip equals that ref's tip).
- Existing branch `sdlc/<slug>` is reused and an existing worktree is skipped (unchanged behaviour); the base is ignored and the wrapper log gets `base ignored: sdlc/<slug> already exists`.
- Brief handling: the brief is looked up on the resolved base; if missing there, it is copied from the main working tree (unchanged). If missing in both, `fail_start` exit 1 `Missing Docs/backlog/<slug>/brief.md` (unchanged).
- A base lacking the item's line in `Docs/backlog/index.md` is allowed (no check).
- Other exit codes keep their meaning (3 full, 4 already running, 5 merged, 6 `--yes` missing). Where several refusals apply, bad name (2) and unknown base (7) are checked before the capacity (3) and merged (5) checks, because the merged guard needs the resolved base.

### 2.8 Merged guard
`is_merged` uses the resolved base (`git log <base> --grep="^test(<slug>): add failing tests"`). Exit 5 / `SDLC_ALLOW_MERGED` behave as today, with the message naming the resolved base.

### 2.9 Run record
- `base` holds the resolved ref (for example `origin/main` or `main`).
- Per Round 2 Q1, `base` is written with the freshly resolved base on EVERY run, including a resume or re-run where the base is ignored. The record may therefore name a base the existing branch was not created from; this is accepted by the developer.
- The pipeline view (`watch`/status output and the pane) shows `from <base>` from the record value; nothing is shown when the record has no `base` (for example older records).
- A refused start (exit 7 or any `fail_start`) keeps its `message` and `exit_code`; `base` on such a record is the name requested, or empty if not resolved.

## 3. Control pane (`.claude/plugins/sdlc-monitor/hooks/register.tsx`, `types/index.d.ts`)

### 3.1 Branch list
- One read-only `git for-each-ref` call (no network) lists local branches plus remote-only `origin/*` branches, refreshed together with the pending list (cache 10 s).
- Remote branches are shown without the `origin/` prefix; a name that exists both locally and on origin appears once. `origin/HEAD` is excluded. `sdlc/*` branches are included.
- Sorted: `main` first, then alphabetical.
- If the list cannot be read, the dropdown offers `main` only (the default) and the pane keeps working.

### 3.2 Dropdown on each pending row
- Every pending task row has a `Select` (props `key`, `label`, `options: {value,label}[]`, `value`, `onSelect(value, e)`).
- Default selected value: `main`; if no `main` exists, the branch `origin/HEAD` points to; else the first option.
- Selection is stored in a `bases` atom keyed by slug; changing one row changes only that task. The entry is cleared when the task is launched.
- Rows keep the existing `sel-<slug>` checkbox Buttons; the dropdown does not change selection or Run selected semantics.
- For an item that already has a branch (`sdlc/<slug>` exists), the pane shows a note next to the dropdown that the base is ignored because the branch exists. (The backend still validates the base, see 2.4.)

### 3.3 Launching
- `launch` passes `--base <name>` to `scripts/sdlc-mod.sh run` (the slug and base are passed as separate shell arguments, never interpolated into a command string unquoted).
- `runSelected` launches as many selected slugs as free slots (cap 2), each with its own base; the rest go to the `queue` atom.
- The `queue` atom carries the base per slug; a queued task keeps the base chosen when it was queued, and `drainQueue` launches it with that base when a slot frees.
- **Resume** offers no base (does not pass `--base`).
- The Start page shown after a discard shows the same dropdown, and `startRun` passes `--base`.
- When the wrapper refuses a start (e.g. exit 7), the pane shows the recorded `message` the same way it shows other refusals.

### 3.4 Pipeline view
Shows `from <base>` from the run record's `base`, only when present.

## 4. Error cases (summary)
| Case | Result |
|---|---|
| Bad name (`--evil`, `a..b`, spaces, empty) | exit 2, nothing created |
| `--base` missing its value / repeated | exit 2 (usage) |
| Unknown explicit base (new or existing branch/worktree; run, restart, discard) | exit 7, message `base branch '<name>' not found (local or origin)`; run recorded via `fail_start` |
| Fetch fails or times out | logged in wrapper log only; start continues |
| Existing branch/worktree with valid base | base ignored, `base ignored: sdlc/<slug> already exists` logged; record `base` still updated (Round 2 Q1) |
| No `--base`/`SDLC_BASE`, no `main` | origin/HEAD branch, else current `HEAD` |
| Branch list unreadable in pane | dropdown shows `main` only |

## 5. Acceptance criteria
Wrapper (`server/__tests__/scripts/sdlc-mod.test.js`, throwaway git repos, stub `sdlc.sh`, local bare repo as `origin`):
1. `--base <local branch>` creates the worktree at that branch's tip.
2. A remote-only branch works as a base.
3. A task can start from another task's `sdlc/<other>` branch.
4. Origin fresher than a stale local branch is preferred; a local branch ahead of origin is kept.
5. `--base` beats `SDLC_BASE`; with neither the default is `main`; with no `main` it falls back to origin/HEAD, then `HEAD`.
6. Unknown base exits 7 with the exact message, recorded in the run record (`message`, `exit_code` 7), and creates nothing.
7. Unknown base also exits 7 when `sdlc/<slug>` or its worktree already exists, and for `restart`/`discard` (nothing deleted).
8. Invalid names (`--evil`, `a..b`, with spaces) exit 2.
9. An existing branch ignores a valid `--base` and logs `base ignored: sdlc/<slug> already exists`.
10. The run record has `base` (resolved ref), rewritten on every run including a resume.
11. The merged guard and brief lookup use the chosen base.
12. `restart` accepts `--base` and `--yes` in either order.
13. Fetch: a commit pushed to the bare origin is picked up before the worktree is created; an unreachable origin still starts and logs the failure; no fetch when the branch or worktree exists; total wait is bounded by about 20 seconds.

Pane (`register.test.ts`, with stubbed branch list):
14. Dropdown lists local and remote-only branches including `sdlc/*`, without `origin/HEAD`, `main` first and selected by default.
15. Choosing a branch on one row changes only that task; the entry clears on launch.
16. Run selected passes `--base <name>` per slug; a queued task keeps its base through `drainQueue`.
17. The Start page shows the dropdown and Start passes `--base`; Resume passes no `--base`.
18. The pipeline view shows `from <base>`; the note appears for an item that already has a branch.

Docs: `README.md` (SDLC control section: dropdown, `--base`, resolution rule, base ignored on resume, exit 7) and the `CLAUDE.md` sdlc-mod command row show the new flags.

Manual check (Review): `Select` rendering and keyboard use in a live terminal.

## 6. Out of scope
`scripts/sdlc.sh`; the PR/merge target; creating or deleting branches; choosing a base for Resume; the sdlc-guard plugin; a `--base` flag on `discard`.
