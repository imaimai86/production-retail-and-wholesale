const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const sdlc = fs.readFileSync(path.join(root, 'scripts/sdlc.sh'), 'utf8');

describe('scripts/sdlc.sh Ship wiring', () => {
  test('the old blanket git add is gone', () => {
    expect(sdlc).not.toContain('git add server "$DOCS"');
  });

  test('snapshot is taken once, in the baseline block before Spec, and not in Ship', () => {
    expect(sdlc.match(/sdlc-changes\.cjs snapshot/g)).toHaveLength(2);
    const block = sdlc.slice(sdlc.indexOf('BASELINE="$LOG/baseline.json"'), sdlc.indexOf('# 1. SPEC'));
    expect(block.match(/sdlc-changes\.cjs snapshot/g)).toHaveLength(2);
    expect(block).toContain('WARNING: no baseline from the original run; changes made before this resume are treated as pre-existing and will not be committed');
    expect(sdlc.slice(sdlc.indexOf('# 6. SHIP'))).not.toContain('snapshot');
  });

  test('Ship calls scripts/sdlc-ship.sh', () => {
    expect(sdlc.slice(sdlc.indexOf('# 6. SHIP'))).toContain('bash scripts/sdlc-ship.sh "$SLUG" "$DOCS" "$BASELINE" "$BACKLOG"');
  });

  test('Red tests and Test repair commits are unchanged', () => {
    expect(sdlc).toContain('git commit -q -m "test($SLUG): repair invalid tests (mechanically checked and audited)"');
    expect(sdlc).toContain('git add "$DOCS" "$TEST_DIR"');
  });

  test.each(['sdlc.sh', 'sdlc-ship.sh'])('bash -n passes on %s', f => {
    expect(spawnSync('bash', ['-n', path.join(root, 'scripts', f)]).status).toBe(0);
  });
});
