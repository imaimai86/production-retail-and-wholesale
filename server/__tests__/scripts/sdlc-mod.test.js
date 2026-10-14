const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

// The async tests wait for real processes (a watch loop, detached pipelines); jest's default 5 s fails them on a busy machine.
jest.setTimeout(60000);

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
  slow*) sleep 300 & echo $! > "$(pwd -P)/sleep.pid"; wait $! ;;
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

// The repository is built (git init, add, commit) once; every test starts from a copy of it, which costs no git launch.
let template;
function buildTemplate() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-mod-tpl-'));
  const r = path.join(base, 'repo');
  fs.mkdirSync(path.join(r, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(r, 'server/node_modules'), { recursive: true });
  fs.mkdirSync(path.join(r, 'graft'), { recursive: true });
  fs.writeFileSync(path.join(r, 'scripts/sdlc.sh'), STUB, { mode: 0o755 });
  fs.copyFileSync(wrapper, path.join(r, 'scripts/sdlc-mod.sh'));
  for (const slug of ['alpha', 'slow-one', 'slow-two', 'fail-one']) {
    fs.mkdirSync(path.join(r, 'Docs/backlog', slug), { recursive: true });
    fs.writeFileSync(path.join(r, 'Docs/backlog', slug, 'brief.md'), `# ${slug}\n`);
  }
  fs.writeFileSync(path.join(r, '.gitignore'), 'node_modules/\n/graft/\nran.txt\nDocs/backlog/*/logs/\n');
  git(r, 'init', '-q', '-b', 'main');
  git(r, 'add', '-A');
  git(r, 'commit', '-q', '-m', 'init');
  return base;
}

function mkRepo() {
  template = template || buildTemplate();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-mod-'));
  repo = path.join(tmp, 'repo');
  wts = path.join(tmp, 'wts');
  fs.cpSync(path.join(template, 'repo'), repo, { recursive: true });
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

async function until(fn, ms = 40000) {
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
afterAll(() => { if (template) fs.rmSync(template, { recursive: true, force: true }); });
afterEach(() => {
  for (const c of live) { try { process.kill(c.pid, 'SIGKILL'); } catch (e) { /* gone */ } }
  live = [];
  spawnSync('pkill', ['-f', `${tmp}`]);
  for (const slug of fs.existsSync(wts) ? fs.readdirSync(wts) : []) {
    try { process.kill(Number(fs.readFileSync(path.join(wts, slug, 'sleep.pid'), 'utf8')), 'SIGKILL'); } catch (e) { /* gone */ }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const MERGED = slug => ['commit', '--allow-empty', '-q', '-m', `test(${slug}): add failing tests and spec/plan docs`];

describe('sdlc-mod.sh run', () => {
  test('runs sdlc.sh in its own worktree on sdlc/<slug>, records the run, links the shared folders, and reuses all of it on a second run', () => {
    const r = mod(['run', 'alpha']);
    expect(r.status).toBe(0);
    const wt = path.join(fs.realpathSync(wts), 'alpha');
    expect(git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('sdlc/alpha');
    const ran = fs.readFileSync(path.join(wt, 'ran.txt'), 'utf8');
    expect(ran).toContain(`cwd=${wt} slug=alpha sdlc_slug=alpha`);
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');

    // the run is recorded outside the worktree
    expect(registry('alpha')).toMatchObject({ slug: 'alpha', state: 'exited', exit_code: '0', interrupted: false });

    // node_modules and graft are shared with the main working tree, and never untracked
    expect(fs.lstatSync(path.join(wt, 'server/node_modules')).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(path.join(wt, 'graft')).isSymbolicLink()).toBe(true);
    expect(git(wt, 'status', '--porcelain', '--untracked-files=all')).toBe('');
    // and a stage that adds everything under server/ cannot sweep the link into a commit
    git(wt, 'add', 'server');
    expect(git(wt, 'diff', '--cached', '--name-only')).toBe('');

    expect(mod(['run', 'alpha']).status).toBe(0);
    expect(fs.readFileSync(path.join(wt, 'ran.txt'), 'utf8').trim().split('\n')).toHaveLength(2);
  });

  test('passes the plugin folders and FROM through, copies an uncommitted brief, and records a failing exit code', () => {
    mod(['run', 'alpha'], { SDLC_PLUGIN_DIRS: '/x/guard', FROM: 'implement' });
    const ran = fs.readFileSync(path.join(wts, 'alpha/ran.txt'), 'utf8');
    expect(ran).toContain('plugins=/x/guard');
    expect(ran).toContain('from=implement');

    // a brief that is not committed on the base branch yet
    fs.mkdirSync(path.join(repo, 'Docs/backlog/fresh'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'Docs/backlog/fresh/brief.md'), '# fresh\n');
    expect(mod(['run', 'fresh']).status).toBe(0);
    expect(fs.existsSync(path.join(wts, 'fresh/Docs/backlog/fresh/brief.md'))).toBe(true);

    expect(mod(['run', 'fail-one']).status).toBe(1);
    expect(registry('fail-one')).toMatchObject({ state: 'exited', exit_code: '1', interrupted: false });
  });

  test('rejects a bad slug (exit 2); a missing brief (exit 1) creates nothing and is recorded with its reason', () => {
    expect(mod(['run', '../etc']).status).toBe(2);
    expect(mod(['run', 'Bad Slug']).status).toBe(2);

    expect(mod(['run', 'nope']).status).toBe(1);
    expect(fs.existsSync(path.join(wts, 'nope'))).toBe(false);
    expect(git(repo, 'branch', '--list', 'sdlc/nope')).toBe('');
    expect(registry('nope')).toMatchObject({ state: 'exited', exit_code: '1' });
    expect(registry('nope').message).toBe('Missing Docs/backlog/nope/brief.md');
  });

  test('refuses an item already merged into the base branch (exit 5) and records why; SDLC_ALLOW_MERGED runs it anyway', () => {
    git(repo, ...MERGED('alpha'));
    const r = mod(['run', 'alpha']);
    expect(r.status).toBe(5);
    expect(fs.existsSync(path.join(wts, 'alpha'))).toBe(false);
    expect(git(repo, 'branch', '--list', 'sdlc/alpha')).toBe('');
    expect(registry('alpha')).toMatchObject({ state: 'exited', exit_code: '5', interrupted: false });
    expect(registry('alpha').message).toMatch(/alpha is already merged into main/);

    expect(mod(['run', 'alpha'], { SDLC_ALLOW_MERGED: '1' }).status).toBe(0);
  });

  test('an item whose slug is only a prefix of a merged one is not refused', () => {
    git(repo, ...MERGED('alpha-two'));
    expect(mod(['run', 'alpha']).status).toBe(0);
  });

  test('refuses a slug that is already running (exit 4) and more than SDLC_MAX_PARALLEL pipelines (exit 3); two run at once when the cap allows', async () => {
    modAsync(['run', 'slow-one'], { SDLC_MAX_PARALLEL: '1' });
    await until(() => registry('slow-one').state === 'running' && fs.existsSync(path.join(wts, 'slow-one/ran.txt')));

    const r = mod(['run', 'slow-two'], { SDLC_MAX_PARALLEL: '1' });
    expect(r.status).toBe(3);
    expect(registry('slow-two').message).toMatch(/at most 1 pipelines may run at once/);
    expect(registry('slow-one').state).toBe('running');

    expect(mod(['run', 'slow-one']).status).toBe(4);
    expect(registry('slow-one').state).toBe('running');

    modAsync(['run', 'slow-two'], { SDLC_MAX_PARALLEL: '2' });
    await until(() => registry('slow-one').state === 'running' && registry('slow-two').state === 'running');
    await until(() => fs.existsSync(path.join(wts, 'slow-two/ran.txt')));
    expect(registry('slow-one').worktree).not.toBe(registry('slow-two').worktree);
  });
});

describe('sdlc-mod.sh stop and status', () => {
  test('status lists each run with its state; stop interrupts a running pipeline and everything it started', async () => {
    // usage with no arguments
    expect(mod([]).status).toBe(2);

    mod(['run', 'alpha']);
    modAsync(['run', 'slow-one']);
    const sleepFile = path.join(wts, 'slow-one/sleep.pid');
    await until(() => registry('slow-one').state === 'running' && fs.existsSync(sleepFile) && fs.readFileSync(sleepFile, 'utf8').trim());
    const sleepPid = Number(fs.readFileSync(sleepFile, 'utf8'));
    const pid = registry('slow-one').pid;
    expect(alive(pid)).toBe(true);
    expect(alive(sleepPid)).toBe(true);
    const out = mod(['status']).stdout;
    expect(out).toMatch(/exited\s+alpha/);
    expect(out).toMatch(/running\s+slow-one/);

    expect(mod(['stop', 'slow-one']).status).toBe(0);
    await until(() => registry('slow-one').state === 'exited');
    expect(registry('slow-one').interrupted).toBe(true);
    expect(alive(pid)).toBe(false);
    await until(() => !alive(sleepPid));
    expect(mod(['status']).stdout).toMatch(/interrupted\s+slow-one/);

    // stop on a finished run is a no-op, on an unknown slug an error
    expect(mod(['stop', 'alpha']).status).toBe(0);
    expect(mod(['stop', 'ghost']).status).toBe(1);
  });
});

describe('sdlc-mod.sh discard and restart', () => {
  // A commit and an uncommitted file on the branch of a finished run: work that a discard would lose.
  function addWork(slug = 'alpha') {
    const wt = path.join(fs.realpathSync(wts), slug);
    fs.writeFileSync(path.join(wt, 'stray.txt'), 'work\n');
    git(wt, 'add', 'stray.txt');
    git(wt, 'commit', '-q', '-m', 'stray work');
    fs.writeFileSync(path.join(wt, 'uncommitted.txt'), 'wip\n');

    return { wt, tip: git(repo, 'rev-parse', `sdlc/${slug}`) };
  }
  function finishedRunWithWork(slug = 'alpha') {
    expect(mod(['run', slug]).status).toBe(0);

    return addWork(slug);
  }

  test('discard needs --yes (exit 6); with it the worktree, branch and run record go, and the saved branch tip brings the work back', () => {
    const { wt, tip } = finishedRunWithWork();
    let r = mod(['discard', 'alpha']);
    expect(r.status).toBe(6);
    expect(r.stdout).toMatch(/1 commit\(s\) not in main, 1 uncommitted file\(s\)/);
    expect(fs.existsSync(wt)).toBe(true);
    expect(git(repo, 'branch', '--list', 'sdlc/alpha')).not.toBe('');
    expect(registry('alpha').state).toBe('exited');

    r = mod(['discard', 'alpha', '--yes']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`git branch sdlc/alpha ${tip}`);
    expect(fs.existsSync(wt)).toBe(false);
    expect(git(repo, 'branch', '--list', 'sdlc/alpha')).toBe('');
    expect(fs.existsSync(path.join(repo, '.git/sdlc-runs/alpha.json'))).toBe(false);
    expect(fs.readFileSync(path.join(repo, '.git/sdlc-runs/alpha.discarded'), 'utf8').trim()).toBe(`git branch sdlc/alpha ${tip}`);
    expect(git(repo, 'worktree', 'list').split('\n')).toHaveLength(1);
    expect(git(repo, 'status', '--porcelain')).toBe('');

    git(repo, 'branch', 'sdlc/alpha', tip);
    expect(git(repo, 'log', '-1', '--format=%s', 'sdlc/alpha')).toBe('stray work');
  });

  test('discard works when the worktree folder was deleted by hand; an unknown flag or a missing slug is a usage error (exit 2)', () => {
    expect(mod(['discard']).status).toBe(2);
    expect(mod(['restart']).status).toBe(2);
    expect(mod(['discard', 'alpha', '--nope']).status).toBe(2);

    const { wt } = finishedRunWithWork();
    fs.rmSync(wt, { recursive: true, force: true });
    expect(mod(['discard', 'alpha', '--yes']).status).toBe(0);
    expect(git(repo, 'branch', '--list', 'sdlc/alpha')).toBe('');
    expect(git(repo, 'worktree', 'list').split('\n')).toHaveLength(1);
  });

  test('a running pipeline: discard refuses it (exit 4), restart replaces it, discard --yes --stop stops and deletes it', async () => {
    const sleepFile = path.join(wts, 'slow-one/sleep.pid');
    const started = () => registry('slow-one').state === 'running' && fs.existsSync(sleepFile) && fs.readFileSync(sleepFile, 'utf8').trim();
    modAsync(['run', 'slow-one']);
    await until(started);
    const oldPid = registry('slow-one').pid;

    expect(mod(['discard', 'slow-one', '--yes']).status).toBe(4);
    expect(registry('slow-one').state).toBe('running');
    expect(mod(['discard', 'ghost', '--yes']).status).toBe(1);

    // --stop without --yes stops nothing and deletes nothing
    expect(mod(['discard', 'slow-one', '--stop']).status).toBe(6);
    expect(alive(oldPid)).toBe(true);
    expect(registry('slow-one').state).toBe('running');

    // restart stops it first, then starts a new one
    modAsync(['restart', 'slow-one', '--yes']);
    await until(() => registry('slow-one').pid !== oldPid && started());
    expect(alive(oldPid)).toBe(false);
    expect(registry('slow-one').interrupted).toBe(false);

    const pid = registry('slow-one').pid;
    const sleepPid = Number(fs.readFileSync(sleepFile, 'utf8'));
    expect(mod(['discard', 'slow-one', '--yes', '--stop']).status).toBe(0);
    expect(alive(pid)).toBe(false);
    await until(() => !alive(sleepPid));
    expect(fs.existsSync(path.join(wts, 'slow-one'))).toBe(false);
    expect(git(repo, 'branch', '--list', 'sdlc/slow-one')).toBe('');
    expect(fs.existsSync(path.join(repo, '.git/sdlc-runs/slow-one.json'))).toBe(false);
  });

  test('restart needs --yes (exit 6); with it the run starts again from scratch, unless the item is already merged (exit 5)', () => {
    // a slug that never ran simply runs
    expect(mod(['restart', 'alpha', '--yes']).status).toBe(0);
    expect(registry('alpha').state).toBe('exited');

    const { wt, tip } = addWork();
    expect(mod(['restart', 'alpha']).status).toBe(6);
    expect(fs.existsSync(path.join(wt, 'stray.txt'))).toBe(true);
    expect(fs.readFileSync(path.join(wt, 'ran.txt'), 'utf8').trim().split('\n')).toHaveLength(1);

    // a fresh worktree on a fresh branch, the old work gone
    expect(mod(['restart', 'alpha', '--yes']).status).toBe(0);
    expect(fs.existsSync(path.join(wt, 'stray.txt'))).toBe(false);
    expect(fs.existsSync(path.join(wt, 'uncommitted.txt'))).toBe(false);
    expect(fs.readFileSync(path.join(wt, 'ran.txt'), 'utf8').trim().split('\n')).toHaveLength(1);
    expect(git(repo, 'rev-parse', 'sdlc/alpha')).toBe(git(repo, 'rev-parse', 'main'));
    expect(registry('alpha')).toMatchObject({ state: 'exited', exit_code: '0', interrupted: false });
    expect(fs.readFileSync(path.join(repo, '.git/sdlc-runs/alpha.discarded'), 'utf8')).toContain(tip);

    // already merged: refused, and nothing is deleted
    addWork();
    git(repo, ...MERGED('alpha'));
    expect(mod(['restart', 'alpha', '--yes']).status).toBe(5);
    expect(fs.existsSync(path.join(wt, 'stray.txt'))).toBe(true);
    expect(git(repo, 'branch', '--list', 'sdlc/alpha')).not.toBe('');
  });
});

describe('sdlc-mod.sh watch', () => {
  const wtOf = slug => path.join(fs.realpathSync(wts), slug);
  const writeStatus = (dir, slug, text) => {
    fs.mkdirSync(path.join(dir, 'Docs/backlog', slug, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Docs/backlog', slug, 'logs/status.json'), text + '\n');
  };

  test('shows the status.json, files and last 5 run.out lines of the worktree (the current directory for a run in place), and loops without --once', async () => {
    // usage errors
    expect(mod(['watch', 'alpha', '--bogus']).status).toBe(2);
    expect(mod(['watch']).status).toBe(2);
    expect(mod(['watch', 'Bad Slug', '--once']).status).toBe(2);

    // an unknown slug
    let r = mod(['watch', 'alpha', '--once']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('No pipeline for alpha');

    // a run started in place falls back to the current directory
    writeStatus(repo, 'alpha', '{"slug":"alpha","state":"running"}');
    r = mod(['watch', 'alpha', '--once']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('{"slug":"alpha","state":"running"}');

    // a wrapper run shows the worktree, not the main tree
    mod(['run', 'alpha']);
    const wt = wtOf('alpha');
    writeStatus(wt, 'alpha', '{"slug":"alpha","stage":"Red tests"}');
    fs.writeFileSync(path.join(wt, 'in-worktree.txt'), 'x');
    fs.writeFileSync(path.join(repo, 'in-main-tree.txt'), 'x');
    fs.writeFileSync(path.join(wt, 'Docs/backlog/alpha/logs/run.out'), Array.from({ length: 9 }, (_, i) => `line${i + 1}`).join('\n') + '\n');
    r = mod(['watch', 'alpha', '--once']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('{"slug":"alpha","stage":"Red tests"}');
    expect(r.stdout).not.toContain('{"slug":"alpha","state":"running"}');
    expect(r.stdout).toContain('in-worktree.txt');
    expect(r.stdout).not.toContain('in-main-tree.txt');
    expect(r.stdout).not.toContain('No such file');
    expect(r.stdout).toContain('line9');
    expect(r.stdout).toContain('line5');
    expect(r.stdout).not.toContain('line4');
    expect(r.stdout).toContain('run: finished, exit code 0');

    // WATCH_INTERVAL is validated: a bad value exits 2, an empty or a good one works
    for (const bad of ['abc', '0', '-1']) {
      const w = mod(['watch', 'alpha', '--once'], { WATCH_INTERVAL: bad });
      expect([bad, w.status]).toEqual([bad, 2]);
      expect(w.stderr).toContain('WATCH_INTERVAL');
    }
    expect(mod(['watch', 'alpha', '--once'], { WATCH_INTERVAL: '' }).status).toBe(0);
    expect(mod(['watch', 'alpha', '--once'], { WATCH_INTERVAL: '0.5' }).status).toBe(0);

    // without --once it refreshes until it is killed
    const out = path.join(tmp, 'watch.out');
    const fd = fs.openSync(out, 'w');
    const child = spawn('bash', [path.join(repo, 'scripts/sdlc-mod.sh'), 'watch', 'alpha'], { cwd: repo, env: env({ WATCH_INTERVAL: '0.2' }), stdio: ['ignore', fd, fd] });
    live.push(child);
    await until(() => (fs.readFileSync(out, 'utf8').match(/run: finished/g) || []).length >= 2);
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

  test('counts committed, uncommitted, untracked, edited-again, renamed and spaced files (one pipeline each)', () => {
    // committed plus uncommitted: two committed, one untracked, one modified tracked
    const a = pipeline('alpha');
    writeIn(a, 'a.txt'); writeIn(a, 'b.txt');
    commit(a, 'two files');
    writeIn(a, 'c.txt');
    fs.appendFileSync(path.join(a, 'Docs/backlog/alpha/brief.md'), 'more\n');
    const r = mod(['changes', 'alpha']);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('4 2\n');
    expect(r.stderr).toBe('');

    // a file committed and then edited again counts once in changed
    const s1 = pipeline('slow-one');
    writeIn(s1, 'a.txt');
    commit(s1, 'add');
    fs.appendFileSync(path.join(s1, 'a.txt'), 'again\n');
    expect(mod(['changes', 'slow-one']).stdout).toBe('1 1\n');

    // untracked files count one each; the linked server/node_modules and graft do not
    const s2 = pipeline('slow-two');
    expect(mod(['changes', 'slow-two']).stdout).toBe('0 0\n');
    writeIn(s2, 'new/dir/one.txt'); writeIn(s2, 'new/dir/two.txt');
    expect(mod(['changes', 'slow-two']).stdout).toBe('2 2\n');

    // a renamed file counts as its new path, once; a path with spaces is listed under its real name
    const f = pipeline('fail-one');
    git(f, 'mv', 'Docs/backlog/fail-one/brief.md', 'Docs/backlog/fail-one/renamed.md');
    let j = JSON.parse(mod(['changes', 'fail-one', '--json']).stdout);
    expect([j.changed, j.uncommitted]).toEqual([1, 1]);
    expect(j.files).toEqual(['Docs/backlog/fail-one/renamed.md']);
    writeIn(f, 'my notes.txt');
    j = JSON.parse(mod(['changes', 'fail-one', '--json']).stdout);
    expect(j.files).toEqual(['Docs/backlog/fail-one/renamed.md', 'my notes.txt']);
    expect(j.changed).toBe(2);
  });

  test('--json has exactly its keys, files is capped at 50, and the numbers ignore the current directory and the main working tree', () => {
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

    // files is capped at 50 sorted entries while changed is the full total
    const big = pipeline('slow-one');
    for (let i = 1; i <= 60; i++) writeIn(big, `f/f${String(i).padStart(2, '0')}.txt`);
    commit(big, 'sixty');
    const k = JSON.parse(mod(['changes', 'slow-one', '--json']).stdout);
    expect(k.changed).toBe(60);
    expect(k.uncommitted).toBe(0);
    expect(k.files).toHaveLength(50);
    expect(k.files).toEqual([...k.files].sort());
    expect(k.files[0]).toBe('f/f01.txt');
    expect(k.files[49]).toBe('f/f50.txt');

    // the numbers do not depend on the current directory
    const here = mod(['changes', 'alpha']);
    for (const cwd of [tmp, wt, os.tmpdir()]) {
      const r = spawnSync('bash', [path.join(repo, 'scripts/sdlc-mod.sh'), 'changes', 'alpha'], { cwd, encoding: 'utf8', env: env({}) });
      expect(r.status).toBe(0);
      expect(r.stdout).toBe(here.stdout);
    }
    expect(here.stdout).toBe('3 1\n');

    // dirtying the main working tree changes neither number
    writeIn(repo, 'unrelated.txt');
    fs.appendFileSync(path.join(repo, 'Docs/backlog/slow-two/brief.md'), 'edit\n');
    expect(mod(['changes', 'alpha']).stdout).toBe(here.stdout);
  });

  test('errors: usage, an unknown slug, and a worktree deleted by hand', () => {
    const wt = pipeline('alpha');
    expect(mod([]).stderr).toContain('changes <slug> [--json]');
    expect(mod(['changes']).status).toBe(2);
    expect(mod(['changes', '--json']).status).toBe(2);
    expect(mod(['changes', 'Bad Slug']).status).toBe(2);
    expect(mod(['changes', 'alpha', '--bogus']).status).toBe(2);
    expect(mod(['changes', 'alpha', 'beta']).status).toBe(2);
    expect(mod(['changes', 'alpha', '--json', '--json']).status).toBe(2);

    for (const args of [['changes', 'ghost'], ['changes', 'ghost', '--json']]) {
      const r = mod(args);
      expect(r.status).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).toContain('No pipeline for ghost');
    }

    fs.rmSync(wt, { recursive: true, force: true });
    for (const args of [['changes', 'alpha'], ['changes', 'alpha', '--json']]) {
      const r = mod(args);
      expect(r.status).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).toContain('Worktree for alpha is gone');
      expect(r.stderr).not.toContain('No pipeline for');
    }
  });

  test('without a usable record the $SDLC_WT_BASE/<slug> folder is used, and no network call is made', () => {
    git(repo, 'remote', 'add', 'origin', 'file:///nonexistent/remote.git');
    // no run record at all
    const a = pipeline('alpha', { record: false });
    writeIn(a, 'a.txt');
    const r = mod(['changes', 'alpha']);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('1 1\n');
    expect(r.stderr).toBe('');

    // a record whose worktree path is missing
    const b = pipeline('slow-one');
    writeIn(b, 'a.txt');
    const f = path.join(repo, '.git/sdlc-runs/slow-one.json');
    const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
    rec.worktree = path.join(tmp, 'nowhere');
    fs.writeFileSync(f, JSON.stringify(rec));
    expect(mod(['changes', 'slow-one']).stdout).toBe('1 1\n');
  });

  test('--all counts every recorded pipeline, or the slugs named, in one JSON line; one that cannot be counted gets its error', () => {
    const a = pipeline('alpha');
    writeIn(a, 'a.txt'); writeIn(a, 'b.txt');
    commit(a, 'two');
    writeIn(a, 'c.txt');
    const b = pipeline('slow-one');
    writeIn(b, 'x.txt');
    // a record whose worktree was deleted by hand
    const gone = pipeline('fail-one');
    fs.rmSync(gone, { recursive: true, force: true });

    // the same numbers as the single form
    const one = JSON.parse(mod(['changes', 'alpha', '--json']).stdout);
    let r = mod(['changes', '--all']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(r.stdout)).toEqual({
      runs: {
        alpha: { changed: one.changed, uncommitted: one.uncommitted },
        'slow-one': { changed: 1, uncommitted: 1 },
        'fail-one': { error: 'Worktree for fail-one is gone' },
      },
    });

    // only the slugs named; a slug with neither record nor worktree
    r = mod(['changes', '--all', 'slow-one', 'ghost']);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ runs: { 'slow-one': { changed: 1, uncommitted: 1 }, ghost: { error: 'No pipeline for ghost' } } });

    // a bad slug is a usage error; no records at all is an empty answer
    expect(mod(['changes', '--all', 'Bad Slug']).status).toBe(2);
    for (const f of fs.readdirSync(path.join(repo, '.git/sdlc-runs'))) fs.rmSync(path.join(repo, '.git/sdlc-runs', f));
    expect(mod(['changes', '--all']).stdout.trim()).toBe('{"runs":{}}');
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

    test('the base is the one in the record, else pick_base (SDLC_BASE, else main)', () => {
      twoCommits();
      expect(mod(['changes', 'alpha']).stdout).toBe('1 0\n');
      expect(mod(['changes', 'alpha'], { SDLC_BASE: 'root' }).stdout).toBe('2 0\n');

      const f = path.join(repo, '.git/sdlc-runs/alpha.json');
      fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), base: 'root' }));
      expect(mod(['changes', 'alpha']).stdout).toBe('2 0\n');
      expect(mod(['changes', 'alpha'], { SDLC_BASE: 'main' }).stdout).toBe('2 0\n');
    });

    test('no merge-base (an orphan base or an unknown ref): the committed part is 0, uncommitted still counts, exit 0', () => {
      const orphan = git(repo, 'commit-tree', '4b825dc642cb6eb9a060e54bf8d69288fbee4904', '-m', 'orphan');
      git(repo, 'branch', 'orphan', orphan);
      const wt = pipeline('alpha', { base: 'orphan' });
      writeIn(wt, 'w.txt'); commit(wt, 'w');
      writeIn(wt, 'u.txt');
      const r = mod(['changes', 'alpha']);
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('1 1\n');
      expect(r.stderr).toBe('');

      const other = pipeline('slow-one', { base: 'no-such-ref' });
      writeIn(other, 'w.txt'); commit(other, 'w');
      const k = mod(['changes', 'slow-one', '--json']);
      expect(k.status).toBe(0);
      expect(JSON.parse(k.stdout)).toMatchObject({ changed: 0, uncommitted: 0, files: [] });
    });
  });
});
