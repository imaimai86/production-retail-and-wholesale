const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const sdlc = fs.readFileSync(path.join(root, 'scripts/sdlc.sh'), 'utf8');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-input-'));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.copyFileSync(path.join(root, 'scripts/sdlc.sh'), path.join(dir, 'scripts/sdlc.sh'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

describe('FROM validation in scripts/sdlc.sh', () => {
  test('an unknown FROM exits 1 with the message and creates nothing', () => {
    const dir = tmpRepo();
    const r = spawnSync('bash', ['scripts/sdlc.sh', 'alpha'], { cwd: dir, env: { ...process.env, FROM: 'bogus' }, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('ERROR: unknown FROM=bogus (use spec, plan, red-tests, implement or review)');
    expect(fs.readdirSync(dir).sort()).toEqual(['.git', 'scripts']);
  });

  test.each(['spec', 'plan', 'red-tests', 'implement', 'review'])('FROM=%s is accepted (fails later, not on validation)', from => {
    const dir = tmpRepo();
    const r = spawnSync('bash', ['scripts/sdlc.sh', 'alpha'], { cwd: dir, env: { ...process.env, FROM: from }, encoding: 'utf8' });
    expect(r.stdout).not.toContain('unknown FROM');
    expect(r.stdout).toContain('Missing Docs/backlog/alpha/brief.md');
  });

  test('bash -n passes', () => {
    expect(spawnSync('bash', ['-n', path.join(root, 'scripts/sdlc.sh')]).status).toBe(0);
  });
});

describe('manual_input', () => {
  const fn = sdlc.slice(sdlc.indexOf('manual_input() {'), sdlc.indexOf('tests_pass()'));
  const run = (file, stage) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-mi-'));
    if (file !== null) fs.writeFileSync(path.join(dir, 'manual-inputs.md'), file);
    const script = `DOCS="${dir}"; TEST_DIR=server/__tests__\n${fn}\nmanual_input ${stage}`;
    return spawnSync('bash', ['-c', script], { encoding: 'utf8' }).stdout;
  };

  test('prints only the requested stage section as binding input', () => {
    const out = run('## plan\nUse a queue.\n\n## implement\nKeep it small.\nNo new deps.\n', 'implement');
    expect(out).toContain('MANUAL INPUT');
    expect(out).toContain('Keep it small.\nNo new deps.');
    expect(out).not.toContain('Use a queue.');
  });

  test('prints nothing when the file, the section or its text is missing', () => {
    expect(run(null, 'plan')).toBe('');
    expect(run('## plan\nx\n', 'review')).toBe('');
    expect(run('## review\n   \n', 'review')).toBe('');
  });

  test('every agent stage prompt includes its input', () => {
    for (const stage of ['spec', 'plan', 'red-tests', 'implement', 'review']) {
      expect(sdlc).toContain(`$(manual_input ${stage})`);
    }
  });
});
