# add-answer-notes

Type: feature
Priority: P2 (normal)
Source: user request in the triage conversation: "the user questions should also support accept suggested and additional user notes".

## Problem
When the Spec agent pauses with questions, the developer answers each one either with the suggested answer (`accept`) or with their own text, never both. The pane (`.claude/plugins/sdlc-monitor/hooks/register.tsx:818`) has a "Use suggested" button and a text input that overwrite each other in one draft string, and `fillAnswers` (`register.tsx:116`) writes that single string to the `**Answer:**` line. The orchestrator flow (`CLAUDE.md` and `.claude/commands/sdlc.md`) offers Accept suggested, Use my alternative, or Other, so a developer who agrees with the suggestion but wants to add a constraint has to retype the whole answer. Verified by reading the code; nothing was run.

## Expected behaviour
For each question the developer can accept the suggested answer and also attach a free-text note. The agent in the next round treats the accepted suggestion and the note as binding.

## Decisions
- A note is stored on its own optional line `**Notes:** <text>` directly after the question's `**Answer:**` line in `Docs/backlog/<slug>/questions.md`. No note means no line. A note is one line; the pane and the orchestrator flow collapse line breaks to a space.
- The `**Answer:**` line keeps its current meaning and format (`accept`, or the typed text). `scripts/sdlc.sh` counts answers with the `**Answer:**` regex only (`scripts/sdlc.sh:242`), so a note alone never counts as an answer, and no change to the pause logic is needed.
- Notes apply to both choices: with `accept` the note extends the suggestion, with a typed answer it adds detail. Both are binding.
- `sdlc.sh` already appends the whole answered `questions.md` to `decisions.md` (`scripts/sdlc.sh:250`), so the `**Notes:**` line is archived with its question and needs no code change there.
- `scripts/prompts/prompt-spec.md` is updated: an `**Answer:**` of `accept` plus a `**Notes:**` line means the Suggested value was approved with those additions; both are binding and must not be asked again. The question format the agent writes does not change (the agent never writes a Notes line).
- Pane: each question gets a second input "Add a note (optional)" next to the existing "Use suggested" button and answer input. The note is kept in its own draft entry per question, so choosing "Use suggested" or typing an answer never erases it, and the other way round. The question counts as answered when it has an answer or "Use suggested", as today; a note alone does not. The summary line under a question shows the answer and, if set, `note: <text>`. `fillAnswers` writes the `**Notes:**` line after `**Answer:**`, replaces an existing one, and writes nothing for an empty note.
- Orchestrator flow (`CLAUDE.md` pipeline section and `.claude/commands/sdlc.md`): the AskUserQuestion options stay Accept suggested, Use my alternative (only when it differs) and the automatic Other. The rule gains: when the user selects an option and adds a note in the AskUserQuestion annotations, write it on a `**Notes:**` line after that question's `**Answer:**` line; never put the note on the `**Answer:**` line itself. A note on Other is written the same way.
- Plan agent open questions are not in `questions.md`; they follow the same orchestrator rule, and the note goes into the plan's decisions text where the orchestrator already records the answer. No new file format for Plan.

## Scope
- In: `.claude/plugins/sdlc-monitor/hooks/register.tsx` (draft atom for notes, `parseQuestions` keeps an existing note, `fillAnswers`, `submitAnswers`, the question UI), `scripts/prompts/prompt-spec.md`, `CLAUDE.md`, `.claude/commands/sdlc.md`.
- Out of scope: the format of questions the agent writes, the pause and resume logic in `scripts/sdlc.sh`, multi-line notes, notes on anything other than Spec and Plan questions, the stage input feature (`manual-inputs.md`).

## Tests
- `.claude/plugins/sdlc-monitor/hooks/register.test.ts`: a note typed with "Use suggested" is written as `**Answer:** accept` plus `**Notes:** <text>`; a note with a typed answer; no note writes no Notes line; a note alone does not count as answered; "Use suggested" after a note keeps the note; a second submit replaces an existing Notes line instead of adding one.
- `server/__tests__/scripts/sdlc-manual-input.test.js` style test, new `server/__tests__/scripts/sdlc-answer-notes.test.js`: a `questions.md` whose answers are filled and carry `**Notes:**` lines resumes, is archived with the notes into `decisions.md`, and a file with only notes still pauses with exit code 2.
- `server/__tests__/scripts/` prompt check: `prompt-spec.md` mentions `**Notes:**` (the existing prompt tests show the pattern).
- Integration tests: none, there is no database or API change.

## Docs
- `CLAUDE.md` (the "MANDATORY: show the answers, then confirm with AskUserQuestion" bullet, step 4) and `.claude/commands/sdlc.md`.

## Open questions
- none
