Slug (blank = first `- [ ]` item in `Docs/backlog/index.md`): $ARGUMENTS
Work on branch `sdlc/<slug>`. Run these in order, using the matching slash command for each, and stop at the first failure:
/spec -> /plan -> /red-tests -> /implement -> /review -> /ship
Pause only if /spec finds real gaps. Never skip a stage's test check.

MANDATORY: show the monitor command.
- The moment you start or resume `./scripts/sdlc.sh <slug>`, or hand any stage to a background agent or task, print the command below with the slug filled in, BEFORE doing anything else.
- Then include the same command in EVERY reply to the user until the run reports completion: progress checks, answers to other questions, questions to the user, everything. Do not wait to be asked. A reply sent while the run is active without it is incomplete.
```bash
bash scripts/sdlc-mod.sh watch <slug>
```
MANDATORY: show the answers, then confirm with AskUserQuestion. If /spec (or `./scripts/sdlc.sh`) pauses with open questions in `Docs/backlog/<slug>/questions.md`, or a Plan agent reports open questions:
1. Print every question in your reply with its full, verbatim `**Suggested:**` answer and why it matters. Never ask "accept the suggested answers?" without the answers shown first, and never replace them with a summary.
2. Give your own answer to each: say whether you agree and why (check factual claims against the code), or propose a different one.
3. Only then confirm with the AskUserQuestion tool, never a free-text "accept?" line (headless agents cannot ask, so you ask for them). One question per agent question, up to 4 per call, with the question's title as the header and the options **Accept suggested** (suggested answer in the description), **Use my alternative** (only if your answer differs; alternative in the description) and the automatic Other for the user's own text. This adds to steps 1 and 2, it does not replace them: the full text must already be printed in the same reply.
4. Write each choice on its `**Answer:**` line (`accept` for the suggestion, otherwise the chosen or typed text) and rerun.

The command finds the pipeline's directory itself (its worktree for a wrapper or pane run). `status.json` is the single-line live status and the run output is `run*.out`, both under `Docs/backlog/<slug>/logs/` in that worktree. Refer to SDLC stages by name (Spec, Plan, Red tests, Implement, Review, Ship), never by number.
