# add-requirements-viewer

Type: feature
Priority: P3 (nice to have)
Source: user request in the triage conversation: "add option to view the detailed requirements of each task from the listing page, add a `...More` button at the end of items in the listing page to open each requirements and see". The listing page is the "Pending (n): select one or more" list on the overview of the `/sdlc-monitor` pane.

## Problem
The overview lists each pending item as a checkbox, `type priority`, and the title cut to 56 characters (`.claude/plugins/sdlc-monitor/hooks/register.tsx`, the `s.pending.map` block of the `Pane` render, about line 565; `PendingItem` in `types/index.d.ts:34` holds only `slug`, `type`, `priority`, `title`). To see what an item asks for, the developer has to leave the pane and open `Docs/backlog/<slug>/brief.md`, before deciding whether to run it. Verified from the code: `scripts/backlog-list.cjs` reads the brief only for `Type` and `Priority` (`parseBrief`), and the plugin already has `readText($, path)` (`register.tsx:136`). Nothing was run.

## Expected behaviour
Every pending item row ends with a `...More` button. Pressing it replaces the overview with a read-only requirements screen for that item, showing its `brief.md`. A `Back` button (and `Esc`) returns to the overview with the same selection ticked.

## Decisions
- Button: label exactly `...More`, key `more-<slug>`, placed after the title and the "already started" note, on every row of the pending list (also rows with no brief). Pressing it does not toggle the row's checkbox.
- Source of the content: `Docs/backlog/<slug>/brief.md` in the main working tree, read with the existing `readText`; no change to `scripts/backlog-list.cjs`, `scripts/sdlc.sh` or `scripts/sdlc-mod.sh`. Read when the screen opens and when a section is switched, not on the poll.
- State: two new plugin atoms in `register.tsx` and `types/index.d.ts`: `reading` (slug being read, `''` for none) and `readingSection` (heading shown). They are separate from `view`, so a pipeline screen is unaffected. Closing the pane does not clear them (same as `view`).
- Screen layout:
  - Header: `<slug>` bold, then `type priority` dim, then the title.
  - A row of section buttons, one per `## ` heading found in the brief, in file order (for the standard shape: Problem, Expected behaviour, Decisions, Scope, Tests, Docs, Open questions). The shown one is marked with `[x]` and the others with `[ ]`. The first section shown is `Problem`, or the first heading when there is none.
  - Below: the body of the shown section as plain text, one `Text` per line, blank lines kept as one blank line, markdown not rendered (bullets and backticks stay as written). Lines are wrapped by the pane, never cut.
  - Footer buttons: `Back`, and `Run this item` which does what `Run selected` does for that one slug (`runSelected` path, queue when both slots are busy) and then returns to the overview. It is hidden when the item is already started (same `isBusy` test as the row).
- Fallbacks: no `brief.md`, or an empty one, shows `No brief.md for <slug>: run the Spec stage or write one.` in yellow with only `Back`; a brief with no `## ` headings is shown whole as one section named `Brief`; a read error shows `Could not read Docs/backlog/<slug>/brief.md` in red.
- A slug that fails the same safety test as `backlog-list.cjs` (`/[\\/*?[\]]/`, `..`, `.`) is never read; the screen shows the not-found message.
- Text only, no new dependency, no editing of the brief from the pane.
- Independent of the layout work in `add-monitor-fullscreen`: this item adds a screen and a button to the current single-column overview. When that redesign lands, the `...More` button stays at the end of each pending row and the requirements screen opens in the right-hand column; adapting it is part of that item, not this one.

## Scope
- In: `.claude/plugins/sdlc-monitor/hooks/register.tsx` (`...More` button, requirements screen, two atoms), `.claude/plugins/sdlc-monitor/types/index.d.ts` (the two atoms).
- Out of scope: `scripts/backlog-list.cjs`, `scripts/sdlc.sh`, `scripts/sdlc-mod.sh`, the `/backlog-list` command, any server code; showing specs, plans or test cases of started pipelines (the pipeline screen already covers them); rendering markdown; editing the brief.

## Tests
- `.claude/plugins/sdlc-monitor/hooks/register.test.ts` (stub `readText` with a brief file):
  - each pending row renders a `...More` button, including a row whose brief is missing and a row marked "already started";
  - pressing `...More` sets `reading` to the slug and renders the header, the section buttons in file order with the first marked `[x]`, and the Problem text; the row's checkbox state is unchanged;
  - pressing another section button shows that section's text and not the previous one;
  - `Back` and `Esc` clear `reading` and render the overview with the earlier selection intact;
  - `Run this item` starts the slug like `Run selected` (queues when both slots are busy) and is absent when the item is already started;
  - missing brief, empty brief, brief without `## ` headings and read error show the fallbacks above; a slug containing `/` or `..` is not read.
- Integration tests: none, there is no database or API change.

## Docs
- `README.md`: one sentence in the monitor section that `...More` on a pending item shows its brief.
- `CLAUDE.md`, `server/API.md`, `schema.md`, `AGENTS.md`: none.

## Open questions
- none
