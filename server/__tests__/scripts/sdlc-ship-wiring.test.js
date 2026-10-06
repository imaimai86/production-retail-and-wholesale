const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const sdlc = read('scripts/sdlc.sh');
const lines = sdlc.split('\n');
const code = lines.filter(l => !/^\s*#/.test(l));
const trimmed = code.map(l => l.trim());
const idx = re => lines.findIndex(l => re.test(l));

const WARNING =
  'WARNING: no baseline from the original run; changes made before this resume are treated as pre-existing and will not be committed';
const SHIP_CALL = 'bash scripts/sdlc-ship.sh "$SLUG" "$DOCS" "$LOG/baseline.json" "$BACKLOG"';

describe('scripts/sdlc.sh Ship wiring', () => {
  test('AC24: no longer contains the blanket git add server "$DOCS"', () => {
    expect(sdlc).not.toContain('git add server "$DOCS"');
  });

  test('inline feat commit, backlog sed/commit and DONE echo are gone', () => {
    expect(sdlc).not.toMatch(/git commit -q -m "feat\(/);
    expect(sdlc).not.toMatch(/git commit -q -m "chore\(backlog\)/);
    expect(code.join('\n')).not.toMatch(/echo "DONE:/);
  });

  test('AC25: Ship stage calls sdlc-ship.sh with the four arguments, after the Commit stage banner', () => {
    const calls = trimmed.filter(l => l.includes('bash scripts/sdlc-ship.sh'));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(SHIP_CALL);
    expect(idx(/bash scripts\/sdlc-ship\.sh/)).toBeGreaterThan(idx(/stage "6\/6 Commit"/));
  });

  test('AC25: the Ship call is the last command, so its status is the run status', () => {
    const last = trimmed.filter(l => l.length > 0).pop();
    expect(last).toBe(SHIP_CALL);
  });

  test('AC25: snapshot is called exactly twice: FROM=spec path and FROM=implement fallback', () => {
    const snaps = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => !/^\s*#/.test(l) && l.includes('scripts/sdlc-changes.cjs snapshot'));
    expect(snaps).toHaveLength(2);
    snaps.forEach(({ l }) => expect(l.trim()).toBe('node scripts/sdlc-changes.cjs snapshot "$LOG/baseline.json"'));

    const specIf = idx(/if \[ "\$FROM" = "spec" \]; then/);
    const specStage = idx(/stage "1\/6 Spec"/);
    const elseIdx = lines.findIndex((l, i) => i > specIf && /^else\b/.test(l));
    const redStage = idx(/stage "3\/6 Red tests/);
    expect(specIf).toBeGreaterThan(-1);
    // First call: inside the spec branch, before the Spec stage.
    expect(snaps[0].i).toBeGreaterThan(specIf);
    expect(snaps[0].i).toBeLessThan(specStage);
    // Second call: inside the resume (else) branch, guarded by a missing-baseline check.
    expect(snaps[1].i).toBeGreaterThan(elseIdx);
    expect(lines.slice(elseIdx, snaps[1].i + 1).join('\n')).toMatch(/if \[ ! -f "\$LOG\/baseline\.json" \]/);
    expect(elseIdx).toBeGreaterThan(redStage - 1);
  });

  test('AC25: baseline is not taken after Spec has started', () => {
    const specStage = idx(/stage "1\/6 Spec"/);
    const firstSnap = idx(/scripts\/sdlc-changes\.cjs snapshot/);
    expect(firstSnap).toBeLessThan(specStage);
  });

  test('AC26: Red tests commit lines are unchanged', () => {
    const adds = trimmed.filter(l => l === 'git add "$DOCS" "$TEST_DIR"');
    expect(adds).toHaveLength(2);
    expect(trimmed).toContain('git commit -q -m "test($SLUG): add failing tests and spec/plan docs"');
  });

  test('AC26: Test repair commit lines are unchanged', () => {
    expect(trimmed).toContain('git commit -q -m "test($SLUG): repair invalid tests (mechanically checked and audited)"');
    const repairIdx = lines.findIndex(l => l.includes('repair invalid tests'));
    expect(lines[repairIdx - 1].trim()).toBe('git add "$DOCS" "$TEST_DIR"');
  });

  test('AC26: Red tests add is immediately followed by its commit', () => {
    const i = lines.findIndex(l => l.includes('add failing tests and spec/plan docs'));
    expect(lines[i - 1].trim()).toBe('git add "$DOCS" "$TEST_DIR"');
  });

  test('AC27: bash -n passes on sdlc.sh and sdlc-ship.sh', () => {
    for (const f of ['scripts/sdlc.sh', 'scripts/sdlc-ship.sh']) {
      const r = spawnSync('bash', ['-n', path.join(root, f)], { encoding: 'utf8' });
      expect({ f, status: r.status, stderr: r.stderr }).toEqual({ f, status: 0, stderr: '' });
    }
  });

  test('sdlc-ship.sh uses strict mode and is invoked via bash (no X_OK reliance)', () => {
    const ship = read('scripts/sdlc-ship.sh');
    expect(ship).toMatch(/^set -euo pipefail$/m);
    expect(sdlc).not.toMatch(/^\s*(\.\/)?scripts\/sdlc-ship\.sh/m);
    expect(sdlc).not.toMatch(/^\s*(\.\/)?scripts\/sdlc-changes\.cjs/m);
  });

  test('AC28: FROM=implement fallback prints the exact warning before taking the snapshot', () => {
    const w = lines.findIndex(l => l.includes(WARNING));
    expect(w).toBeGreaterThan(-1);
    expect(sdlc.split(WARNING).length - 1).toBe(1);
    expect(lines[w]).toMatch(/^\s*echo "WARNING: /);
    const snap2 = lines.findIndex((l, i) => i > w && l.includes('scripts/sdlc-changes.cjs snapshot'));
    expect(snap2).toBeGreaterThan(w);
    expect(lines.slice(w - 3, w).join('\n')).toMatch(/\[ ! -f "\$LOG\/baseline\.json" \]/);
  });

  test('existing wiring constraints stay intact (backlog grep line, no SDLC_INTEGRATION=)', () => {
    expect(sdlc).toContain("grep -m1 '^- \\[ \\]'");
    expect(sdlc).not.toContain('SDLC_INTEGRATION=');
  });

  test('logs directory (and so baseline.json) is git-ignored', () => {
    const r = spawnSync('git', ['check-ignore', '-q', 'Docs/backlog/some-slug/logs/baseline.json'], { cwd: root });
    expect(r.status).toBe(0);
  });
});

describe('documentation (AC29)', () => {
  const reasons = [
    'sensitive file',
    'local or agent configuration',
    'generated',
    'pre-existing local changes',
    'too large',
  ];

  test('README.md describes the Ship stage, skip reasons and ship-skipped.md', () => {
    const readme = read('README.md');
    expect(readme).toContain('ship-skipped.md');
    for (const r of reasons) expect(readme).toContain(r);
    expect(readme).toMatch(/Ship/);
    expect(readme).toContain('SDLC_INTEGRATION_CI=run');
    expect(readme).not.toContain('SDLC_INTEGRATION=off');
  });

  test('CLAUDE.md has one line on Ship scope and logs/ship-skipped.md', () => {
    const claude = read('CLAUDE.md');
    const hits = claude.split('\n').filter(l => l.includes('ship-skipped.md'));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatch(/Ship/);
    expect(hits[0]).toContain('Docs/backlog/<slug>/logs/ship-skipped.md');
    expect(hits[0]).toMatch(/only/i);
    expect(claude).not.toContain('SDLC_INTEGRATION=off');
  });

  test('sdlc.sh header comment documents baseline, Ship scope, skip reasons and ship-skipped.md', () => {
    const setIdx = lines.findIndex(l => /^set -/.test(l));
    expect(setIdx).toBeGreaterThan(0);
    const header = lines.slice(0, setIdx).join('\n');
    expect(header).toContain('baseline');
    expect(header).toContain('ship-skipped.md');
    for (const r of reasons) expect(header).toContain(r);
    expect(header).not.toContain('git add server "$DOCS"');
    expect(header).not.toContain('SDLC_INTEGRATION=');
  });
});
