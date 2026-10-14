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
  test('an unknown FROM exits 1 with the message and creates nothing; every valid FROM is accepted; bash -n passes', () => {
    // one directory for every value: a rejected value leaves it as it was, and an accepted one stops at the missing brief
    const dir = tmpRepo();
    const run = from => spawnSync('bash', ['scripts/sdlc.sh', 'alpha'], { cwd: dir, env: { ...process.env, FROM: from }, encoding: 'utf8' });

    const r = run('bogus');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('ERROR: unknown FROM=bogus (use spec, plan, red-tests, implement, review or test-repair)');
    expect(fs.readdirSync(dir).sort()).toEqual(['.git', 'scripts']);

    for (const from of ['spec', 'plan', 'red-tests', 'implement', 'test-repair', 'review']) {
      const ok = run(from);
      expect([from, ok.stdout.includes('unknown FROM')]).toEqual([from, false]);
      expect(ok.stdout).toContain('Missing Docs/backlog/alpha/brief.md');
    }

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

  test('prints only the requested stage section as binding input, nothing when it is missing, and every agent stage prompt includes it', () => {
    const out = run('## plan\nUse a queue.\n\n## implement\nKeep it small.\nNo new deps.\n', 'implement');
    expect(out).toContain('MANUAL INPUT');
    expect(out).toContain('Keep it small.\nNo new deps.');
    expect(out).not.toContain('Use a queue.');

    // the file, the section or its text is missing
    expect(run(null, 'plan')).toBe('');
    expect(run('## plan\nx\n', 'review')).toBe('');
    expect(run('## review\n   \n', 'review')).toBe('');

    // agent() appends the manual input for every stage except the test-repair/test-audit ones.
    expect(sdlc).toContain('prompt="$prompt$(manual_input "$pstage")"');
    expect(sdlc).toMatch(/case "\$pstage" in test-repair\|test-audit\) ;;/);
    for (const stage of ['spec', 'plan', 'red-tests', 'implement', 'review']) {
      expect(sdlc).toMatch(new RegExp(`^\\s*agent \\S+ ${stage}$`, 'm'));
    }
  });
});
