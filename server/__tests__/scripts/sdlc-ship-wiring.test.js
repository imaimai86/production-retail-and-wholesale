const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const sdlc = fs.readFileSync(path.join(root, 'scripts/sdlc.sh'), 'utf8');

describe('scripts/sdlc.sh Ship wiring', () => {
  test('Ship calls scripts/sdlc-ship.sh instead of a blanket git add, the snapshot is taken once before Spec, and bash -n passes', () => {
    expect(sdlc).not.toContain('git add server "$DOCS"');

    // the snapshot is taken in the baseline block before Spec, and not in Ship
    expect(sdlc.match(/sdlc-changes\.cjs snapshot/g)).toHaveLength(2);
    const block = sdlc.slice(sdlc.indexOf('BASELINE="$LOG/baseline.json"'), sdlc.indexOf('# 1. SPEC'));
    expect(block.match(/sdlc-changes\.cjs snapshot/g)).toHaveLength(2);
    expect(block).toContain('WARNING: no baseline from the original run; changes made before this resume are treated as pre-existing and will not be committed');
    const shipBlock = sdlc.slice(sdlc.indexOf('# 6. SHIP'));
    expect(shipBlock).not.toContain('snapshot');
    expect(shipBlock).toContain('bash scripts/sdlc-ship.sh "$SLUG" "$DOCS" "$BASELINE" "$BACKLOG"');

    // the Red tests and Test repair commits are unchanged
    expect(sdlc).toContain('git commit -q -m "test($SLUG): repair invalid tests (mechanically checked and audited)"');
    expect(sdlc).toContain('git add -A -- "$DOCS"; add_tests');

    for (const f of ['sdlc.sh', 'sdlc-ship.sh']) {
      expect([f, spawnSync('bash', ['-n', path.join(root, 'scripts', f)]).status]).toEqual([f, 0]);
    }
  });
});
