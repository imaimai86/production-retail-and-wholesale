const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../../..');
const wrapper = path.join(repoRoot, 'scripts/sdlc-mod.sh');

const GIT_ENV = {
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

// A stub pipeline: records where and how it ran, then sleeps if the slug asks for it.
const STUB = `#!/usr/bin/env bash
slug="$1"
echo "cwd=$(pwd -P) slug=$slug sdlc_slug=\${SDLC_SLUG:-} plugins=\${CLAUDE_CODE_PLUGIN_DIRS:-} from=\${FROM:-}" >> "$(pwd -P)/ran.txt"
case "$slug" in
  slow*) sleep 30 & echo $! > "$(pwd -P)/sleep.pid"; wait $! ;;
  fail*) exit 1 ;;
esac
exit 0
`;

let tmp;
let repo;
let wts;
let live = [];

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function mkRepo() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-mod-'));
  repo = path.join(tmp, 'repo');
  wts = path.join(tmp, 'wts');
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'server/node_modules'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'graft'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'scripts/sdlc.sh'), STUB, { mode: 0o755 });
  fs.copyFileSync(wrapper, path.join(repo, 'scripts/sdlc-mod.sh'));
  for (const slug of ['alpha', 'slow-one', 'slow-two', 'fail-one']) {
    fs.mkdirSync(path.join(repo, 'Docs/backlog', slug), { recursive: true });
    fs.writeFileSync(path.join(repo, 'Docs/backlog', slug, 'brief.md'), `# ${slug}\n`);
  }
  fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\n/graft/\nran.txt\nDocs/backlog/*/logs/\n');
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
}

const env = extra => ({
  ...process.env, ...GIT_ENV, SDLC_WT_BASE: wts, SDLC_PLUGIN_DIRS: '', ...extra,
});

function mod(args, extra = {}) {
  return spawnSync('bash', [path.join(repo, 'scripts/sdlc-mod.sh'), ...args], { cwd: repo, encoding: 'utf8', env: env(extra) });
}

function modAsync(args, extra = {}) {
  const child = spawn('bash', [path.join(repo, 'scripts/sdlc-mod.sh'), ...args], { cwd: repo, env: env(extra), stdio: 'ignore' });
  live.push(child);
  return child;
}

const registry = slug => JSON.parse(fs.readFileSync(path.join(repo, '.git/sdlc-runs', `${slug}.json`), 'utf8'));

async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = fn(); if (v) return v; } catch (e) { /* not yet */ }
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise(r => setTimeout(r, 100));
  }
}

const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return false; } };

beforeEach(mkRepo);
afterEach(() => {
  for (const c of live) { try { process.kill(c.pid, 'SIGKILL'); } catch (e) { /* gone */ } }
  live = [];
  spawnSync('pkill', ['-f', `${tmp}`]);
  for (const slug of fs.existsSync(wts) ? fs.readdirSync(wts) : []) {
    try { process.kill(Number(fs.readFileSync(path.join(wts, slug, 'sleep.pid'), 'utf8')), 'SIGKILL'); } catch (e) { /* gone */ }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('sdlc-mod.sh run', () => {
  test('runs sdlc.sh for the slug in its own worktree on branch sdlc/<slug>', () => {
    const r = mod(['run', 'alpha']);
    expect(r.status).toBe(0);
    const wt = path.join(fs.realpathSync(wts), 'alpha');
    expect(git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('sdlc/alpha');
    const ran = fs.readFileSync(path.join(wt, 'ran.txt'), 'utf8');
    expect(ran).toContain(`cwd=${wt} slug=alpha sdlc_slug=alpha`);
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
  });

  test('records the run outside the worktree: exited, exit code 0', () => {
    mod(['run', 'alpha']);
    expect(registry('alpha')).toMatchObject({ slug: 'alpha', state: 'exited', exit_code: '0', interrupted: false });
  });

  test('records a failing pipeline exit code', () => {
    expect(mod(['run', 'fail-one']).status).toBe(1);
    expect(registry('fail-one')).toMatchObject({ state: 'exited', exit_code: '1', interrupted: false });
  });

  test('shares node_modules with the main working tree', () => {
    mod(['run', 'alpha']);
    const link = path.join(wts, 'alpha/server/node_modules');
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  });

  test('the links are never untracked: git status in the worktree is clean of them', () => {
    mod(['run', 'alpha']);
    const wt = path.join(wts, 'alpha');
    expect(fs.lstatSync(path.join(wt, 'graft')).isSymbolicLink()).toBe(true);
    expect(git(wt, 'status', '--porcelain', '--untracked-files=all')).toBe('');
    // and a stage that adds everything under server/ cannot sweep the link into a commit
    git(wt, 'add', 'server');
    expect(git(wt, 'diff', '--cached', '--name-only')).toBe('');
  });

  test('passes the plugin folders and FROM through to the pipeline', () => {
    mod(['run', 'alpha'], { SDLC_PLUGIN_DIRS: '/x/guard', FROM: 'implement' });
    const ran = fs.readFileSync(path.join(wts, 'alpha/ran.txt'), 'utf8');
    expect(ran).toContain('plugins=/x/guard');
    expect(ran).toContain('from=implement');
  });

  test('copies a brief that is not committed on the base branch yet', () => {
    fs.mkdirSync(path.join(repo, 'Docs/backlog/fresh'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'Docs/backlog/fresh/brief.md'), '# fresh\n');
    expect(mod(['run', 'fresh']).status).toBe(0);
    expect(fs.existsSync(path.join(wts, 'fresh/Docs/backlog/fresh/brief.md'))).toBe(true);
  });

  test('reuses an existing worktree and branch on a second run', () => {
    mod(['run', 'alpha']);
    expect(mod(['run', 'alpha']).status).toBe(0);
    expect(fs.readFileSync(path.join(wts, 'alpha/ran.txt'), 'utf8').trim().split('\n')).toHaveLength(2);
  });

  test('rejects a bad slug (exit 2) and a missing brief (exit 1)', () => {
    expect(mod(['run', '../etc']).status).toBe(2);
    expect(mod(['run', 'Bad Slug']).status).toBe(2);
    expect(mod(['run', 'nope']).status).toBe(1);
  });

  test('a missing brief creates no worktree and no branch', () => {
    expect(mod(['run', 'nope']).status).toBe(1);
    expect(fs.existsSync(path.join(wts, 'nope'))).toBe(false);
    expect(git(repo, 'branch', '--list', 'sdlc/nope')).toBe('');
  });

  test('refuses an item that is already merged into the base branch (exit 5), and records why', () => {
    git(repo, 'commit', '--allow-empty', '-q', '-m', 'test(alpha): add failing tests and spec/plan docs');
    const r = mod(['run', 'alpha']);
    expect(r.status).toBe(5);
    expect(fs.existsSync(path.join(wts, 'alpha'))).toBe(false);
    expect(git(repo, 'branch', '--list', 'sdlc/alpha')).toBe('');
    expect(registry('alpha')).toMatchObject({ state: 'exited', exit_code: '5', interrupted: false });
    expect(registry('alpha').message).toMatch(/alpha is already merged into main/);
  });

  test('SDLC_ALLOW_MERGED runs an already merged item anyway', () => {
    git(repo, 'commit', '--allow-empty', '-q', '-m', 'test(alpha): add failing tests and spec/plan docs');
    expect(mod(['run', 'alpha'], { SDLC_ALLOW_MERGED: '1' }).status).toBe(0);
  });

  test('an item whose slug is only a prefix of a merged one is not refused', () => {
    git(repo, 'commit', '--allow-empty', '-q', '-m', 'test(alpha-two): add failing tests and spec/plan docs');
    expect(mod(['run', 'alpha']).status).toBe(0);
  });

  test('a refused start for a missing brief is recorded with its reason', () => {
    expect(mod(['run', 'nope']).status).toBe(1);
    expect(registry('nope')).toMatchObject({ state: 'exited', exit_code: '1' });
    expect(registry('nope').message).toBe('Missing Docs/backlog/nope/brief.md');
  });

  test('refuses to start more than SDLC_MAX_PARALLEL pipelines (exit 3)', async () => {
    modAsync(['run', 'slow-one'], { SDLC_MAX_PARALLEL: '1' });
    await until(() => registry('slow-one').state === 'running' && fs.existsSync(path.join(wts, 'slow-one/ran.txt')));
    const r = mod(['run', 'slow-two'], { SDLC_MAX_PARALLEL: '1' });
    expect(r.status).toBe(3);
    expect(registry('slow-two').message).toMatch(/at most 1 pipelines may run at once/);
    expect(registry('slow-one').state).toBe('running');
  });

  test('two pipelines run at once when the cap allows it', async () => {
    modAsync(['run', 'slow-one'], { SDLC_MAX_PARALLEL: '2' });
    modAsync(['run', 'slow-two'], { SDLC_MAX_PARALLEL: '2' });
    await until(() => registry('slow-one').state === 'running' && registry('slow-two').state === 'running');
    await until(() => fs.existsSync(path.join(wts, 'slow-one/ran.txt')) && fs.existsSync(path.join(wts, 'slow-two/ran.txt')));
    expect(registry('slow-one').worktree).not.toBe(registry('slow-two').worktree);
  });

  test('refuses to start a slug that is already running (exit 4)', async () => {
    modAsync(['run', 'slow-one']);
    await until(() => registry('slow-one').state === 'running');
    expect(mod(['run', 'slow-one']).status).toBe(4);
    expect(registry('slow-one').state).toBe('running');
  });
});

describe('sdlc-mod.sh stop and status', () => {
  test('stop interrupts a running pipeline and everything it started', async () => {
    modAsync(['run', 'slow-one']);
    const sleepFile = path.join(wts, 'slow-one/sleep.pid');
    await until(() => fs.existsSync(sleepFile) && fs.readFileSync(sleepFile, 'utf8').trim());
    const sleepPid = Number(fs.readFileSync(sleepFile, 'utf8'));
    const pid = registry('slow-one').pid;
    expect(alive(pid)).toBe(true);
    expect(alive(sleepPid)).toBe(true);
    expect(mod(['stop', 'slow-one']).status).toBe(0);
    await until(() => registry('slow-one').state === 'exited');
    expect(registry('slow-one').interrupted).toBe(true);
    expect(alive(pid)).toBe(false);
    await until(() => !alive(sleepPid));
  });

  test('stop on a finished run is a no-op, on an unknown slug an error', () => {
    mod(['run', 'alpha']);
    expect(mod(['stop', 'alpha']).status).toBe(0);
    expect(mod(['stop', 'ghost']).status).toBe(1);
  });

  test('status lists each run with its state', async () => {
    mod(['run', 'alpha']);
    modAsync(['run', 'slow-one']);
    await until(() => registry('slow-one').state === 'running');
    const out = mod(['status']).stdout;
    expect(out).toMatch(/exited\s+alpha/);
    expect(out).toMatch(/running\s+slow-one/);
    mod(['stop', 'slow-one']);
    await until(() => registry('slow-one').state === 'exited');
    expect(mod(['status']).stdout).toMatch(/interrupted\s+slow-one/);
  });

  test('prints usage with no arguments (exit 2)', () => {
    expect(mod([]).status).toBe(2);
  });
});
