Report to triage (free text, pasted error, or a link/path to notes): $ARGUMENTS

Turn this report into backlog items that `./scripts/sdlc.sh <slug>` can run with few or no question rounds. Do not write source code, do not commit, and do not start the pipeline.

## 1. Understand and split
- If the report holds several independent problems or features, make one item for each.
- Classify each as `bug` (existing behaviour is wrong) or `feature` (new behaviour).
- Never paste secrets (passwords, tokens, full connection strings) into any file. Describe them by name only.

## 2. Check for duplicates
- Read `Docs/backlog/index.md` and `Engineering/bugs.md`, and list the folders under `Docs/backlog/`.
- If an item already covers the report, tell the user which one and stop for that item. Do not create a second one.

## 3. Ground it in the code
- Use graft (`graft ask`, `graft grep`, `graft callers`) to find the real files, functions and endpoints involved. Do not read whole files you do not need.
- For a bug, confirm the cause from the code and, when it is cheap and safe, reproduce it with `npm test` or a small read-only command. State what you verified and what you did not.
- Never run anything that changes a database or sends data outside this machine.

## 4. Decide what you can, ask only what you cannot
The Spec stage stops and asks whenever the brief is ambiguous, so every unanswered point costs a full pipeline round. Settle these in the brief, using the project's existing conventions as the default:
- Exact behaviour and the error status and body for every failure (the repo uses `{ "error": "<message>" }`).
- Validation order (400 first, then 404, then 409), and what a failed request must not change.
- Scope: which files and endpoints are in, and what is explicitly out.
- Tests: where they live (`server/__tests__/`, mirroring the code layout) and the cases to cover.
- Docs: which of `server/API.md`, `schema.md`, `README.md` or `AGENTS.md` change.
- Data and migrations: new migration number, backfill values, and how existing rows are treated.

Use AskUserQuestion (at most 4 questions per round) only for choices that the code and conventions cannot settle: product decisions, breaking API changes, security trade-offs. Put the answers into the brief as decisions. Anything still unknown goes under "Open questions" in the brief, never guessed.

## 5. Write the backlog item
For each item, choose a unique kebab-case slug of at most 4 words that starts with a verb or names the fix (for example `fix-database-url`, `hide-internal-errors`, `add-jwt-login`).

Create `Docs/backlog/<slug>/brief.md` in exactly this shape:

```
# <slug>

Type: bug | feature
Priority: P0 (security or data loss) | P1 (blocks use) | P2 (normal) | P3 (nice to have)
Source: <where this came from: report, error text without secrets, Engineering/bugs.md entry, link>

## Problem
<current behaviour and why it is wrong, or the need for a feature>
<for bugs: steps or request that reproduce it, and the verified cause with file:line>

## Expected behaviour
<what should happen instead, observable from outside>

## Decisions
- <concrete, testable decisions from step 4, one per line>

## Scope
- In: <files and endpoints>
- Out of scope: <what must not change>

## Tests
- <file path and the cases to cover>

## Docs
- <files to update, or "none">

## Open questions
- <only if something is still unknown; otherwise "none">
```

Then add one line to `Docs/backlog/index.md`, in this exact format (the pipeline reads it with a regex):

```
- [ ] `<slug>` - <Bug|Feature>: <short title>
```

The pipeline works top-down, so put P0 and P1 items above P2 and P3, and keep items of equal priority in the order they were reported. Create the file if it does not exist, using the header that `Docs/backlog/index.md` already has on `main`.

## 6. Report back
Reply with a short table: slug, type, priority, one-line summary, and any open questions. Then give the command to run it: `./scripts/sdlc.sh <slug>`. Refer to SDLC stages by name (Spec, Plan, Red tests, Implement, Review, Ship), never by number.

## 7. Suggest publishing the triaged items (MANDATORY, never skip)
Triage only writes files; it never commits or pushes by itself. But a brief that is not in git is easy to lose, and the pipeline then starts from whatever branch and working tree happen to be checked out (a backlog line without its brief, or a brief on a dirty branch, breaks `./scripts/sdlc.sh`). So every triage reply MUST end with an explicit offer to publish, listing exactly what would go in:
- The files: each new or changed `Docs/backlog/<slug>/brief.md` and `Docs/backlog/index.md`. Nothing else. Name any other uncommitted file you see (`git status --short`) and say it would be left out.
- A suggested branch off the latest `main`, for example `backlog/<slug>` (or `backlog/<slug-1>-and-<n>-more` for several items).
- The exact commands, using explicit paths (never `git add -A` or `git add .`), for example:
  ```bash
  git fetch origin && git switch -c backlog/<slug> origin/main
  git add Docs/backlog/index.md Docs/backlog/<slug>/brief.md
  git commit -m "docs(backlog): triage <slug>"
  git push -u origin backlog/<slug>
  ```
- Ask whether to do it. Only run these commands after the user says yes. If the user says to push or publish, create the branch, commit only those files, push, and report the branch name and the PR link (offer to open the PR with `gh pr create`).
If the working tree has unrelated uncommitted changes that would be carried into a branch switch, say so before running anything.
