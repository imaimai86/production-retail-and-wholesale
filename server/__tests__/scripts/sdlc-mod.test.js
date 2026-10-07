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

// process.kill(pid, 0) also succeeds on a zombie (exited, not yet collected by its parent): that is not alive.
const alive = pid => {
  try { process.kill(pid, 0); } catch (e) { return false; }

  return !spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim().startsWith('Z');
};

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

describe('sdlc-mod.sh discard and restart', () => {
  // A finished run with a commit and an uncommitted file on its branch: work that a discard would lose.
  function finishedRunWithWork(slug = 'alpha') {
    expect(mod(['run', slug]).status).toBe(0);
    const wt = path.join(fs.realpathSync(wts), slug);
    fs.writeFileSync(path.join(wt, 'stray.txt'), 'work\n');
    git(wt, 'add', 'stray.txt');
    git(wt, 'commit', '-q', '-m', 'stray work');
    fs.writeFileSync(path.join(wt, 'uncommitted.txt'), 'wip\n');

    return { wt, tip: git(repo, 'rev-parse', `sdlc/${slug}`) };
  }

  test('discard without --yes shows what would go, deletes nothing, exits 6', () => {
    const { wt } = finishedRunWithWork();
    const r = mod(['discard', 'alpha']);
    expect(r.status).toBe(6);
    expect(r.stdout).toMatch(/1 commit\(s\) not in main, 1 uncommitted file\(s\)/);
    expect(fs.existsSync(wt)).toBe(true);
    expect(git(repo, 'branch', '--list', 'sdlc/alpha')).not.toBe('');
    expect(registry('alpha').state).toBe('exited');
  });

  test('discard --yes deletes the worktree, the branch and the run record, and saves the branch tip', () => {
    const { wt, tip } = finishedRunWithWork();
    const r = mod(['discard', 'alpha', '--yes']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`git branch sdlc/alpha ${tip}`);
    expect(fs.existsSync(wt)).toBe(false);
    expect(git(repo, 'branch', '--list', 'sdlc/alpha')).toBe('');
    expect(fs.existsSync(path.join(repo, '.git/sdlc-runs/alpha.json'))).toBe(false);
    expect(fs.readFileSync(path.join(repo, '.git/sdlc-runs/alpha.discarded'), 'utf8').trim()).toBe(`git branch sdlc/alpha ${tip}`);
    expect(git(repo, 'worktree', 'list').split('\n')).toHaveLength(1);
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  test('the saved branch tip really brings the work back', () => {
    const { tip } = finishedRunWithWork();
    mod(['discard', 'alpha', '--yes']);
    git(repo, 'branch', 'sdlc/alpha', tip);
    expect(git(repo, 'log', '-1', '--format=%s', 'sdlc/alpha')).toBe('stray work');
  });

  test('discard still works when the worktree folder was already deleted by hand', () => {
    const { wt } = finishedRunWithWork();
    fs.rmSync(wt, { recursive: true, force: true });
    expect(mod(['discard', 'alpha', '--yes']).status).toBe(0);
    expect(git(repo, 'branch', '--list', 'sdlc/alpha')).toBe('');
    expect(git(repo, 'worktree', 'list').split('\n')).toHaveLength(1);
  });

  test('discard refuses a running pipeline (exit 4) and an unknown slug (exit 1)', async () => {
    modAsync(['run', 'slow-one']);
    await until(() => registry('slow-one').state === 'running');
    expect(mod(['discard', 'slow-one', '--yes']).status).toBe(4);
    expect(registry('slow-one').state).toBe('running');
    expect(mod(['discard', 'ghost', '--yes']).status).toBe(1);
  });

  test('discard --yes --stop stops a running pipeline and everything it started, then deletes it', async () => {
    modAsync(['run', 'slow-one']);
    const sleepFile = path.join(wts, 'slow-one/sleep.pid');
    await until(() => registry('slow-one').state === 'running' && fs.existsSync(sleepFile) && fs.readFileSync(sleepFile, 'utf8').trim());
    const pid = registry('slow-one').pid;
    const sleepPid = Number(fs.readFileSync(sleepFile, 'utf8'));
    const r = mod(['discard', 'slow-one', '--yes', '--stop']);
    expect(r.status).toBe(0);
    expect(alive(pid)).toBe(false);
    await until(() => !alive(sleepPid));
    expect(fs.existsSync(path.join(wts, 'slow-one'))).toBe(false);
    expect(git(repo, 'branch', '--list', 'sdlc/slow-one')).toBe('');
    expect(fs.existsSync(path.join(repo, '.git/sdlc-runs/slow-one.json'))).toBe(false);
  });

  test('discard --stop without --yes stops nothing and deletes nothing (exit 6)', async () => {
    modAsync(['run', 'slow-one']);
    await until(() => registry('slow-one').state === 'running');
    expect(mod(['discard', 'slow-one', '--stop']).status).toBe(6);
    expect(alive(registry('slow-one').pid)).toBe(true);
    expect(registry('slow-one').state).toBe('running');
  });

  test('discard rejects an unknown flag (exit 2)', () => {
    expect(mod(['discard', 'alpha', '--nope']).status).toBe(2);
  });

  test('restart without --yes shows what would go and changes nothing (exit 6)', () => {
    const { wt } = finishedRunWithWork();
    expect(mod(['restart', 'alpha']).status).toBe(6);
    expect(fs.existsSync(path.join(wt, 'stray.txt'))).toBe(true);
    expect(fs.readFileSync(path.join(wt, 'ran.txt'), 'utf8').trim().split('\n')).toHaveLength(1);
  });

  test('restart --yes starts again from scratch: a fresh worktree on a fresh branch, the old work gone', () => {
    const { wt, tip } = finishedRunWithWork();
    expect(mod(['restart', 'alpha', '--yes']).status).toBe(0);
    expect(fs.existsSync(path.join(wt, 'stray.txt'))).toBe(false);
    expect(fs.existsSync(path.join(wt, 'uncommitted.txt'))).toBe(false);
    expect(fs.readFileSync(path.join(wt, 'ran.txt'), 'utf8').trim().split('\n')).toHaveLength(1);
    expect(git(repo, 'rev-parse', 'sdlc/alpha')).toBe(git(repo, 'rev-parse', 'main'));
    expect(registry('alpha')).toMatchObject({ state: 'exited', exit_code: '0', interrupted: false });
    expect(fs.readFileSync(path.join(repo, '.git/sdlc-runs/alpha.discarded'), 'utf8')).toContain(tip);
  });

  test('restart of a slug that never ran simply runs it', () => {
    expect(mod(['restart', 'alpha', '--yes']).status).toBe(0);
    expect(registry('alpha').state).toBe('exited');
  });

  test('restart stops a running pipeline first, then starts a new one', async () => {
    modAsync(['run', 'slow-one']);
    await until(() => registry('slow-one').state === 'running' && fs.existsSync(path.join(wts, 'slow-one/sleep.pid')));
    const oldPid = registry('slow-one').pid;
    modAsync(['restart', 'slow-one', '--yes']);
    await until(() => { const r = registry('slow-one'); return r.state === 'running' && r.pid !== oldPid; });
    expect(alive(oldPid)).toBe(false);
    expect(registry('slow-one').interrupted).toBe(false);
  });

  test('restart refuses an item that is already merged, and deletes nothing (exit 5)', () => {
    const { wt } = finishedRunWithWork();
    git(repo, 'commit', '--allow-empty', '-q', '-m', 'test(alpha): add failing tests and spec/plan docs');
    expect(mod(['restart', 'alpha', '--yes']).status).toBe(5);
    expect(fs.existsSync(path.join(wt, 'stray.txt'))).toBe(true);
    expect(git(repo, 'branch', '--list', 'sdlc/alpha')).not.toBe('');
  });

  test('usage is printed for a missing slug (exit 2)', () => {
    expect(mod(['discard']).status).toBe(2);
    expect(mod(['restart']).status).toBe(2);
  });
});

describe('sdlc-mod.sh watch', () => {
  const wtOf = slug => path.join(fs.realpathSync(wts), slug);
  const writeStatus = (dir, slug, text) => {
    fs.mkdirSync(path.join(dir, 'Docs/backlog', slug, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Docs/backlog', slug, 'logs/status.json'), text + '\n');
  };

  test('a wrapper run shows the worktree status.json and files, not the main tree', () => {
    mod(['run', 'alpha']);
    const wt = wtOf('alpha');
    writeStatus(wt, 'alpha', '{"slug":"alpha","stage":"Red tests"}');
    fs.writeFileSync(path.join(wt, 'in-worktree.txt'), 'x');
    fs.writeFileSync(path.join(repo, 'in-main-tree.txt'), 'x');
    const r = mod(['watch', 'alpha', '--once']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('{"slug":"alpha","stage":"Red tests"}');
    expect(r.stdout).toContain('in-worktree.txt');
    expect(r.stdout).not.toContain('in-main-tree.txt');
    expect(r.stdout).not.toContain('No such file');
  });

  test('it shows the last 5 lines of run.out', () => {
    mod(['run', 'alpha']);
    const wt = wtOf('alpha');
    fs.writeFileSync(path.join(wt, 'Docs/backlog/alpha/logs/run.out'), Array.from({ length: 9 }, (_, i) => `line${i + 1}`).join('\n') + '\n');
    const out = mod(['watch', 'alpha', '--once']).stdout;
    expect(out).toContain('line9');
    expect(out).toContain('line5');
    expect(out).not.toContain('line4');
  });

  test('a run started in place falls back to the current directory', () => {
    writeStatus(repo, 'alpha', '{"slug":"alpha","state":"running"}');
    const r = mod(['watch', 'alpha', '--once']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('{"slug":"alpha","state":"running"}');
  });

  test('an unknown slug exits 1 with a message', () => {
    const r = mod(['watch', 'alpha', '--once']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('No pipeline for alpha');
  });

  test('a finished run says so on its own line', () => {
    mod(['run', 'alpha']);
    expect(mod(['watch', 'alpha', '--once']).stdout).toContain('run: finished, exit code 0');
  });

  test('a stopped run says so, and an interrupted one says interrupted', async () => {
    const child = modAsync(['run', 'slow-one']);
    await until(() => fs.existsSync(path.join(wts, 'slow-one/sleep.pid')));
    expect(mod(['watch', 'slow-one', '--once']).stdout).not.toMatch(/^run: /m);
    // the wrapper dies without finishing: the record still says running, the pid is gone
    process.kill(child.pid, 'SIGKILL');
    await until(() => !alive(child.pid));
    expect(mod(['watch', 'slow-one', '--once']).stdout).toContain('run: process has gone');
    const f = path.join(repo, '.git/sdlc-runs/slow-one.json');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"interrupted":false', '"interrupted":true'));
    expect(mod(['watch', 'slow-one', '--once']).stdout).toContain('run: interrupted');
  });

  test('WATCH_INTERVAL is validated: a bad value exits 2, a good one works', () => {
    mod(['run', 'alpha']);
    for (const bad of ['abc', '0', '-1', '']) {
      const r = mod(['watch', 'alpha', '--once'], { WATCH_INTERVAL: bad });
      if (bad === '') { expect(r.status).toBe(0); continue; }
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('WATCH_INTERVAL');
    }
    expect(mod(['watch', 'alpha', '--once'], { WATCH_INTERVAL: '0.5' }).status).toBe(0);
  });

  test('without --once it loops and refreshes until it is killed', async () => {
    mod(['run', 'alpha']);
    const out = path.join(tmp, 'watch.out');
    const fd = fs.openSync(out, 'w');
    const child = spawn('bash', [path.join(repo, 'scripts/sdlc-mod.sh'), 'watch', 'alpha'], { cwd: repo, env: env({ WATCH_INTERVAL: '0.2' }), stdio: ['ignore', fd, fd] });
    live.push(child);
    await until(() => (fs.readFileSync(out, 'utf8').match(/run: finished/g) || []).length >= 2);
  });

  test('an extra argument or a bad slug is a usage error', () => {
    expect(mod(['watch', 'alpha', '--bogus']).status).toBe(2);
    expect(mod(['watch']).status).toBe(2);
    expect(mod(['watch', 'Bad Slug', '--once']).status).toBe(2);
  });
});

describe('sdlc-mod.sh changes', () => {
  const writeIn = (dir, rel, text = 'x\n') => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  const commit = (dir, msg) => { git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', msg); };

  // A pipeline worktree under SDLC_WT_BASE on branch sdlc/<slug>, with the links the wrapper adds (kept out of git status),
  // and a run record written by hand to <common dir>/sdlc-runs/<slug>.json (omitted with record: false).
  function pipeline(slug, { from = 'main', record = true, base } = {}) {
    fs.mkdirSync(wts, { recursive: true });
    const wt = path.join(fs.realpathSync(wts), slug);
    git(repo, 'worktree', 'add', '-q', '-b', `sdlc/${slug}`, wt, from);
    fs.appendFileSync(path.join(repo, '.git/info/exclude'), 'server/node_modules\ngraft\n');
    fs.mkdirSync(path.join(wt, 'server'), { recursive: true });
    fs.symlinkSync(path.join(repo, 'server/node_modules'), path.join(wt, 'server/node_modules'));
    fs.symlinkSync(path.join(repo, 'graft'), path.join(wt, 'graft'));
    if (record) {
      fs.mkdirSync(path.join(repo, '.git/sdlc-runs'), { recursive: true });
      const rec = { slug, worktree: wt, pid: 1, started: '2026-10-07T10:00:00', state: 'exited', exit_code: '0', interrupted: false, finished: '', message: '' };
      if (base) rec.base = base;
      fs.writeFileSync(path.join(repo, '.git/sdlc-runs', `${slug}.json`), JSON.stringify(rec));
    }
    return wt;
  }

  test('prints "<changed> <uncommitted>" for committed plus uncommitted changes', () => {
    const wt = pipeline('alpha');
    writeIn(wt, 'a.txt'); writeIn(wt, 'b.txt');
    commit(wt, 'two files');
    writeIn(wt, 'c.txt'); // untracked
    fs.appendFileSync(path.join(wt, 'Docs/backlog/alpha/brief.md'), 'more\n'); // modified tracked
    const r = mod(['changes', 'alpha']);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('4 2\n');
    expect(r.stderr).toBe('');
  });

  test('a file committed and then edited again counts once in changed', () => {
    const wt = pipeline('alpha');
    writeIn(wt, 'a.txt');
    commit(wt, 'add');
    fs.appendFileSync(path.join(wt, 'a.txt'), 'again\n');
    expect(mod(['changes', 'alpha']).stdout).toBe('1 1\n');
  });

  test('untracked files count one each; the linked server/node_modules and graft do not', () => {
    const wt = pipeline('alpha');
    expect(mod(['changes', 'alpha']).stdout).toBe('0 0\n');
    writeIn(wt, 'new/dir/one.txt'); writeIn(wt, 'new/dir/two.txt');
    expect(mod(['changes', 'alpha']).stdout).toBe('2 2\n');
  });

  test('a renamed file counts as its new path, once', () => {
    const wt = pipeline('alpha');
    git(wt, 'mv', 'Docs/backlog/alpha/brief.md', 'Docs/backlog/alpha/renamed.md');
    const j = JSON.parse(mod(['changes', 'alpha', '--json']).stdout);
    expect([j.changed, j.uncommitted]).toEqual([1, 1]);
    expect(j.files).toEqual(['Docs/backlog/alpha/renamed.md']);
  });

  test('a path with spaces is listed under its real name', () => {
    const wt = pipeline('alpha');
    writeIn(wt, 'my notes.txt');
    const j = JSON.parse(mod(['changes', 'alpha', '--json']).stdout);
    expect(j.files).toEqual(['my notes.txt']);
    expect(j.changed).toBe(1);
  });

  test('--json has exactly slug, worktree, changed, uncommitted, files; --json may come first', () => {
    const wt = pipeline('alpha');
    writeIn(wt, 'b.txt'); writeIn(wt, 'a.txt');
    commit(wt, 'two');
    writeIn(wt, 'z.txt');
    for (const args of [['changes', 'alpha', '--json'], ['changes', '--json', 'alpha']]) {
      const r = mod(args);
      expect(r.status).toBe(0);
      const j = JSON.parse(r.stdout);
      expect(Object.keys(j).sort()).toEqual(['changed', 'files', 'slug', 'uncommitted', 'worktree']);
      expect(j).toEqual({ slug: 'alpha', worktree: wt, changed: 3, uncommitted: 1, files: ['a.txt', 'b.txt', 'z.txt'] });
    }
  });

  test('files is capped at 50 sorted entries while changed is the full total', () => {
    const wt = pipeline('alpha');
    for (let i = 1; i <= 60; i++) writeIn(wt, `f/f${String(i).padStart(2, '0')}.txt`);
    commit(wt, 'sixty');
    const j = JSON.parse(mod(['changes', 'alpha', '--json']).stdout);
    expect(j.changed).toBe(60);
    expect(j.uncommitted).toBe(0);
    expect(j.files).toHaveLength(50);
    expect(j.files).toEqual([...j.files].sort());
    expect(j.files[0]).toBe('f/f01.txt');
    expect(j.files[49]).toBe('f/f50.txt');
  });

  test('the numbers do not depend on the current directory', () => {
    const wt = pipeline('alpha');
    writeIn(wt, 'a.txt'); commit(wt, 'one'); writeIn(wt, 'b.txt');
    const here = mod(['changes', 'alpha']);
    for (const cwd of [tmp, wt, os.tmpdir()]) {
      const r = spawnSync('bash', [path.join(repo, 'scripts/sdlc-mod.sh'), 'changes', 'alpha'], { cwd, encoding: 'utf8', env: env({}) });
      expect(r.status).toBe(0);
      expect(r.stdout).toBe(here.stdout);
    }
    expect(here.stdout).toBe('2 1\n');
  });

  test('dirtying the main working tree changes neither number', () => {
    const wt = pipeline('alpha');
    writeIn(wt, 'a.txt');
    const before = mod(['changes', 'alpha']).stdout;
    writeIn(repo, 'unrelated.txt');
    fs.appendFileSync(path.join(repo, 'Docs/backlog/slow-one/brief.md'), 'edit\n');
    expect(mod(['changes', 'alpha']).stdout).toBe(before);
    expect(before).toBe('1 1\n');
  });

  test('an unknown slug exits 1 with "No pipeline for <slug>" and nothing on stdout', () => {
    for (const args of [['changes', 'ghost'], ['changes', 'ghost', '--json']]) {
      const r = mod(args);
      expect(r.status).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).toContain('No pipeline for ghost');
    }
  });

  test('a record whose worktree was deleted by hand exits 1 with "Worktree for <slug> is gone"', () => {
    const wt = pipeline('alpha');
    fs.rmSync(wt, { recursive: true, force: true });
    for (const args of [['changes', 'alpha'], ['changes', 'alpha', '--json']]) {
      const r = mod(args);
      expect(r.status).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).toContain('Worktree for alpha is gone');
      expect(r.stderr).not.toContain('No pipeline for');
    }
  });

  test('without a run record the $SDLC_WT_BASE/<slug> folder is used', () => {
    const wt = pipeline('alpha', { record: false });
    writeIn(wt, 'a.txt');
    const r = mod(['changes', 'alpha']);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('1 1\n');
  });

  test('a record whose worktree path is missing falls back to $SDLC_WT_BASE/<slug>', () => {
    const wt = pipeline('alpha');
    writeIn(wt, 'a.txt');
    const f = path.join(repo, '.git/sdlc-runs/alpha.json');
    const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
    rec.worktree = path.join(tmp, 'nowhere');
    fs.writeFileSync(f, JSON.stringify(rec));
    expect(mod(['changes', 'alpha']).stdout).toBe('1 1\n');
  });

  describe('base and merge-base', () => {
    // main has moved one commit past `root`; the worktree starts from main and commits w.txt.
    function twoCommits() {
      git(repo, 'branch', 'root', git(repo, 'rev-parse', 'HEAD'));
      writeIn(repo, 'm1.txt'); commit(repo, 'm1');
      const wt = pipeline('alpha');
      writeIn(wt, 'w.txt'); commit(wt, 'w');
      return wt;
    }

    test('with no base in the record the base is pick_base (SDLC_BASE, else main)', () => {
      twoCommits();
      expect(mod(['changes', 'alpha']).stdout).toBe('1 0\n');
      expect(mod(['changes', 'alpha'], { SDLC_BASE: 'root' }).stdout).toBe('2 0\n');
    });

    test('a base in the record is used, ahead of pick_base', () => {
      twoCommits();
      const f = path.join(repo, '.git/sdlc-runs/alpha.json');
      fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), base: 'root' }));
      expect(mod(['changes', 'alpha']).stdout).toBe('2 0\n');
      expect(mod(['changes', 'alpha'], { SDLC_BASE: 'main' }).stdout).toBe('2 0\n');
    });

    test('no merge-base: the committed part is 0, uncommitted still counts, exit 0', () => {
      const orphan = git(repo, 'commit-tree', '4b825dc642cb6eb9a060e54bf8d69288fbee4904', '-m', 'orphan');
      git(repo, 'branch', 'orphan', orphan);
      const wt = pipeline('alpha', { base: 'orphan' });
      writeIn(wt, 'w.txt'); commit(wt, 'w');
      writeIn(wt, 'u.txt');
      const r = mod(['changes', 'alpha']);
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('1 1\n');
      expect(r.stderr).toBe('');
    });

    test('an unknown base ref behaves like no merge-base: exit 0, committed part 0', () => {
      const wt = pipeline('alpha', { base: 'no-such-ref' });
      writeIn(wt, 'w.txt'); commit(wt, 'w');
      const r = mod(['changes', 'alpha', '--json']);
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout)).toMatchObject({ changed: 0, uncommitted: 0, files: [] });
    });
  });

  test('it makes no network call: an unreachable origin does not matter', () => {
    git(repo, 'remote', 'add', 'origin', 'file:///nonexistent/remote.git');
    const wt = pipeline('alpha');
    writeIn(wt, 'a.txt');
    const r = mod(['changes', 'alpha']);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('1 1\n');
    expect(r.stderr).toBe('');
  });

  test('usage: the help text lists changes; a missing or bad slug and extra arguments exit 2', () => {
    pipeline('alpha');
    expect(mod([]).stderr).toContain('changes <slug> [--json]');
    expect(mod(['changes']).status).toBe(2);
    expect(mod(['changes', '--json']).status).toBe(2);
    expect(mod(['changes', 'Bad Slug']).status).toBe(2);
    expect(mod(['changes', 'alpha', '--bogus']).status).toBe(2);
    expect(mod(['changes', 'alpha', 'beta']).status).toBe(2);
    expect(mod(['changes', 'alpha', '--json', '--json']).status).toBe(2);
  });
});

