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

describe('docs', () => {
  test.each(['README.md', 'CLAUDE.md'])('%s documents SDLC_INTEGRATION_CI and has no off switch', f => {
    const t = read(f);
    expect(t).toContain('SDLC_INTEGRATION_CI=run');
    expect(t).not.toContain('SDLC_INTEGRATION=off');
  });
});
