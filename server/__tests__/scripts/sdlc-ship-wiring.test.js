const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../../..');
const sdlc = fs.readFileSync(path.join(repoRoot, 'scripts', 'sdlc.sh'), 'utf8');

// The FROM=spec branch is the first `if [ "$FROM" = "spec" ]` block up to its `else`.
const specStart = sdlc.indexOf('if [ "$FROM" = "spec" ]; then');
const resumeStart = sdlc.indexOf('\nelse\n', specStart);
const specBranch = sdlc.slice(specStart, resumeStart);
const resumeBranch = sdlc.slice(resumeStart, sdlc.indexOf('\nfi\n', resumeStart));

describe('scripts/sdlc.sh Ship wiring', () => {
  test('no longer stages only server and the docs folder', () => {
    expect(sdlc).not.toContain('git add server "$DOCS"');
  });

  test('takes the baseline snapshot in the FROM=spec path', () => {
    expect(specStart).toBeGreaterThan(-1);
    expect(specBranch).toContain('scripts/sdlc-changes.cjs snapshot "$BASELINE"');
    expect(specBranch.indexOf('sdlc-changes.cjs snapshot')).toBeLessThan(specBranch.indexOf('stage "1/6 Spec"'));
  });

  test('the resume path reuses the baseline and only creates one, with a warning, when it is missing', () => {
    expect(resumeBranch).toContain('if [ ! -f "$BASELINE" ]; then');
    expect(resumeBranch).toContain('WARNING: no baseline from the original run');
    expect(sdlc.match(/sdlc-changes\.cjs snapshot/g)).toHaveLength(2);
  });

  test('the Ship stage runs bash scripts/sdlc-ship.sh', () => {
    const ship = sdlc.slice(sdlc.indexOf('# 6. SHIP'));
    expect(ship).toContain('bash scripts/sdlc-ship.sh "$SLUG" "$DOCS" "$BASELINE" "$BACKLOG"');
    expect(ship).not.toMatch(/git (add|commit)/);
  });

  test('the Red tests and Test repair commits are unchanged', () => {
    expect(sdlc).toContain('git add "$DOCS" "$TEST_DIR"\ngit commit -q -m "test($SLUG): add failing tests and spec/plan docs"');
    expect(sdlc).toContain('  git add "$DOCS" "$TEST_DIR"\n  git commit -q -m "test($SLUG): repair invalid tests (mechanically checked and audited)"');
  });

  test('the header documents ship-skipped.md', () => {
    expect(sdlc.split('set -euo pipefail')[0]).toContain('ship-skipped.md');
  });

  test.each(['sdlc.sh', 'sdlc-ship.sh'])('bash -n passes on scripts/%s', name => {
    const r = spawnSync('bash', ['-n', path.join(repoRoot, 'scripts', name)], { encoding: 'utf8' });
    expect(r.status).toBe(0);
  });
});
