# Plan: sdlc-helper, a project-agnostic SDLC pipeline and control pane

Goal: turn the SDLC pipeline (`scripts/sdlc*.sh`, `scripts/*.cjs`, `scripts/prompts/`, `.claude/commands/`,
`.claude/helpers/sdlc-guard.cjs`) and the monitor pane (`.claude/plugins/sdlc-monitor`) into a product other Claude Code
users can install. It must not depend on the project's language, database or test framework.

## 1. What we ship

One GitHub repo (`imaimai86/sdlc-helper`) that produces two things:

| Piece | Install | Contains |
|---|---|---|
| **`sdlc-helper` npm package** (the engine) | `npm i -g sdlc-helper` | The CLI, pipeline engine, test runner adapters, project registry, model registry, default prompts |
| **`sdlc` Claude Code plugin** (the interface) | `/plugin marketplace add imaimai86/sdlc-helper` then `/plugin install sdlc@sdlc-helper` | Slash commands (`/sdlc`, `/spec`, `/plan`, ...), the control pane, the guard hooks, and the working rules that today live in CLAUDE.md |

The plugin is thin: every action calls the `sdlc-helper` CLI. It checks on SessionStart that the CLI is installed with
a compatible version, and tells the user how to install it if not. Keeping the engine in the npm package means it also
works without Claude Code's UI (terminal, CI), and both pieces version together from one repo.

The names `sdlc-helper` and `sdlc-kit` were both free on npm on 2026-10-14.

## 2. Projects and configuration

### Project registry (user-level)
`~/.config/sdlc-helper/projects.json` (`%APPDATA%\sdlc-helper` on Windows, `$XDG_CONFIG_HOME` honoured), next to the
model registry that already lives there (`scripts/sdlc-models.cjs`).

```
sdlc-helper add [path] [--name app]   detect the project, show the proposed config, write it after confirmation
sdlc-helper list | remove <name>
sdlc-helper detect [path]             print what detection finds, write nothing
sdlc-helper config get|set <key> [value] [--project name]
sdlc-helper doctor [--project name]   check git, claude, node, the test runner, optional graft; run the suite once
```

The registry holds only the path, a name and personal overrides (worktree folder, models, max parallel runs).

### Project config (in the repo, committed)
`sdlc.config.json` at the project root, so teammates and CI get the same settings. Anything left out falls back to
detection, then to built-in defaults.

```jsonc
{
  "$schema": "https://unpkg.com/sdlc-helper/schema.json",
  "backlogDir": "Docs/backlog",
  "suites": [
    {
      "name": "server",
      "dir": "server",                       // the runner's working directory
      "runner": "jest",                      // or "auto"
      "testGlobs": ["__tests__/**/*.test.js"],
      "sourceGlobs": ["**/*.js"],            // what Implement may change; used for the source-change hash
      "setup": "npm ci"                      // run once in a new worktree (optional)
    }
  ],
  "integration": { "cmd": "bash scripts/sdlc-integration.sh", "ci": "skip" },   // optional; "ci": "run" | "skip"
  "lint": "npm run lint",                                                    // optional
  "worktree": { "base": "../{repo}-sdlc", "link": ["server/node_modules", ".env"] },
  "git": { "branchPrefix": "sdlc/", "base": "origin/main", "conflictSuffix": "10001" },
  "agent": { "allowCommands": ["npm run generate-spec:*"], "codeSearch": "auto" },   // codeSearch: graft | none | auto
  "ship": { "envExample": true, "maxFileBytes": 1048576 },
  "ui": { "timezone": "Asia/Dubai" }
}
```

The database is not part of the config: the project's own integration command deals with it (see the earlier
`DATABASE_URL` discussion). This repo keeps `scripts/sdlc-integration.sh` and points `integration.cmd` at it.

## 3. Test framework: adapters and detection

### Adapter interface
Each runner is a small module:

```ts
interface RunnerAdapter {
  id: string                                         // "jest", "pytest", ...
  detect(dir: string): Promise<Detection | null>     // { confidence, reason, suggested suite fields }
  run(opts: { suite, files?: string[], testName?: string, out: string }): Promise<RunResult>
  allowCommands(suite): string[]                     // Bash() patterns the stage agents may run
  conventions(suite): string                         // text for the Red tests prompt: style, mocking, file naming
}
// RunResult is the one shape the pipeline reads (replaces Jest's JSON in sdlc-testcheck.cjs):
type RunResult = { ok: boolean, tests: { file: string, name: string, status: 'passed'|'failed'|'skipped' }[],
                   suiteErrors: { file: string, message: string }[], raw: string }
```

### Adapters to build

| Ecosystem | Detected from | Runner | Machine-readable output |
|---|---|---|---|
| Node / TypeScript | `package.json` dependencies and `scripts.test`, `vitest.config.*`, `jest.config.*`, `.mocharc*`, `tsconfig.json` | jest, vitest, mocha, node:test | `--json` (jest, vitest), mocha `json` reporter, node:test `--test-reporter=junit` |
| Python | `pyproject.toml`, `pytest.ini`, `setup.cfg`, `tox.ini`, `requirements*.txt` | pytest (unittest through pytest) | `--junitxml` |
| Go | `go.mod` | go test | `go test -json` |
| Rust | `Cargo.toml` | cargo test / cargo-nextest | nextest JUnit, else parsed libtest output |
| Java / Kotlin | `pom.xml`, `build.gradle(.kts)` | Maven Surefire, Gradle | JUnit XML report folders |
| .NET | `*.sln`, `*.csproj` | dotnet test | `--logger trx` |
| Ruby | `Gemfile`, `.rspec` | rspec, minitest | `--format json`, minitest JUnit reporter |
| PHP | `composer.json`, `phpunit.xml` | phpunit | `--log-junit` |
| Anything else | config only | `generic-junit` | any command plus a JUnit XML path |

JUnit XML is the common fallback: one parser covers most ecosystems, and `generic-junit` lets users bring any runner.

### Detection rules
- Scan the root and one or two levels down (monorepos, `server/` here), skipping `node_modules`, `.venv`, `vendor`, `target`, `dist`.
- Each folder may produce a suite. Rank by explicit config files over dependency entries over `scripts.test` text.
- When two runners match in one folder (jest and vitest both installed), ask in `sdlc-helper add` and record the choice.
- `runner: "auto"` in the config re-runs detection at each pipeline start and fails loudly if it becomes ambiguous.

### Running one test (retries and repair)
Today `jest -t "<name>"`. Each adapter maps (file, test name) to its own filter: `vitest -t`, `pytest file::name`,
`go test -run '^Name$' ./pkg`, `mvn -Dtest=Class#method`, `dotnet test --filter`, `rspec file:line`. When a runner
cannot filter by name, the adapter reruns the whole file.

## 4. Changes to the pipeline (what is hard-coded today)

| Today | Where | Becomes |
|---|---|---|
| `TEST_CMD="npm test"`, `TEST_DIR="server/__tests__"` | `scripts/sdlc.sh:43-44` | suites from config |
| `npx jest --json` in `jest_json_at`, `jest_json_now`, `retry_unclaimed` | `scripts/sdlc.sh:227-252` | `adapter.run()` |
| Jest JSON fields `testResults[].assertionResults[]` | `scripts/sdlc-testcheck.cjs:25-96` | `RunResult` |
| `src_hash` over `server` | `scripts/sdlc.sh:256` | `sourceGlobs` minus `testGlobs` |
| `ALLOWED` with `npm test`, `npm run lint`, `generate-spec`, graft | `scripts/sdlc.sh:61-63` | base set, `adapter.allowCommands()`, `agent.allowCommands`, graft only if enabled |
| Symlinks `server/node_modules`, `node_modules`, `graft`, `.env` | `scripts/sdlc.sh:231`, `scripts/sdlc-mod.sh:139` | `worktree.link` (per ecosystem defaults: `node_modules`, `.venv`) plus `setup` |
| `scripts/sdlc-integration.sh`, `SDLC_INTEGRATION_CI` | `scripts/sdlc.sh:219` | `integration.cmd`, `integration.ci` |
| Guard protects `server/__tests__` | `.claude/helpers/sdlc-guard.cjs` | `testGlobs` of every suite |
| `Docs/backlog`, `sdlc/<slug>`, `../<repo>-sdlc`, `origin/main` | `sdlc.sh`, `sdlc-mod.sh` | `backlogDir`, `git.*`, `worktree.base` |
| `.env` provider list | `scripts/sdlc.sh:94-156` | the user-level model registry only (already preferred); `.env` read kept for compatibility |
| Prompts with Jest and Node wording | `scripts/prompts/*.md`, `.claude/commands/*.md` | packaged defaults with new placeholders `{{RUNNER}}`, `{{LANGUAGE}}`, `{{TEST_GLOBS}}`, `{{TEST_CONVENTIONS}}`; a project can override any prompt in `.sdlc/prompts/` |
| Ship's `.env` to `.env.example` copy | `scripts/sdlc-ship.sh` | kept, behind `ship.envExample` |
| Paths relative to `scripts/` (`cd "$(dirname "$0")/.."`) | every script | the engine runs from its install folder against `--project <path>` (default: the registry entry for the current directory) |
| CLAUDE.md working rules (monitor command, Spec question flow, merge confirmation, GST times, branch suffix) | `CLAUDE.md` | plugin skill plus SessionStart context; timezone from `ui.timezone` |

Run state stays where it is today (`<git common dir>/sdlc-runs/`) and logs stay in `<backlogDir>/<slug>/logs/`,
so the pane works the same.

### Bash or Node
Recommendation: port `sdlc.sh` (414 lines) and `sdlc-mod.sh` (349 lines) to TypeScript while extracting. Reasons: the
adapters and config are structured code anyway, the engine becomes unit-testable without spawning shells, and Windows
works without WSL. `claude`, `git` and the test runners are still spawned as processes. Port behaviour first, using
the existing pipeline tests as the reference, then generalise.

## 5. The plugin

- `commands/`: `/sdlc`, `/spec`, `/plan`, `/red-tests`, `/implement`, `/review`, `/ship`, `/tdd-loop`, `/triage`,
  `/interview`, `/backlog-list`, plus `/sdlc-init` (runs `sdlc-helper add .` and creates `<backlogDir>/index.md`).
- `hooks/`: the control pane (`register.tsx`, with `WRAPPER` replaced by the `sdlc-helper` binary and backlog
  listing by `sdlc-helper backlog --json`), the guard as PreToolUse and Stop hooks, and a SessionStart check for the CLI.
- `skills/sdlc-rules`: the working rules from CLAUDE.md, worded generally (stage names, monitor command while a run is
  active, how Spec and Plan questions are answered, never merge without confirmation, times in `ui.timezone`).
- Risk to check first: the pane is built on the plugin `register.tsx` and types interface. Confirm it works for other
  users on the current public Claude Code release; if not, ship commands and hooks, and keep `sdlc-helper watch` as
  the terminal monitor.

## 6. Phases

Each phase leaves this repo working.

1. **Config and detection, in this repo.** Add the config schema, loader and `detect` with Node adapters (jest,
   vitest, mocha, node:test). Write `sdlc.config.json` for this repo that reproduces today's behaviour exactly.
   Tests: detection fixtures per ecosystem; loading config with defaults.
2. **Runner adapters and `RunResult`.** Jest adapter first; `sdlc-testcheck.cjs` reads `RunResult`. Then vitest,
   mocha, node:test and generic-junit (pytest and go after launch). Tests: recorded runner output in fixtures, parsed into `RunResult`.
3. **Remove the hard-coded parts** in the table in section 4, one row at a time, with this repo's pipeline tests
   staying green.
4. **Extract into `sdlc-helper`.** New repo; port the engine to TypeScript; CLI with `add`, `list`, `detect`,
   `doctor`, `config`, `run`, `stop`, `restart`, `discard`, `status`, `watch`, `changes`, `permit`, `model`,
   `backlog`. This repo then uses the published package and drops its copies of the scripts.
5. **Plugin and marketplace.** Move commands, pane and hooks; add `/sdlc-init` and the rules skill;
   `.claude-plugin/marketplace.json` at the repo root.
6. **End-to-end checks.** Sample projects in the repo (Node + Jest, TypeScript + Vitest, Node + Mocha, a JUnit-only project) run the
   whole pipeline in CI, with `claude` replaced by a recorded stub so CI needs no API key; one real run per release.
7. **Release.** npm publish with provenance, a GitHub release, a README with install, `sdlc-helper add` and
   troubleshooting, semver, and a CHANGELOG. The plugin declares the CLI version range it supports.

## 7. Decisions (2026-10-14)

1. **Config location:** in-repo `sdlc.config.json` plus the user-level registry.
2. **Engine:** port `sdlc.sh` and `sdlc-mod.sh` to TypeScript during extraction.
3. **First release:** Node/TypeScript only (jest, vitest, mocha, node:test), plus the `generic-junit` adapter so
   other languages can run through a JUnit XML report. Python, Go and the rest come after launch.
4. **Where to start:** phase 1 is built in this repo, then extracted into `sdlc-helper` in phase 4.

Still open: product name and repo (`sdlc-helper` under `imaimai86` assumed), and whether graft stays optional
(assumed: optional and detected).
