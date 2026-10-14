# Unit test execution times

A record of how long the unit tests take, so later runs can be compared with it. Add a new dated section for each new measurement; do not overwrite an old one.

## How to measure

Run each group on its own from `server/`, and read the `Time:` line Jest prints:

```bash
cd server
for g in index.test.js validation.test.js models middleware config docs migrations test-utils engineering; do
  echo "$g | $(npx jest "__tests__/$g" 2>&1 | grep -E '^(Tests:|Time:)' | tr '\n' ' ')"
done
for f in __tests__/scripts/*.test.js; do
  echo "$(basename "$f") | $(npx jest "$f" 2>&1 | grep -E '^(Tests:|Time:)' | tr '\n' ' ')"
done
```

- The times are Jest's own `Time:` value for each run. They leave out the time `npx` takes to start.
- Each group runs alone, one after the other, so the total is a sequential total. `npm test` runs four files in parallel and finishes sooner.
- The integration tests (`__tests__/integration/`) need a database and are not measured here.
- Measure on an idle machine. Check first that `time git --version` and `time node --version` take a few hundredths of a second: most of the time in `scripts/` goes to starting `git`, `node` and `bash`, so a machine that starts programs slowly gives numbers many times higher.

## 2026-10-13: after merging tests (about 545 down to 195 `test()` calls)

| Item | Value |
|---|---|
| Commit | `1b8910a` plus the uncommitted test merge |
| Machine | Apple M1 Pro, 10 cores, 16 GB, macOS 26.3 |
| Node / Jest / git | v22.22.2 / 29.7.0 / 2.55.0 |
| Condition | 14 to 17 minutes after a reboot, load average about 2 |

### By group

| Group | Suites | Tests | Time |
|---|---|---|---|
| `scripts/` | 18 | 136 | 148.8 s |
| `index.test.js` | 1 | 16 | 0.37 s |
| `models/` | 7 | 24 | 0.25 s |
| `docs/` | 2 | 5 | 0.24 s |
| `middleware/` | 2 | 6 | 0.14 s |
| `test-utils/` | 1 | 7 | 0.12 s |
| `config/` | 1 | 4 | 0.12 s |
| `migrations/` | 1 | 2 | 0.11 s |
| `validation.test.js` | 1 | 1 | 0.11 s |
| `engineering/` | 1 | 1 | 0.11 s |
| **Total** | **35** | **202** | **150.3 s** |

Jest counts 202 tests (204 in one `npm test` run) because a `test.each` in `sdlc-models.test.js` expands to 9 cases.

### `scripts/` by file

| File | Tests | Time |
|---|---|---|
| `sdlc-mod.test.js` | 19 | 36.31 s |
| `sdlc-test-repair-resume.test.js` | 10 | 25.29 s |
| `sdlc-changes.test.js` | 7 | 19.72 s |
| `sdlc-integration.test.js` | 4 | 17.03 s |
| `sdlc-ship.test.js` | 4 | 14.62 s |
| `backlog-list.test.js` | 21 | 11.87 s |
| `sdlc-agent-permissions.test.js` | 2 | 5.01 s |
| `sdlc-providers-registry.test.js` | 5 | 5.01 s |
| `sdlc-providers.test.js` | 5 | 3.39 s |
| `sdlc-testcheck.test.js` | 8 | 3.17 s |
| `sdlc-mod-model.test.js` | 2 | 2.97 s |
| `sdlc-manual-input.test.js` | 2 | 1.39 s |
| `sdlc-permissions.test.js` | 7 | 0.88 s |
| `sdlc-models.test.js` | 30 | 0.84 s |
| `backlog-list-wiring.test.js` | 3 | 0.49 s |
| `sdlc-ship-wiring.test.js` | 1 | 0.37 s |
| `sdlc-gates.test.js` | 6 | 0.33 s |
| `config-pane-code.test.js` | 2 | 0.12 s |

### Notes on this measurement

- Two tests were failing when this was measured, both because of uncommitted edits outside the tests: `config/test-setup.test.js` (the server `test` script was `jest --maxWorkers=4`, the test expects `jest`) and `scripts/config-pane-code.test.js` (the CONFIG button label in `register.tsx`). A failing test stops early, so those two files may take slightly longer once they pass.
- There is no measurement from before the merge on a healthy machine, so this section is the first baseline, not a before-and-after comparison.
- One full `npm test` run took 314 s earlier the same day, but the machine was still busy starting up after the reboot, so that figure is not a baseline.
