Slug (blank = first `- [ ]` item in `Docs/backlog/index.md`): $ARGUMENTS
Work on branch `sdlc/<slug>`. Run these in order, using the matching slash command for each, and stop at the first failure:
/spec -> /plan -> /red-tests -> /implement -> /review -> /ship
Pause only if /spec finds real gaps. Never skip a stage's test check.

MANDATORY: show the monitor command.
- The moment you start or resume `./scripts/sdlc.sh <slug>`, or hand any stage to a background agent or task, print the command below with the slug filled in, BEFORE doing anything else.
- Then include the same command in EVERY reply to the user until the run reports completion: progress checks, answers to other questions, questions to the user, everything. Do not wait to be asked. A reply sent while the run is active without it is incomplete.
```bash
watch -n3 'cat Docs/backlog/<slug>/logs/status.json; git status --short | head -15'
```
`status.json` is the single-line live status; the run output is `Docs/backlog/<slug>/logs/run*.out`. Refer to SDLC stages by name (Spec, Plan, Red tests, Implement, Review, Ship), never by number.
