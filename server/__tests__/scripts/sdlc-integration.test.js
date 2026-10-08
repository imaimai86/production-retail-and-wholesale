const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../../..');
const script = path.join(repoRoot, 'scripts/sdlc-integration.sh');
const PASSWORD = 'deadbeefcafe1234';
const PORT = '54321';
const TOOLS = ['sed', 'head', 'tr', 'cat', 'rm', 'env', 'dirname', 'basename', 'grep'];

let tmp;
let calls;

function writeShim(dir, name, body) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(file, 0o755);
}

function which(tool) {
  return execFileSync('/bin/sh', ['-c', `command -v ${tool}`]).toString().trim();
}

function setup({ withDocker = true } = {}) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-int-'));
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(tmp, 'server'));
  fs.writeFileSync(
    path.join(tmp, 'server/package.json'),
    JSON.stringify({ scripts: { 'test:integration': 'jest' } })
  );
  calls = path.join(tmp, 'calls.log');
  fs.writeFileSync(calls, '');
  TOOLS.forEach(t => {
    try {
      fs.symlinkSync(which(t), path.join(bin, t));
    } catch (e) {
      // tool absent on this system
    }
  });
  const rec = n => `echo "${n} $*" >> "${calls}"`;
  writeShim(bin, 'sleep', rec('sleep'));
  writeShim(bin, 'openssl', `${rec('openssl')}\necho ${PASSWORD}`);
  writeShim(bin, 'node', `${rec('node')}\nexit \${SHIM_NODE_RC:-0}`);
  writeShim(
    bin,
    'npm',
    `${rec('npm')}\necho "NPM_DATABASE_URL=$DATABASE_URL" >> "${calls}"\nexit \${SHIM_NPM_RC:-0}`
  );
  if (withDocker) {
    writeShim(
      bin,
      'docker',
      `${rec('docker')}
case "$1" in
  port) echo "5432/tcp -> 127.0.0.1:${PORT}" ;;
  exec) exit \${SHIM_EXEC_RC:-0} ;;
esac
exit 0`
    );
  }
  return bin;
}

function run(env = {}, opts = {}) {
  const bin = setup(opts);
  const res = spawnSync('/bin/bash', [script], {
    cwd: tmp,
    env: { PATH: bin, ...env },
    encoding: 'utf8'
  });
  return { ...res, out: `${res.stdout}${res.stderr}`, log: fs.readFileSync(calls, 'utf8') };
}

afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe('scripts/sdlc-integration.sh', () => {
  test('1. CI set: warns TEMPORARY, exits 0, calls no command', () => {
    const r = run({ CI: 'true' });
    expect(r.status).toBe(0);
    expect(r.out).toContain('TEMPORARY');
    expect(r.out).toContain('SDLC_INTEGRATION_CI=run');
    expect(r.log).toBe('');
  });

  test('1b. SDLC_INTEGRATION_CI must be exactly "run" to enable', () => {
    const r = run({ CI: '1', SDLC_INTEGRATION_CI: 'RUN', DATABASE_URL: 'postgres://x' });
    expect(r.status).toBe(0);
    expect(r.out).toContain('TEMPORARY');
    expect(r.log).toBe('');
  });

  test('1c. empty CI is not treated as CI', () => {
    const r = run({ CI: '', DATABASE_URL: 'postgres://u:p@h:1/d' });
    expect(r.log).toContain('npm run test:integration');
  });

  test('2. CI + SDLC_INTEGRATION_CI=run + DATABASE_URL runs suite without docker', () => {
    const r = run({ CI: 'true', SDLC_INTEGRATION_CI: 'run', DATABASE_URL: 'postgres://u:p@h:1/d' });
    expect(r.status).toBe(0);
    expect(r.log).toContain('npm run test:integration');
    expect(r.log).not.toMatch(/^docker /m);
    expect(r.out).not.toContain('TEMPORARY');
  });

  test('3. SDLC_INTEGRATION=off is inert', () => {
    const r = run({ SDLC_INTEGRATION: 'off', DATABASE_URL: 'postgres://u:p@h:1/d' });
    expect(r.status).toBe(0);
    expect(r.log).toContain('npm run test:integration');
  });

  test('4. missing test:integration script exits 3 with message', () => {
    const r = run({ SHIM_NODE_RC: '1', DATABASE_URL: 'postgres://u:p@h:1/d' });
    expect(r.status).toBe(3);
    expect(r.out).toContain('no test:integration script');
    expect(r.log).not.toContain('npm ');
  });

  test('5. DATABASE_URL is passed to npm and docker is never called', () => {
    const url = 'postgres://u:p@h:1/d';
    const r = run({ DATABASE_URL: url });
    expect(r.status).toBe(0);
    expect(r.log).toContain('npm run test:integration');
    expect(r.log).toContain(`NPM_DATABASE_URL=${url}`);
    expect(r.log).not.toMatch(/^docker /m);
  });

  test('6. no DATABASE_URL: throwaway docker database, cleaned up', () => {
    const r = run({});
    expect(r.status).toBe(0);
    expect(r.log).toMatch(/^docker run .*postgres:16/m);
    expect(r.log).toContain('127.0.0.1::5432');
    expect(r.log).toMatch(/--name prw-sdlc-db-\d+/);
    expect(r.log).toContain('pg_isready -h 127.0.0.1');
    expect(r.log).toMatch(new RegExp(`NPM_DATABASE_URL=postgres://app:.+@127\\.0\\.0\\.1:${PORT}/app`));
    expect(r.log).toContain('npm run test:integration');
    const lines = r.log.split('\n');
    const npmAt = lines.findIndex(l => l.startsWith('npm '));
    const rmAt = lines.findIndex(l => l.startsWith('docker rm -f'));
    expect(rmAt).toBeGreaterThan(npmAt);
  });

  test('6b. npm failure propagates its exit code and container is still removed', () => {
    const r = run({ SHIM_NPM_RC: '1' });
    expect(r.status).toBe(1);
    expect(r.log).toMatch(/^docker rm -f prw-sdlc-db-\d+/m);
  });

  test('6c. npm exit code other than 1 is propagated', () => {
    const r = run({ SHIM_NPM_RC: '7' });
    expect(r.status).toBe(7);
    expect(r.log).toMatch(/^docker rm -f/m);
  });

  test('6d. container never ready: 60 attempts, exit 3, container removed', () => {
    const r = run({ SHIM_EXEC_RC: '1' });
    expect(r.status).toBe(3);
    expect(r.log.split('\n').filter(l => l.startsWith('docker exec')).length).toBe(60);
    expect(r.log).not.toContain('npm ');
    expect(r.log).toMatch(/^docker rm -f/m);
  });

  test('7. neither DATABASE_URL nor docker exits 3 with message', () => {
    const r = run({}, { withDocker: false });
    expect(r.status).toBe(3);
    expect(r.out).toContain('DATABASE_URL or docker');
    expect(r.log).not.toContain('npm ');
  });

  test('8. generated password never appears in output', () => {
    [{}, { SHIM_NPM_RC: '1' }, { SHIM_EXEC_RC: '1' }].forEach(env => {
      const r = run(env);
      expect(r.out).not.toContain(PASSWORD);
      expect(r.out).not.toContain('postgres://app:');
    });
  });

  test('8b. provided DATABASE_URL is never printed', () => {
    const r = run({ DATABASE_URL: 'postgres://user:s3cretpw@h:1/d', SHIM_NPM_RC: '1' });
    expect(r.out).not.toContain('s3cretpw');
  });
});
