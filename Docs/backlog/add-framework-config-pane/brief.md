# add-framework-config-pane

Type: feature
Priority: P2 (normal)
Source: user request in the triage conversation: "all these should be supported in the pane ... support installing any test framework by selecting the right package and clicking deploy". Third of three items; depends on `add-test-framework-registry` (the pane calls only its wrapper) and builds on the existing `CONFIG` pane from `add-config-pane` (already merged). It is useful without `use-configured-test-runner`, but the choice only changes the pipeline once that item is merged.

## Problem
The `CONFIG` pane (`.claude/plugins/sdlc-monitor/hooks/register.tsx:449-560`, render at `:1098`) manages model providers through `sdlc-mod.sh model ...` only. There is no screen to see the supported test frameworks, pick one, set the test path or install the package.

## Expected behaviour
The `CONFIG` pane gets a second screen, "Test frameworks", reached by a button in the pane. It lists the catalog and the repo's current entries, lets the user choose a framework package and a test path, and has a `Deploy` button that installs the package and saves the choice. The provider screen keeps working as before.

## Decisions
- Navigation: the pane keeps `configView` (`'list' | 'form'`) and gains `'frameworks'`. A `Test frameworks` button on the provider list opens it; `Back` returns. `q` and `Esc` close the pane as today. Own atoms with prefix `framework`, same pattern as the `config*` atoms (`register.tsx:51-58`); `openConfig` resets them.
- Data, only through the wrapper (never the config file or `scripts/sdlc-frameworks.cjs` directly, as `add-config-pane` does for models): `bash scripts/sdlc-mod.sh framework catalog --json` and `framework list --json`, loaded when the screen opens and after every action, with the same loader and error handling as `loadConfig` (an invalid config shows its error line in place of the list).
- Screen: the current entries (framework, path, cwd, `installed` or `NOT installed`), each with a `Remove` button (second press confirms); below, the catalog as a selectable list (label, package, version, `installed`), one row selected at a time. A single-line `Input` "Test path (relative folder)" prefilled with the first entry's path or `server/__tests__`, and a single-line `Input` "Working folder (optional)". Buttons: `Deploy` and `Back`.
- `Deploy`: the first press shows the exact command (`npm install -g <package>@<version>`) and the path in the notice line and asks for a second press ("Press Deploy again to run it"); any other action cancels. The second press runs `framework install <id> --yes` when the package is not installed (skipped when already installed), then `framework use <id> --path <path> [--cwd <cwd>]`. While it runs, the loader shows "Installing <package>..." and the buttons are disabled. A failure of either command shows the first stderr line as a copyable notice (the existing notice style) and keeps what was typed; an install failure never writes the config; an overlap error from `use` names both entries and leaves the installed package in place.
- Selecting a framework for an existing path replaces that entry's framework (the switch path); a new disjoint path adds an entry. The overlap and path rules belong to the registry; the pane only displays its message.
- Security wording on the screen: "Deploy installs this package globally with npm and runs its install scripts. Only the packages in this list can be installed." No key or token field exists.
- Out of the box nothing changes for users who never open this screen.

## Scope
- In: `.claude/plugins/sdlc-monitor/hooks/register.tsx`, `.claude/plugins/sdlc-monitor/types/index.d.ts` (only if types are needed).
- Out of scope: the registry and commands (`add-test-framework-registry`); the pipeline (`use-configured-test-runner`); the model provider screens; the SDLC pane; uninstalling packages; free-text package names.

## Tests
- `.claude/plugins/sdlc-monitor/hooks/register.test.ts` (extend, with the existing mock of the `sdlc-mod.sh` calls): the `Test frameworks` button opens the screen and `Back` returns to the providers; the screen lists catalog rows and entries with installed and not installed marks from `--json` output; selecting a row and editing the path updates the form state; the first `Deploy` press runs no command and shows the exact command, the second press runs `framework install <id> --yes` then `framework use <id> --path <path>` with the right argv in that order; an already installed package skips `install`; an install failure shows the first stderr line and does not call `use`; a `use` overlap error shows its message and keeps the input; `Remove` needs a second press and calls `framework remove --path <path>`; an invalid config shows the error line; buttons are disabled while installing.
- `server/__tests__/scripts/config-pane-code.test.js` (extend, it already checks the pane code): the pane never calls the config file or `scripts/sdlc-frameworks.cjs`, only `sdlc-mod.sh framework`.
- Every case runs the real code. Integration tests: none, there is no database or API change.

## Docs
- `README.md`: the `Test frameworks` screen and what `Deploy` does and asks for.
- `CLAUDE.md`: mention the test frameworks screen in the monitor control-pane row.

## Open questions
- none
