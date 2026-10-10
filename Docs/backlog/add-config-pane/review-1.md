# Review: add-config-pane (round 1)

Reviewed: `git diff df62894210e4af9e4ca500522db9966667f9f938` against `specs-1.md`.

## Verdict

**Not ready to ship.** The diff contains only the documentation (`README.md`, `CLAUDE.md`). The CONFIG pane itself is not implemented, and the docs now describe a button and a command that do not exist.

## What the diff contains

| File | Change | Against the spec |
|---|---|---|
| `README.md` | Pointer to the CONFIG pane in "Custom models and providers", both buttons and commands in the control-pane line, a new **CONFIG pane** bullet | Matches section 10 |
| `CLAUDE.md` | `CONFIG` button and `/sdlc-config` in the monitor control pane row | Matches section 10 |

No correctness or security issue in these two edits themselves.

## Findings

### 1. Blocker: the feature is not implemented (acceptance 1 to 23)

`.claude/plugins/sdlc-monitor/hooks/register.tsx`, `hooks/register.test.ts` and `types/index.d.ts` are unchanged since `f0b2efa`; none of them contains the word `config`. Missing, per `plan-1.md` steps 2 to 5:

- the `ConfigProvider` and `ConfigForm` types and the five `config*` state entries;
- the `CONFIG_PANE` constant, the atoms, `firstLine`, `runModel`, `loadConfig`, `openConfig`, `addArgs`, `submitAdd`, `testModel`, `removeModel`, `removeProvider`;
- the `/sdlc-config` command (registration and handler);
- the `CONFIG` button in `AbovePrompt`;
- the CONFIG pane render handler;
- the 17 pane tests in `register.test.ts`.

Cause: the Implement agent's edits to these files were denied as "sensitive file" (`logs/impl-1.log`). The same happened in this review: my edit of `types/index.d.ts` was denied with the same message. I did not work around it, so nothing under `.claude/plugins/` was changed in Review either.

### 2. Blocker: the docs describe behaviour that does not exist

`README.md` and `CLAUDE.md` tell the user to press **CONFIG** or type `/sdlc-config`. Neither exists, so merging this diff as it is would ship wrong documentation. I left the docs in place because they are correct for the specified feature and `server/__tests__/scripts/config-pane-docs.test.js` (locked) requires them; they must not be merged without the pane code.

### 3. The green gate does not cover the feature

`npm test` is green (786 passed in `logs/tests.log`), but the only Jest test for this item is the docs test (acceptance 25). Acceptance 1 to 23 live in `register.test.ts`, which `npm test` does not run and which was not written. No pane test has run, so none counts as passed. The "tests and integration green" line in `run.out` says nothing about the pane.

### 4. Note: one flaky test outside this change

The Implement log reports one failed run of `server/__tests__/index.test.js:281` that passed on the next two runs. It is not touched by this diff. Not investigated here.

## Fixes made in this review

None. The only real problems are in files I could not edit.

## To finish

1. Allow edits under `.claude/plugins/sdlc-monitor/` for the Implement and Review agents (or apply plan steps 2 to 5 by hand).
2. Rerun from Implement: `FROM=implement ./scripts/sdlc.sh add-config-pane`.
3. Run `register.test.ts` with the `claude-code/testing` harness and record the result, then review the pane code against sections 3 to 9 of the spec (argument passing without a shell string, no key value in state or toasts, `hasOwnProperty` for the existing-provider check).
