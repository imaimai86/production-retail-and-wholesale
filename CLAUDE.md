See @AGENTS.md for project rules. Run `npm test` from the repo root before committing.
Tests live in `server/__tests__/`, mirroring the code layout. Spec/plan/test docs live in `Docs/backlog/<slug>/`.
Automated pipeline: `./scripts/sdlc.sh [slug]`.
Refer to SDLC stages by name (Spec, Plan, Red tests, Implement, Review, Ship), never by number.
Whenever you start the SDLC pipeline or hand a task to a background agent, immediately show the user the command to monitor it, for example: `watch -n3 'cat Docs/backlog/<slug>/logs/status.json; git status --short | head -15'` (status.json is the single-line live status; the run output is `Docs/backlog/<slug>/logs/run*.out`).
