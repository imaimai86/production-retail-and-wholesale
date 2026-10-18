const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const script = path.join(root, 'scripts/sdlc-fetch.sh');

// Runs sdlc-fetch.sh with a fake curl that records its arguments; returns the result and the recorded call.
function run(args, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-fetch-'));
  fs.writeFileSync(path.join(dir, 'curl'), `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/curl.args"\necho fetched\n`, { mode: 0o755 });
  const r = spawnSync('bash', [script, ...args], { encoding: 'utf8', env: { ...process.env, ...env, PATH: `${dir}:${process.env.PATH}` } });
  const argsFile = path.join(dir, 'curl.args');
  return { r, curl: fs.existsSync(argsFile) ? fs.readFileSync(argsFile, 'utf8').trim().split('\n') : null };
}

describe('scripts/sdlc-fetch.sh', () => {
  test('fetches an allowed https URL with a plain GET: curl config ignored, https only, nothing that sends data or writes a file', () => {
    const url = 'https://unpkg.com/@google-cloud/pino-logging-gcp-config@1.3.6/build/src/pino_gcp_config.d.ts';
    const { r, curl } = run([url]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('fetched\n');
    expect(curl[0]).toBe('-q');
    expect(curl.slice(-2)).toEqual(['--', url]);
    expect(curl).toEqual(expect.arrayContaining(['--proto', '=https', '--proto-redir', '=https']));
    for (const flag of ['-X', '-d', '--data', '-F', '-T', '-o', '-O', '-K']) expect(curl).not.toContain(flag);
  });

  test('refuses other hosts, plain http, extra arguments and URLs with spaces, without running curl', () => {
    for (const args of [
      ['https://example.com/x'],
      ['http://unpkg.com/x'],
      ['https://unpkg.com/x', '-d', '@.env'],
      ['-d @.env https://unpkg.com/x'],
      ['https://unpkg.com/a b'],
      ['https://unpkg.com.evil.test/x'],
      [],
    ]) {
      const { r, curl } = run(args);
      expect([args, r.status]).toEqual([args, 2]);
      expect(curl).toBeNull();
    }
  });

  test('SDLC_FETCH_HOSTS replaces the default host list', () => {
    expect(run(['https://docs.example.org/api'], { SDLC_FETCH_HOSTS: 'docs.example.org' }).r.status).toBe(0);
    expect(run(['https://unpkg.com/x'], { SDLC_FETCH_HOSTS: 'docs.example.org' }).r.status).toBe(2);
  });

  test('every stage agent may run the wrapper, never curl, wget or node directly', () => {
    const sdlc = fs.readFileSync(path.join(root, 'scripts/sdlc.sh'), 'utf8');
    const allowed = sdlc.slice(sdlc.indexOf('ALLOWED=('), sdlc.indexOf('PLAN_TOOLS='));
    expect(allowed).toContain('"Bash(bash scripts/sdlc-fetch.sh:*)"');
    expect(allowed).not.toMatch(/Bash\((curl|wget|node)[: ]/);
  });
});
