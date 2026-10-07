
## Round 1 (2026-10-07)

### Q1: Baseline handling for FROM=plan, red-tests and review
The brief defines the baseline only for `FROM=spec` (take a new snapshot) and `FROM=implement` (reuse `$LOG/baseline.json`, or create one with a WARNING if it is missing). `sdlc.sh` also accepts `FROM=plan`, `FROM=red-tests` and `FROM=review`, and all of them reach the Ship stage. Without a rule, a run resumed at one of those stages has no baseline, and Ship would fail or treat everything as a cycle change, which could commit the developer's own work. The spec cannot say what these stages do without an answer.
**Suggested:** Every `FROM` other than `spec` uses the same rule as `implement`: reuse the existing `$LOG/baseline.json`, and if it is missing, create one now and print the same `WARNING: no baseline from the original run; changes made before this resume are treated as pre-existing and will not be committed`.
**Answer:** accept

### Q2: Snapshot call placement versus the wiring test
The brief says the baseline snapshot call appears "only inside the `FROM=spec` path" (wiring test), but it also requires creating a snapshot when `FROM=implement` finds no baseline. These conflict if the second call is a separate `sdlc-changes.cjs snapshot` invocation outside the `FROM=spec` block. The wiring test would fail, or the fallback would not exist. The acceptance criteria need one unambiguous structure.
**Suggested:** One baseline block in `scripts/sdlc.sh`, placed right after the branch checkout and before the Spec stage. It runs `snapshot` when `FROM=spec`, or when the file is missing for any other `FROM` (with the warning from Q1). The wiring test then asserts that `sdlc-changes.cjs snapshot` appears exactly once, inside that block, and not inside the Ship stage.
**Answer:** accept

### Q3: Reason precedence when a candidate matches several skip rules
A candidate can match more than one rule, for example a `.env` that was already modified before the run and changed again, or a file over 1 MiB under `.claude/`. The `skipped` entry carries one `reason`, so the order decides what the developer sees in `ship-skipped.md`. The tests assert specific reasons, so this must be fixed.
**Suggested:** Apply the rules in the brief's order and report the first match: `pre-existing local changes`, then `sensitive file`, then `local or agent configuration`, then `generated`, then `too large`. Each path appears once in `skipped`. Patterns match the basename or path at any directory depth (so `server/.env` is `sensitive file`).
**Answer:** accept, with one change: a changed `.env` (at any depth) is still never committed itself (reason `sensitive file`), but Ship mirrors its changes into the sibling `.env.example` (add or update keys with placeholder values, never the real secret values) and commits that `.env.example`.
