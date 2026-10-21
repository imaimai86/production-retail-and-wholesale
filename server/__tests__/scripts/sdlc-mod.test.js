// scripts/sdlc-mod.sh is now a thin wrapper over the ai-sdlc-helper command, kept for the sdlc-monitor pane. These tests
// run the wrapper with a stand-in for ai-sdlc-helper (AI_SDLC_HELPER) that prints the folder it ran in and its arguments.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const WRAPPER = path.join(ROOT, 'scripts', 'sdlc-mod.sh');

let dir;
let fake;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-mod-'));
  fake = path.join(dir, 'fake-helper');
  fs.writeFileSync(fake, '#!/bin/sh\necho "cwd=$(pwd -P)"\necho "args=$*"\n');
  fs.chmodSync(fake, 0o755);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function run(args, env = {}, cwd = dir) {
  const base = { ...process.env, AI_SDLC_HELPER: fake };
  delete base.FROM;
  delete base.WATCH_INTERVAL;
  const r = spawnSync('bash', [WRAPPER, ...args], { cwd, env: { ...base, ...env }, encoding: 'utf8' });
  const line = k => (r.stdout.split('\n').find(l => l.startsWith(`${k}=`)) || '').slice(k.length + 1);

  return { status: r.status, stdout: r.stdout, stderr: r.stderr, cwd: line('cwd'), args: line('args') };
}

describe('scripts/sdlc-mod.sh maps the old subcommands to ai-sdlc-helper', () => {
  test.each([
    [['run', 'demo'], {}, 'start demo'],
    [['run', 'demo'], { FROM: 'implement' }, 'start demo --from implement'],
    [['stop', 'demo'], {}, 'stop demo'],
    [['restart', 'demo', '--yes'], { FROM: 'plan' }, 'restart demo --yes --from plan'],
    [['restart', 'demo'], {}, 'restart demo'],
    [['discard', 'demo', '--yes', '--stop'], {}, 'discard demo --yes --stop'],
    [['status'], {}, 'status'],
    [['changes', '--all', 'a', 'b'], {}, 'changes --all a b'],
    [['changes', 'demo', '--json'], {}, 'changes demo --json'],
    [['permit', 'demo', 'allow'], {}, 'permit demo allow all'],
    [['permit', 'demo', 'deny', '0'], {}, 'permit demo deny 0'],
    [['model', 'list', '--json'], {}, 'model list --json'],
    [['model', 'add', 'p', '--endpoint', 'http://x', '--key-env', 'K', '--models', 'a,b'], {}, 'model add p --endpoint http://x --key-env K --models a,b'],
    [['backlog', 'pending', '--json'], {}, 'backlog pending --json'],
  ])('%j with %j runs "%s" in the repository root', (args, env, expected) => {
    const r = run(args, env);
    expect(r.status).toBe(0);
    expect(r.args).toBe(expected);
    expect(r.cwd).toBe(fs.realpathSync(ROOT));
  });

  test('watch follows by default (WATCH_INTERVAL seconds), --once prints one frame, both in the current folder', () => {
    expect(run(['watch', 'demo']).args).toBe('watch demo --follow 3');
    expect(run(['watch', 'demo'], { WATCH_INTERVAL: '5' }).args).toBe('watch demo --follow 5');
    const once = run(['watch', 'demo', '--once']);
    expect(once.args).toBe('watch demo');
    expect(once.cwd).toBe(fs.realpathSync(dir));
  });

  test('a wrong call prints the usage and exits 2 without running ai-sdlc-helper', () => {
    for (const args of [[], ['run'], ['bogus', 'x'], ['permit', 'demo'], ['watch', 'demo', '--follow']]) {
      const r = run(args);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/^Usage: /);
      expect(r.args).toBe('');
    }
  });

  test('without ai-sdlc-helper on PATH it says how to install it and exits 127', () => {
    const r = run(['status'], { AI_SDLC_HELPER: 'ai-sdlc-helper-not-installed-here' });
    expect(r.status).toBe(127);
    expect(r.stderr).toMatch(/ai-sdlc-helper is not on PATH/);
    expect(r.stderr).toMatch(/npm pack github:imaimai86\/ai-sdlc-helper/);
  });
});
