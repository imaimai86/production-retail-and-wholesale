const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const sdlc = read('scripts/sdlc.sh');
const lines = sdlc.split('\n');
const lineWith = re => lines.find(l => re.test(l)) || '';

describe('scripts/sdlc.sh gates', () => {
  test('success_check guards Implement, Test repair and Review, and nothing else', () => {
    expect(sdlc).toMatch(/success_check\s*\(\)/);

    // the Red tests gate stays unit-only
    const red = lineWith(/RED GATE FAILED/);
    expect(red).toContain('tests_pass');
    expect(red).not.toContain('success_check');

    // the Implement green gate
    const green = lines.findIndex(l => /GREEN=1/.test(l) && !/^GREEN=1/.test(l));
    expect(green).toBeGreaterThan(-1);
    expect(lines.slice(Math.max(0, green - 1), green + 1).join('\n')).toContain('success_check');

    // after Test repair and after Review
    expect(lineWith(/audited repair/)).toContain('success_check');
    expect(lineWith(/after review/i)).toContain('success_check');

    // exactly three call sites
    const uses = lines.filter(
      l => /success_check/.test(l) && !/success_check\s*\(\)/.test(l) && !/^\s*#/.test(l)
    );
    expect(uses.length).toBe(3);

    // the Test repair pre-check does not use it
    const pre = lines.findIndex(l => /\$CHECK precheck/.test(l));
    expect(pre).toBeGreaterThan(-1);
    expect(lines.slice(Math.max(0, pre - 3), pre + 1).join('\n')).not.toContain('success_check');
  });

  test('mentions integration.log and SDLC_INTEGRATION_CI, with no SDLC_INTEGRATION= opt-out', () => {
    expect(sdlc).toContain('integration.log');
    expect(sdlc).toContain('SDLC_INTEGRATION_CI');
    expect(sdlc).not.toMatch(/SDLC_INTEGRATION=/);
  });

  test('bash -n passes on sdlc.sh and sdlc-integration.sh', () => {
    for (const f of ['scripts/sdlc.sh', 'scripts/sdlc-integration.sh']) {
      const r = spawnSync('bash', ['-n', path.join(root, f)], { encoding: 'utf8' });
      expect([f, r.stderr, r.status]).toEqual([f, '', 0]);
    }
  });
});

describe('Test repair retry of unclaimed failures', () => {
  const callIdx = lines.findIndex(l => /^\s*retry_unclaimed\s*$/.test(l));
  const nowIdx = lines.findIndex(l => l.includes('results_now "$LOG/now.json"'));
  const prechecks = lines.map((l, i) => [l, i]).filter(([l]) => l.includes('precheck "$LOG/now.json"'));
  const defIdx = lines.findIndex(l => /^\s*retry_unclaimed\s*\(\)/.test(l));
  const body = defIdx < 0 ? '' : (() => {
    let end = defIdx + 1;
    while (end < lines.length && !/^\}/.test(lines[end])) end++;
    return lines.slice(defIdx, end + 1).join('\n');
  })();

  test('retry_unclaimed is called once, after results_now now.json and before the first precheck', () => {
    expect(defIdx).toBeGreaterThan(-1);
    expect(nowIdx).toBeGreaterThan(-1);
    expect(prechecks.length).toBeGreaterThan(0);
    expect(callIdx).toBeGreaterThan(nowIdx);
    expect(callIdx).toBeLessThan(prechecks[0][1]);

    // every precheck on now.json still passes MAX_REPAIR_TESTS
    prechecks.forEach(([l]) => expect(l).toContain('MAX_REPAIR_TESTS'));

    // the second jest run (after.json) is not followed by a retry
    expect(lines.findIndex(l => l.includes('results_now "$LOG/after.json"'))).toBeGreaterThan(-1);
    expect(lines.filter(l => /^\s*retry_unclaimed\s*$/.test(l))).toHaveLength(1);
  });

  test('it re-runs only the retry set through the runner adapter, merges the result, and adds no env variable or opt-out switch', () => {
    expect(body).toContain('retry-args');
    expect(body).toContain('node scripts/sdlc-runners.cjs run . --out');
    expect(body).toContain('--file');
    expect(body).toContain('--test');
    expect(body).toContain('|| true');
    expect(body).toContain('>/dev/null 2>&1');
    expect(body).toContain('unclaimed');
    expect(body).toContain('merge-retry');
    expect(body).toContain('flaky-tests.md');

    expect(sdlc).not.toMatch(/\bSDLC_(RETRY|FLAKY)[A-Z_]*=/);
    expect(body).not.toMatch(/\$\{[A-Z_]+:-/);
  });
});

describe('docs', () => {
  test('README.md and CLAUDE.md document SDLC_INTEGRATION_CI and have no off switch', () => {
    for (const f of ['README.md', 'CLAUDE.md']) {
      const t = read(f);
      expect([f, t.includes('SDLC_INTEGRATION_CI=run'), t.includes('SDLC_INTEGRATION=off')]).toEqual([f, true, false]);
    }
  });
});
