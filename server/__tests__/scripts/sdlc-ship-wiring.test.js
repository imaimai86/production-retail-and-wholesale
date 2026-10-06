const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const sdlc = fs.readFileSync(path.join(root, 'scripts/sdlc.sh'), 'utf8');

describe('scripts/sdlc.sh Ship wiring', () => {
  test('no longer stages only server and the docs folder', () => {
    expect(sdlc).not.toContain('git add server "$DOCS"');
  });

  test('takes the baseline snapshot only on the FROM=spec path (or when resuming without one)', () => {
    const calls = sdlc.split('\n').filter(l => l.includes('sdlc-changes.cjs snapshot'));
    expect(calls).toHaveLength(2);
    expect(sdlc).toMatch(/if \[ "\$FROM_N" -le 1 \] && .*BASELINE.*; then\n\s*node scripts\/sdlc-changes\.cjs snapshot "\$BASELINE"/);
    expect(sdlc).toMatch(/elif \[ ! -f "\$BASELINE" \]; then\n\s*node scripts\/sdlc-changes\.cjs snapshot "\$BASELINE"\n\s*echo "WARNING: no baseline from the original run/);
  });

  test('the Ship stage calls bash scripts/sdlc-ship.sh', () => {
    expect(sdlc).toContain('bash scripts/sdlc-ship.sh "$SLUG" "$DOCS" "$BASELINE" "$BACKLOG"');
  });

  test('the Red tests and Test repair commits are unchanged', () => {
    expect(sdlc).toContain('git add "$DOCS" "$TEST_DIR"\ngit commit -q -m "test($SLUG): add failing tests and spec/plan docs"');
    expect(sdlc).toContain('  git add "$DOCS" "$TEST_DIR"\n  git commit -q -m "test($SLUG): repair invalid tests (mechanically checked and audited)"');
  });

  test('the header documents the behaviour and ship-skipped.md', () => {
    expect(sdlc.split('\n').slice(0, 20).join('\n')).toContain('ship-skipped.md');
  });

  test.each(['scripts/sdlc.sh', 'scripts/sdlc-ship.sh'])('bash -n passes on %s', f => {
    expect(spawnSync('bash', ['-n', path.join(root, f)]).status).toBe(0);
  });
});
