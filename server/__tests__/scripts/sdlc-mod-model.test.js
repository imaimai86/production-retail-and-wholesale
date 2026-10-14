const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../../..');
const wrapper = path.join(repoRoot, 'scripts/sdlc-mod.sh');

// The wrapper only forwards, so a stub helper in a copy of the repo records what it was given.
const STUB_HELPER = `#!/usr/bin/env node
process.stdout.write(JSON.stringify(process.argv.slice(2)) + '\\n');
process.stderr.write('stub-stderr\\n');
process.exitCode = Number(process.env.STUB_EXIT || 0);
`;

let repo;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-mod-model-'));
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.copyFileSync(wrapper, path.join(repo, 'scripts/sdlc-mod.sh'));
  fs.writeFileSync(path.join(repo, 'scripts/sdlc-models.cjs'), STUB_HELPER);
});

const mod = (args, extra = {}) => spawnSync('bash', [path.join(repo, 'scripts/sdlc-mod.sh'), ...args], {
  cwd: repo, encoding: 'utf8', env: { ...process.env, ...extra },
});

describe('sdlc-mod.sh model', () => {
  test('AC46 every subcommand passes its arguments unchanged and returns the helper exit code', () => {
    const cases = [
      ['list'],
      ['list', '--json'],
      ['add', 'gw', '--endpoint', 'https://gw.example', '--key-env', 'K', '--models', 'a,b', '--effort'],
      ['add-model', 'gw', 'm 1'],
      ['remove-model', 'gw', 'm1'],
      ['remove', 'gw'],
      ['test', 'gw/openai/gpt-5'],
    ];
    for (const args of cases) {
      for (const code of [0, 1]) {
        const r = mod(['model', ...args], { STUB_EXIT: String(code) });
        expect([args, r.status, JSON.parse(r.stdout)]).toEqual([args, code, args]);
        expect(r.stderr).toContain('stub-stderr');
      }
    }
  });

  test('AC47 the usage text lists model, and an unknown or missing subcommand prints usage (exit 2) without running the helper', () => {
    const none = mod([]);
    expect(none.status).toBe(2);
    expect(none.stderr).toMatch(/model/);

    for (const args of [['model'], ['model', 'path'], ['model', 'get', 'gw'], ['model', 'bogus']]) {
      const r = mod(args);
      expect([args, r.status, r.stdout]).toEqual([args, 2, '']);
      expect(r.stderr).toMatch(/Usage:/);
    }

    // list --json reaches the real helper
    fs.copyFileSync(path.join(repoRoot, 'scripts/sdlc-models.cjs'), path.join(repo, 'scripts/sdlc-models.cjs'));
    const r = mod(['model', 'list', '--json'], { SDLC_MODELS_FILE: path.join(repo, 'none.json') });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('{"providers":{}}');
  });
});
