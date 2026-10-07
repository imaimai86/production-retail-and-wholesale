const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const sdlc = read('scripts/sdlc.sh');
const lines = sdlc.split('\n');
const lineWith = re => lines.find(l => re.test(l)) || '';

describe('scripts/sdlc.sh gates', () => {
  test('defines success_check', () => {
    expect(sdlc).toMatch(/success_check\s*\(\)/);
  });

  test('Red tests gate stays unit-only', () => {
    const l = lineWith(/RED GATE FAILED/);
    expect(l).toContain('tests_pass');
    expect(l).not.toContain('success_check');
  });

  test('Implement green gate uses success_check', () => {
    const idx = lines.findIndex(l => /GREEN=1/.test(l) && !/^GREEN=1/.test(l));
    expect(idx).toBeGreaterThan(-1);
    expect(lines.slice(Math.max(0, idx - 1), idx + 1).join('\n')).toContain('success_check');
  });

  test('post-Test-repair check uses success_check', () => {
    expect(lineWith(/audited repair/)).toContain('success_check');
  });

  test('post-Review check uses success_check', () => {
    expect(lineWith(/after review/i)).toContain('success_check');
  });

  test('success_check is used at exactly three call sites', () => {
    const uses = lines.filter(
      l => /success_check/.test(l) && !/success_check\s*\(\)/.test(l) && !/^\s*#/.test(l)
    );
    expect(uses.length).toBe(3);
  });

  test('Test repair pre-check does not use success_check', () => {
    const idx = lines.findIndex(l => /\$CHECK precheck/.test(l));
    expect(idx).toBeGreaterThan(-1);
    expect(lines.slice(Math.max(0, idx - 3), idx + 1).join('\n')).not.toContain('success_check');
  });

  test('mentions integration.log and SDLC_INTEGRATION_CI', () => {
    expect(sdlc).toContain('integration.log');
    expect(sdlc).toContain('SDLC_INTEGRATION_CI');
  });

  test('has no SDLC_INTEGRATION= opt-out', () => {
    expect(sdlc).not.toMatch(/SDLC_INTEGRATION=/);
  });

  test.each(['scripts/sdlc.sh', 'scripts/sdlc-integration.sh'])('bash -n passes on %s', f => {
    const r = spawnSync('bash', ['-n', path.join(root, f)], { encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });
});

describe('Test repair retry of unclaimed failures', () => {
  const callIdx = lines.findIndex(l => /^\s*retry_unclaimed\s*$/.test(l));
  const nowIdx = lines.findIndex(l => l.includes('jest_json_now "$LOG/now.json"'));
  const prechecks = lines.map((l, i) => [l, i]).filter(([l]) => l.includes('precheck "$LOG/now.json"'));
  const defIdx = lines.findIndex(l => /^\s*retry_unclaimed\s*\(\)/.test(l));
  const body = defIdx < 0 ? '' : (() => {
    let end = defIdx + 1;
    while (end < lines.length && !/^\}/.test(lines[end])) end++;
    return lines.slice(defIdx, end + 1).join('\n');
  })();

  test('defines retry_unclaimed', () => {
    expect(defIdx).toBeGreaterThan(-1);
  });

  test('the call sits after jest_json_now now.json and before the first precheck', () => {
    expect(nowIdx).toBeGreaterThan(-1);
    expect(prechecks.length).toBeGreaterThan(0);
    expect(callIdx).toBeGreaterThan(nowIdx);
    expect(callIdx).toBeLessThan(prechecks[0][1]);
  });

  test('every precheck on now.json still passes MAX_REPAIR_TESTS', () => {
    prechecks.forEach(([l]) => expect(l).toContain('MAX_REPAIR_TESTS'));
  });

  test('the second jest run (after.json) is not followed by a retry', () => {
    const afterIdx = lines.findIndex(l => l.includes('jest_json_now "$LOG/after.json"'));
    expect(afterIdx).toBeGreaterThan(-1);
    expect(lines.filter(l => /^\s*retry_unclaimed\s*$/.test(l))).toHaveLength(1);
  });

  test('re-runs only the retry set from server/ and merges the result', () => {
    expect(body).toContain('npx jest');
    expect(body).toContain(' -t ');
    expect(body).toContain('--json --outputFile');
    expect(body).toContain('|| true');
    expect(body).toContain('>/dev/null 2>&1');
    expect(body).toContain('cd server');
    expect(body).toContain('unclaimed');
    expect(body).toContain('merge-retry');
    expect(body).toContain('flaky-tests.md');
  });

  test('adds no new env variable or opt-out switch', () => {
    expect(sdlc).not.toMatch(/\bSDLC_(RETRY|FLAKY)[A-Z_]*=/);
    expect(body).not.toMatch(/\$\{[A-Z_]+:-/);
  });
});

describe('docs', () => {
  test.each(['README.md', 'CLAUDE.md'])('%s documents SDLC_INTEGRATION_CI and has no off switch', f => {
    const t = read(f);
    expect(t).toContain('SDLC_INTEGRATION_CI=run');
    expect(t).not.toContain('SDLC_INTEGRATION=off');
  });
});
