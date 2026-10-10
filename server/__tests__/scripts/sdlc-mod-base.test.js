// Base branch choice for scripts/sdlc-mod.sh: `--base <name>`, SDLC_BASE, the default, the resolution rule
// (fresher of origin/<name> and local <name>), name validation (exit 2), unknown base (exit 7) and the fetch.
// Spec: Docs/backlog/add-base-branch-dropdown/specs-1.md (criteria 1-13).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../../..');
const wrapper = path.join(repoRoot, 'scripts/sdlc-mod.sh');

const GIT_ENV = {
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

const STUB = '#!/usr/bin/env bash\necho "slug=$1" >> "$(pwd -P)/ran.txt"\nexit 0\n';

let tmp;
let repo;
let wts;
let origin;

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function mkRepo() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-base-'));
  repo = path.join(tmp, 'repo');
  wts = path.join(tmp, 'wts');
  origin = path.join(tmp, 'origin.git');
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'scripts/sdlc.sh'), STUB, { mode: 0o755 });
  fs.copyFileSync(wrapper, path.join(repo, 'scripts/sdlc-mod.sh'));
  for (const slug of ['alpha', 'beta']) {
    fs.mkdirSync(path.join(repo, 'Docs/backlog', slug), { recursive: true });
    fs.writeFileSync(path.join(repo, 'Docs/backlog', slug, 'brief.md'), `# ${slug}\n`);
  }
  fs.writeFileSync(path.join(repo, '.gitignore'), 'ran.txt\nDocs/backlog/*/logs/\n');
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
}

const env = extra => ({
  ...process.env, ...GIT_ENV, SDLC_WT_BASE: wts, SDLC_PLUGIN_DIRS: '', SDLC_BASE: '', ...extra,
});

function mod(args, extra = {}) {
  return spawnSync('bash', [path.join(repo, 'scripts/sdlc-mod.sh'), ...args], { cwd: repo, encoding: 'utf8', env: env(extra) });
}

const registry = slug => JSON.parse(fs.readFileSync(path.join(repo, '.git/sdlc-runs', `${slug}.json`), 'utf8'));
const wrapperLog = slug => fs.readFileSync(path.join(repo, '.git/sdlc-runs', `${slug}.wrapper.log`), 'utf8');
const tip = ref => git(repo, 'rev-parse', ref);
const hasBranch = name => git(repo, 'branch', '--list', name) !== '';
const hasWorktree = slug => fs.existsSync(path.join(wts, slug));
const commit = (dir, msg) => { git(dir, 'commit', '--allow-empty', '-q', '-m', msg); return git(dir, 'rev-parse', 'HEAD'); };

// A new branch with one extra commit, started from `from`; the main checkout stays on main.
function branchWith(name, from = 'main') {
  git(repo, 'checkout', '-q', '-b', name, from);
  const t = commit(repo, `commit on ${name}`);
  git(repo, 'checkout', '-q', 'main');
  return t;
}

// A bare origin with main pushed; the repo has origin/main.
function addOrigin() {
  git(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'push', '-q', 'origin', 'main');
}

// A second clone that pushes `branch` (an empty commit on it) to origin, as another developer would.
function pushFromElsewhere(branch = 'main', base = 'main') {
  const other = path.join(tmp, `other-${Math.random().toString(36).slice(2)}`);
  git(tmp, 'clone', '-q', origin, other);
  if (branch === base) git(other, 'checkout', '-q', base);
  else git(other, 'checkout', '-q', '-b', branch, `origin/${base}`);
  const t = commit(other, `pushed to ${branch}`);
  git(other, 'push', '-q', 'origin', branch);
  return t;
}

beforeEach(mkRepo);
afterEach(() => {
  spawnSync('pkill', ['-f', `${tmp}`]);
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('usage', () => {
  test('the help text shows --base for run and restart', () => {
    const r = mod([]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--base');
  });
});

describe('--base selects the starting branch (criteria 1-3)', () => {
  test('a local branch: the worktree starts at that branch tip', () => {
    const t = branchWith('feat');
    expect(mod(['run', 'alpha', '--base', 'feat']).status).toBe(0);
    expect(tip('sdlc/alpha')).toBe(t);
    expect(tip('sdlc/alpha')).not.toBe(tip('main'));
  });

  test('a branch name with a dot and a slash is accepted', () => {
    const t = branchWith('release/v1.2');
    expect(mod(['run', 'alpha', '--base', 'release/v1.2']).status).toBe(0);
    expect(tip('sdlc/alpha')).toBe(t);
  });

  test('a branch that exists only as origin/<name>', () => {
    addOrigin();
    const t = branchWith('rem');
    git(repo, 'push', '-q', 'origin', 'rem');
    git(repo, 'branch', '-D', 'rem');
    expect(hasBranch('rem')).toBe(false);
    expect(mod(['run', 'alpha', '--base', 'rem']).status).toBe(0);
    expect(tip('sdlc/alpha')).toBe(t);
  });

  test('a remote branch this clone has never fetched is found by the fetch', () => {
    addOrigin();
    const t = pushFromElsewhere('brand-new');
    expect(mod(['run', 'alpha', '--base', 'brand-new']).status).toBe(0);
    expect(tip('sdlc/alpha')).toBe(t);
  });

  test('another task\'s sdlc/<other> branch', () => {
    const t = branchWith('sdlc/other');
    expect(mod(['run', 'alpha', '--base', 'sdlc/other']).status).toBe(0);
    expect(tip('sdlc/alpha')).toBe(t);
  });
});

describe('resolution rule: the fresher of origin/<name> and local <name> (criterion 4)', () => {
  test('origin ahead of a stale local branch: origin wins', () => {
    addOrigin();
    const ahead = pushFromElsewhere('main');
    git(repo, 'fetch', '-q', 'origin');
    expect(tip('main')).not.toBe(ahead);
    expect(mod(['run', 'alpha']).status).toBe(0);
    expect(tip('sdlc/alpha')).toBe(ahead);
    expect(registry('alpha').base).toBe('origin/main');
  });

  test('local branch equal to origin: resolves to origin/<name>', () => {
    addOrigin();
    expect(mod(['run', 'alpha']).status).toBe(0);
    expect(registry('alpha').base).toBe('origin/main');
    expect(tip('sdlc/alpha')).toBe(tip('main'));
  });

  test('local branch ahead of origin is kept', () => {
    addOrigin();
    const local = commit(repo, 'local only');
    expect(mod(['run', 'alpha']).status).toBe(0);
    expect(tip('sdlc/alpha')).toBe(local);
    expect(registry('alpha').base).toBe('main');
  });

  test('a diverged local branch is kept', () => {
    addOrigin();
    pushFromElsewhere('main');
    const local = commit(repo, 'diverging local');
    expect(mod(['run', 'alpha']).status).toBe(0);
    expect(tip('sdlc/alpha')).toBe(local);
    expect(registry('alpha').base).toBe('main');
  });
});

describe('base precedence and default (criterion 5)', () => {
  test('--base beats SDLC_BASE', () => {
    const a = branchWith('feat-a');
    branchWith('feat-b');
    expect(mod(['run', 'alpha', '--base', 'feat-a'], { SDLC_BASE: 'feat-b' }).status).toBe(0);
    expect(tip('sdlc/alpha')).toBe(a);
  });

  test('SDLC_BASE is used when there is no --base', () => {
    const b = branchWith('feat-b');
    expect(mod(['run', 'alpha'], { SDLC_BASE: 'feat-b' }).status).toBe(0);
    expect(tip('sdlc/alpha')).toBe(b);
  });

  test('an empty SDLC_BASE counts as unset', () => {
    expect(mod(['run', 'alpha'], { SDLC_BASE: '' }).status).toBe(0);
    expect(registry('alpha').base).toBe('main');
  });

  test('with neither, the default is main even when another branch is checked out', () => {
    const mainTip = tip('main');
    git(repo, 'checkout', '-q', '-b', 'elsewhere');
    commit(repo, 'elsewhere commit');
    expect(mod(['run', 'alpha']).status).toBe(0);
    expect(tip('sdlc/alpha')).toBe(mainTip);
  });

  test('no main: falls back to the branch origin/HEAD points to', () => {
    git(repo, 'branch', '-m', 'main', 'trunk');
    git(repo, 'checkout', '-q', '-b', 'develop');
    const dev = commit(repo, 'on develop');
    git(repo, 'checkout', '-q', 'trunk');
    git(tmp, 'init', '-q', '--bare', '-b', 'develop', origin);
    git(repo, 'remote', 'add', 'origin', origin);
    git(repo, 'push', '-q', 'origin', 'develop');
    git(repo, 'branch', '-D', 'develop');
    git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop');
    commit(repo, 'trunk moves on');
    expect(mod(['run', 'alpha']).status).toBe(0);
    expect(tip('sdlc/alpha')).toBe(dev);
  });

  test('no main and no origin/HEAD: falls back to the current HEAD', () => {
    git(repo, 'checkout', '-q', '-b', 'work');
    git(repo, 'branch', '-D', 'main');
    const head = commit(repo, 'on work');
    expect(mod(['run', 'alpha']).status).toBe(0);
    expect(tip('sdlc/alpha')).toBe(head);
  });

  test('an explicit base never falls back: --base main with no main exits 7', () => {
    git(repo, 'checkout', '-q', '-b', 'work');
    git(repo, 'branch', '-D', 'main');
    const r = mod(['run', 'alpha', '--base', 'main']);
    expect(r.status).toBe(7);
    expect(hasBranch('sdlc/alpha')).toBe(false);
  });

  test('an explicit SDLC_BASE never falls back either', () => {
    expect(mod(['run', 'alpha'], { SDLC_BASE: 'gone' }).status).toBe(7);
  });
});

describe('unknown base: exit 7 (criteria 6, 7)', () => {
  const MSG = name => `base branch '${name}' not found (local or origin)`;

  test('run: exit 7, recorded with the exact message, nothing created', () => {
    const r = mod(['run', 'alpha', '--base', 'nope']);
    expect(r.status).toBe(7);
    expect(registry('alpha')).toMatchObject({ state: 'exited', exit_code: '7', interrupted: false });
    expect(registry('alpha').message).toBe(MSG('nope'));
    expect(hasBranch('sdlc/alpha')).toBe(false);
    expect(hasWorktree('alpha')).toBe(false);
  });

  test('run: the same through SDLC_BASE', () => {
    expect(mod(['run', 'alpha'], { SDLC_BASE: 'nope' }).status).toBe(7);
    expect(registry('alpha').message).toBe(MSG('nope'));
  });

  test('run: a record of a refused start has the requested name as base, or none', () => {
    mod(['run', 'alpha', '--base', 'nope']);
    expect(registry('alpha').base ?? '').toMatch(/^(nope)?$/);
  });

  test('run: still exit 7 when sdlc/<slug> and its worktree already exist', () => {
    expect(mod(['run', 'alpha']).status).toBe(0);
    const before = tip('sdlc/alpha');
    expect(mod(['run', 'alpha', '--base', 'nope']).status).toBe(7);
    expect(tip('sdlc/alpha')).toBe(before);
    expect(hasWorktree('alpha')).toBe(true);
    expect(registry('alpha').message).toBe(MSG('nope'));
  });

  test('run: still exit 7 when only the branch exists (worktree removed)', () => {
    expect(mod(['run', 'alpha']).status).toBe(0);
    git(repo, 'worktree', 'remove', '--force', path.join(fs.realpathSync(wts), 'alpha'));
    expect(mod(['run', 'alpha', '--base', 'nope']).status).toBe(7);
    expect(hasBranch('sdlc/alpha')).toBe(true);
    expect(hasWorktree('alpha')).toBe(false);
  });

  test('restart: exit 7 on stderr and nothing is deleted', () => {
    expect(mod(['run', 'alpha']).status).toBe(0);
    const before = tip('sdlc/alpha');
    const r = mod(['restart', 'alpha', '--yes', '--base', 'nope']);
    expect(r.status).toBe(7);
    expect(r.stderr).toContain(MSG('nope'));
    expect(tip('sdlc/alpha')).toBe(before);
    expect(hasWorktree('alpha')).toBe(true);
    expect(fs.existsSync(path.join(repo, '.git/sdlc-runs/alpha.json'))).toBe(true);
  });

  test('discard: an unknown SDLC_BASE exits 7 on stderr, with and without --yes, and deletes nothing', () => {
    expect(mod(['run', 'alpha']).status).toBe(0);
    for (const args of [['discard', 'alpha'], ['discard', 'alpha', '--yes']]) {
      const r = mod(args, { SDLC_BASE: 'nope' });
      expect(r.status).toBe(7);
      expect(r.stderr).toContain(MSG('nope'));
    }
    expect(hasBranch('sdlc/alpha')).toBe(true);
    expect(hasWorktree('alpha')).toBe(true);
    expect(fs.existsSync(path.join(repo, '.git/sdlc-runs/alpha.json'))).toBe(true);
  });

  test('discard resolves its base from SDLC_BASE', () => {
    branchWith('feat');
    expect(mod(['run', 'alpha']).status).toBe(0);
    const r = mod(['discard', 'alpha'], { SDLC_BASE: 'feat' });
    expect(r.status).toBe(6);
    expect(r.stdout).toContain('not in feat');
  });

  test('discard takes no --base flag (exit 2)', () => {
    expect(mod(['run', 'alpha']).status).toBe(0);
    expect(mod(['discard', 'alpha', '--base', 'main', '--yes']).status).toBe(2);
    expect(hasBranch('sdlc/alpha')).toBe(true);
  });

  test('exit 7 comes before the capacity check (3) and the merged check (5)', () => {
    expect(mod(['run', 'alpha', '--base', 'nope'], { SDLC_MAX_PARALLEL: '0' }).status).toBe(7);
    git(repo, 'commit', '--allow-empty', '-q', '-m', 'test(alpha): add failing tests and docs');
    expect(mod(['run', 'alpha', '--base', 'nope']).status).toBe(7);
  });

  test('a valid base still meets the capacity limit (3)', () => {
    expect(mod(['run', 'alpha', '--base', 'main'], { SDLC_MAX_PARALLEL: '0' }).status).toBe(3);
  });
});

describe('invalid names: exit 2, nothing created (criterion 8)', () => {
  test.each([
    ['--evil'], ['a..b'], ['has space'], [''], ['-x'], ['semi;colon'], ['$(id)'],
  ])('--base %j', name => {
    const r = mod(['run', 'alpha', '--base', name]);
    expect(r.status).toBe(2);
    expect(hasBranch('sdlc/alpha')).toBe(false);
    expect(hasWorktree('alpha')).toBe(false);
  });

  test('the message names the bad value', () => {
    const r = mod(['run', 'alpha', '--base', 'a..b']);
    expect(r.stdout + r.stderr + (fs.existsSync(path.join(repo, '.git/sdlc-runs/alpha.wrapper.log')) ? wrapperLog('alpha') : '')).toContain('a..b');
  });

  test.each([['--evil'], ['a..b'], ['has space']])('SDLC_BASE %j', name => {
    expect(mod(['run', 'alpha'], { SDLC_BASE: name }).status).toBe(2);
    expect(hasBranch('sdlc/alpha')).toBe(false);
  });

  test('validation runs before the existence check and before the other refusals', () => {
    expect(mod(['run', 'alpha', '--base', 'bad name'], { SDLC_MAX_PARALLEL: '0' }).status).toBe(2);
  });

  test('restart and discard validate SDLC_BASE too', () => {
    expect(mod(['run', 'alpha']).status).toBe(0);
    expect(mod(['restart', 'alpha', '--yes'], { SDLC_BASE: 'a..b' }).status).toBe(2);
    expect(mod(['discard', 'alpha', '--yes'], { SDLC_BASE: '--evil' }).status).toBe(2);
    expect(hasBranch('sdlc/alpha')).toBe(true);
    expect(hasWorktree('alpha')).toBe(true);
  });

  test('--base without a value is a usage error', () => {
    expect(mod(['run', 'alpha', '--base']).status).toBe(2);
    expect(mod(['restart', 'alpha', '--yes', '--base']).status).toBe(2);
    expect(hasBranch('sdlc/alpha')).toBe(false);
  });

  test('a repeated --base is a usage error', () => {
    branchWith('feat');
    expect(mod(['run', 'alpha', '--base', 'feat', '--base', 'main']).status).toBe(2);
    expect(hasBranch('sdlc/alpha')).toBe(false);
  });
});

describe('an existing branch ignores the base (criterion 9)', () => {
  test('the branch keeps its tip and the wrapper log says why', () => {
    expect(mod(['run', 'alpha']).status).toBe(0);
    const before = tip('sdlc/alpha');
    branchWith('feat');
    expect(mod(['run', 'alpha', '--base', 'feat']).status).toBe(0);
    expect(tip('sdlc/alpha')).toBe(before);
    expect(wrapperLog('alpha')).toContain('base ignored: sdlc/alpha already exists');
  });

  test('a branch without its worktree is reused, base ignored', () => {
    expect(mod(['run', 'alpha']).status).toBe(0);
    const before = tip('sdlc/alpha');
    git(repo, 'worktree', 'remove', '--force', path.join(fs.realpathSync(wts), 'alpha'));
    branchWith('feat');
    expect(mod(['run', 'alpha', '--base', 'feat']).status).toBe(0);
    expect(tip('sdlc/alpha')).toBe(before);
    expect(wrapperLog('alpha')).toContain('base ignored: sdlc/alpha already exists');
  });

  test('a fresh start does not log "base ignored"', () => {
    branchWith('feat');
    expect(mod(['run', 'alpha', '--base', 'feat']).status).toBe(0);
    expect(wrapperLog('alpha')).not.toContain('base ignored');
  });
});

describe('run record base (criterion 10)', () => {
  test('holds the resolved ref', () => {
    branchWith('feat');
    mod(['run', 'alpha', '--base', 'feat']);
    expect(registry('alpha').base).toBe('feat');
  });

  test('default start without origin: main', () => {
    mod(['run', 'alpha']);
    expect(registry('alpha').base).toBe('main');
  });

  test('is a valid record: the existing fields are intact', () => {
    mod(['run', 'alpha', '--base', 'main']);
    expect(registry('alpha')).toMatchObject({ slug: 'alpha', state: 'exited', exit_code: '0', interrupted: false, message: '' });
  });

  test('is rewritten on every run, including a resume where the base is ignored', () => {
    branchWith('feat');
    mod(['run', 'alpha', '--base', 'feat']);
    expect(registry('alpha').base).toBe('feat');
    mod(['run', 'alpha', '--base', 'main']);
    expect(registry('alpha').base).toBe('main');
  });

  test('`changes` uses the recorded base', () => {
    const t = branchWith('feat');
    mod(['run', 'alpha', '--base', 'feat']);
    expect(tip('sdlc/alpha')).toBe(t);
    expect(mod(['changes', 'alpha']).stdout).toBe('0 0\n');
  });
});

describe('merged guard and brief use the chosen base (criterion 11)', () => {
  test('an item merged only into the chosen base is refused (5), naming that base', () => {
    git(repo, 'checkout', '-q', '-b', 'merged-b');
    commit(repo, 'test(alpha): add failing tests and docs');
    git(repo, 'checkout', '-q', 'main');
    const r = mod(['run', 'alpha', '--base', 'merged-b']);
    expect(r.status).toBe(5);
    expect(registry('alpha').message).toMatch(/alpha is already merged into merged-b/);
    expect(hasBranch('sdlc/alpha')).toBe(false);
    expect(mod(['run', 'alpha']).status).toBe(0);
  });

  test('SDLC_ALLOW_MERGED still overrides', () => {
    git(repo, 'checkout', '-q', '-b', 'merged-b');
    commit(repo, 'test(alpha): add failing tests and docs');
    git(repo, 'checkout', '-q', 'main');
    expect(mod(['run', 'alpha', '--base', 'merged-b'], { SDLC_ALLOW_MERGED: '1' }).status).toBe(0);
  });

  test('a brief committed only on the chosen base is found there', () => {
    git(repo, 'checkout', '-q', '-b', 'withbrief');
    fs.mkdirSync(path.join(repo, 'Docs/backlog/fresh'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'Docs/backlog/fresh/brief.md'), '# fresh\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'add fresh brief');
    git(repo, 'checkout', '-q', 'main');
    expect(fs.existsSync(path.join(repo, 'Docs/backlog/fresh/brief.md'))).toBe(false);
    expect(mod(['run', 'fresh']).status).toBe(1);
    expect(mod(['run', 'fresh', '--base', 'withbrief']).status).toBe(0);
    expect(git(path.join(wts, 'fresh'), 'ls-files', 'Docs/backlog/fresh/brief.md')).toBe('Docs/backlog/fresh/brief.md');
  });

  test('a brief missing in the base is copied from the main working tree', () => {
    branchWith('feat');
    fs.mkdirSync(path.join(repo, 'Docs/backlog/loose'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'Docs/backlog/loose/brief.md'), '# loose\n');
    expect(mod(['run', 'loose', '--base', 'feat']).status).toBe(0);
    expect(fs.existsSync(path.join(wts, 'loose/Docs/backlog/loose/brief.md'))).toBe(true);
  });

  test('a base without the item in Docs/backlog/index.md is allowed', () => {
    branchWith('feat');
    expect(mod(['run', 'alpha', '--base', 'feat']).status).toBe(0);
  });
});

describe('restart accepts --base and --yes in either order (criterion 12)', () => {
  test.each([
    [['--yes', '--base', 'feat']],
    [['--base', 'feat', '--yes']],
  ])('restart alpha %j', flags => {
    expect(mod(['run', 'alpha']).status).toBe(0);
    const t = branchWith('feat');
    const r = mod(['restart', 'alpha', ...flags]);
    expect(r.status).toBe(0);
    expect(tip('sdlc/alpha')).toBe(t);
    expect(registry('alpha').base).toBe('feat');
  });

  test('restart without --yes shows what would go and exits 6 (nothing deleted)', () => {
    expect(mod(['run', 'alpha']).status).toBe(0);
    branchWith('feat');
    expect(mod(['restart', 'alpha', '--base', 'feat']).status).toBe(6);
    expect(hasBranch('sdlc/alpha')).toBe(true);
  });

  test('restart refuses an item merged into the chosen base (5) before deleting anything', () => {
    expect(mod(['run', 'alpha']).status).toBe(0);
    git(repo, 'checkout', '-q', '-b', 'merged-b');
    commit(repo, 'test(alpha): add failing tests and docs');
    git(repo, 'checkout', '-q', 'main');
    expect(mod(['restart', 'alpha', '--yes', '--base', 'merged-b']).status).toBe(5);
    expect(hasBranch('sdlc/alpha')).toBe(true);
  });

  test('restart without --base uses SDLC_BASE', () => {
    expect(mod(['run', 'alpha']).status).toBe(0);
    const t = branchWith('feat');
    expect(mod(['restart', 'alpha', '--yes'], { SDLC_BASE: 'feat' }).status).toBe(0);
    expect(tip('sdlc/alpha')).toBe(t);
  });

  test('restart fetches when it creates the fresh branch', () => {
    addOrigin();
    expect(mod(['run', 'alpha']).status).toBe(0);
    const ahead = pushFromElsewhere('main');
    expect(mod(['restart', 'alpha', '--yes']).status).toBe(0);
    expect(tip('sdlc/alpha')).toBe(ahead);
  });
});

describe('fetch (criterion 13)', () => {
  test('a commit pushed to origin is picked up before the worktree is created', () => {
    addOrigin();
    const ahead = pushFromElsewhere('main');
    expect(tip('origin/main')).not.toBe(ahead);
    expect(mod(['run', 'alpha']).status).toBe(0);
    expect(tip('sdlc/alpha')).toBe(ahead);
  });

  test('the same for an explicit base', () => {
    addOrigin();
    const t = pushFromElsewhere('feat', 'main');
    git(repo, 'fetch', '-q', 'origin');
    const t2 = pushFromElsewhere('feat', 'feat');
    expect(t2).not.toBe(t);
    expect(mod(['run', 'alpha', '--base', 'feat']).status).toBe(0);
    expect(tip('sdlc/alpha')).toBe(t2);
  });

  test('an unreachable origin still starts, and the failure is logged', () => {
    git(repo, 'remote', 'add', 'origin', 'file:///nonexistent/remote.git');
    const r = mod(['run', 'alpha']);
    expect(r.status).toBe(0);
    expect(hasBranch('sdlc/alpha')).toBe(true);
    expect(wrapperLog('alpha')).toMatch(/fetch.*(failed|timed out)/i);
  });

  test('a local-only branch (absent on origin) starts; the fetch failure is only logged', () => {
    addOrigin();
    const t = branchWith('local-only');
    expect(mod(['run', 'alpha', '--base', 'local-only']).status).toBe(0);
    expect(tip('sdlc/alpha')).toBe(t);
  });

  test('no origin remote: the fetch is skipped without error', () => {
    expect(mod(['run', 'alpha']).status).toBe(0);
    expect(wrapperLog('alpha')).not.toMatch(/fatal/i);
  });

  test('no fetch when sdlc/<slug> and its worktree exist', () => {
    addOrigin();
    expect(mod(['run', 'alpha']).status).toBe(0);
    const before = tip('origin/main');
    pushFromElsewhere('main');
    expect(mod(['run', 'alpha']).status).toBe(0);
    expect(tip('origin/main')).toBe(before);
  });

  test('no fetch when only the branch exists', () => {
    addOrigin();
    expect(mod(['run', 'alpha']).status).toBe(0);
    git(repo, 'worktree', 'remove', '--force', path.join(fs.realpathSync(wts), 'alpha'));
    const before = tip('origin/main');
    pushFromElsewhere('main');
    expect(mod(['run', 'alpha']).status).toBe(0);
    expect(tip('origin/main')).toBe(before);
  });

  test('an unknown base exits 7 without leaving a branch or worktree, also with an origin', () => {
    addOrigin();
    expect(mod(['run', 'beta', '--base', 'nope']).status).toBe(7);
    expect(hasBranch('sdlc/beta')).toBe(false);
    expect(hasWorktree('beta')).toBe(false);
  });

  test('a hanging origin delays the start by about 20 seconds at most', () => {
    git(repo, 'config', 'protocol.ext.allow', 'always');
    git(repo, 'remote', 'add', 'origin', 'ext::sleep 120');
    const started = Date.now();
    const r = mod(['run', 'alpha']);
    const secs = (Date.now() - started) / 1000;
    expect(r.status).toBe(0);
    expect(secs).toBeLessThan(40);
    expect(hasBranch('sdlc/alpha')).toBe(true);
    expect(wrapperLog('alpha')).toMatch(/fetch.*(failed|timed out)/i);
  }, 90000);
});
