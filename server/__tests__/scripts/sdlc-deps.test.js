const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const sdlc = fs.readFileSync(path.join(root, 'scripts/sdlc.sh'), 'utf8');
const fn = sdlc.slice(sdlc.indexOf('install_deps() {'), sdlc.indexOf('tests_pass() {'));

// Runs install_deps in a temp dir with a fake npm that records its arguments; returns the result, the npm calls and the dir.
function run(plan, { link = false, env = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-deps-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.mkdirSync(path.join(dir, 'server'));
  fs.writeFileSync(path.join(bin, 'npm'), `#!/bin/sh\necho "$*" >> "${dir}/npm.calls"\n`, { mode: 0o755 });
  if (plan !== null) fs.writeFileSync(path.join(dir, 'docs/plan-1.md'), plan);
  if (link) {
    fs.mkdirSync(path.join(dir, 'shared'));
    fs.symlinkSync(path.join(dir, 'shared'), path.join(dir, 'server/node_modules'));
  }
  const script = `set -euo pipefail; DOCS=docs; LOG=docs\n${fn}\ninstall_deps`;
  const r = spawnSync('bash', ['-c', script], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env, PATH: `${bin}:${process.env.PATH}` } });
  const callsFile = path.join(dir, 'npm.calls');
  const calls = fs.existsSync(callsFile) ? fs.readFileSync(callsFile, 'utf8').trim().split('\n') : [];
  return { r, calls, dir };
}

const PLAN = '# Plan\n\n## Dependencies\n- runtime: `pino@10.3.1`\n- runtime: @google-cloud/pino-logging-gcp-config@1.3.6 (structured logging)\n- dev: pino-pretty@13.1.1\n\n## Steps\n- runtime: not-a-dep@1.0.0\n';

describe('install_deps in scripts/sdlc.sh', () => {
  test('installs the exact runtime and dev versions from the Dependencies section only, without install scripts', () => {
    const { r, calls } = run(PLAN);
    expect(r.status).toBe(0);
    expect(calls).toEqual([
      '--prefix server --save-exact --no-audit --no-fund --ignore-scripts pino@10.3.1 @google-cloud/pino-logging-gcp-config@1.3.6',
      '--prefix server --save-exact --no-audit --no-fund --ignore-scripts -D pino-pretty@13.1.1',
    ].map(a => `install ${a}`));
  });

  test('SDLC_DEP_SCRIPTS=run allows install scripts', () => {
    const { calls } = run('## Dependencies\n- dev: jest-junit@16.0.0\n', { env: { SDLC_DEP_SCRIPTS: 'run' } });
    expect(calls).toEqual(['install --prefix server --save-exact --no-audit --no-fund -D jest-junit@16.0.0']);
  });

  test('does nothing without a plan, without the section, or with "- none"', () => {
    for (const plan of [null, '# Plan\n## Steps\n- x\n', '## Dependencies\n- none\n']) {
      const { r, calls } = run(plan, { link: true });
      expect(r.status).toBe(0);
      expect(calls).toEqual([]);
    }
  });

  test('rejects a range or a missing version and installs nothing', () => {
    const { r, calls } = run('## Dependencies\n- runtime: pino@^10.3.1\n- dev: pino-pretty\n- runtime: ok@1.0.0\n');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("dependency 'pino@^10.3.1' in docs/plan-1.md must be name@<exact version>");
    expect(r.stdout).toContain("dependency 'pino-pretty' in docs/plan-1.md must be name@<exact version>");
    expect(calls).toEqual([]);
  });

  test('a worktree link to the shared server/node_modules is replaced by its own npm ci before installing', () => {
    const { r, calls, dir } = run('## Dependencies\n- runtime: pino@10.3.1\n', { link: true });
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(dir, 'server/node_modules'))).toBe(false); // the fake npm ci creates nothing
    expect(fs.existsSync(path.join(dir, 'shared'))).toBe(true);
    expect(calls).toEqual([
      'ci --prefix server --no-audit --no-fund',
      'install --prefix server --save-exact --no-audit --no-fund --ignore-scripts pino@10.3.1',
    ]);
  });

  test('Implement installs the dependencies before its first attempt, and only Plan gets the web and context7 tools', () => {
    const impl = sdlc.slice(sdlc.indexOf('stage "4/6 Implement'), sdlc.indexOf('agent "impl-$i" implement'));
    expect(impl).toContain('\ninstall_deps\n');
    expect(sdlc.match(/^install_deps$/gm)).toHaveLength(1);
    expect(sdlc).toContain('PLAN_TOOLS=(WebFetch WebSearch mcp__context7)');
    expect(sdlc).toContain('[ "$pstage" != plan ] || allowed+=("${PLAN_TOOLS[@]}")');
    const allowed = sdlc.slice(sdlc.indexOf('ALLOWED=('), sdlc.indexOf('PLAN_TOOLS='));
    expect(allowed).not.toMatch(/WebFetch|npm install/);
  });
});
