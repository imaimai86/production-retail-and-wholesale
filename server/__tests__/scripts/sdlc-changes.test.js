const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const HELPER = path.join(root, 'scripts/sdlc-changes.cjs');
const MIB = 1048576;

const tmpDirs = [];
const mktmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-changes-'));
  tmpDirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
};

const write = (repo, rel, content = 'x\n') => {
  const p = path.join(repo, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};

// Temporary git repo with an initial commit of `files` (path -> content).
function mkRepo(files = {}) {
  const repo = mktmp();
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'commit.gpgsign', 'false');
  const all = { '.gitignore': 'ignored.log\nbuild/\n', 'a.txt': 'a\n', 'b.txt': 'b\n', 'c.txt': 'c\n', ...files };
  for (const [p, c] of Object.entries(all)) write(repo, p, c);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
  return repo;
}

const run = (cwd, ...args) =>
  spawnSync('node', [HELPER, ...args], { cwd, encoding: 'utf8' });

// The baseline file lives outside the repo so it never shows up in git status.
function snapshot(repo) {
  const file = path.join(mktmp(), 'baseline.json');
  const r = run(repo, 'snapshot', file);
  expect(r.status).toBe(0);
  return file;
}

function changed(repo, baseline) {
  const r = run(repo, 'changed', baseline);
  expect(r.stderr).toBe('');
  expect(r.status).toBe(0);
  return JSON.parse(r.stdout);
}

const reasons = res => Object.fromEntries(res.skipped.map(s => [s.path, s.reason]));

describe('sdlc-changes snapshot (AC1)', () => {
  test('records modified, untracked, deleted and staged paths with hashes', () => {
    const repo = mkRepo();
    write(repo, 'a.txt', 'a edited\n'); // modified
    fs.rmSync(path.join(repo, 'b.txt')); // deleted
    write(repo, 'u.txt', 'untracked\n'); // untracked
    write(repo, 's.txt', 'staged\n'); // staged new
    git(repo, 'add', 's.txt');
    write(repo, 'c.txt', 'c staged edit\n'); // staged modification
    git(repo, 'add', 'c.txt');

    const out = path.join(mktmp(), 'baseline.json');
    const r = run(repo, 'snapshot', out);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');

    // Flat {path: hash|null} layout is fixed by plan-1.md section 2.
    const snap = JSON.parse(fs.readFileSync(out, 'utf8'));
    const hash = p => git(repo, 'hash-object', p).trim();
    expect(snap['a.txt']).toBe(hash('a.txt'));
    expect(snap['u.txt']).toBe(hash('u.txt'));
    expect(snap['s.txt']).toBe(hash('s.txt'));
    expect(snap['c.txt']).toBe(hash('c.txt'));
    expect(snap).toHaveProperty('b.txt', null);
  });

  test('records untracked files inside untracked directories individually', () => {
    const repo = mkRepo();
    write(repo, 'newdir/deep/f.txt', 'f\n');
    const snap = JSON.parse(fs.readFileSync(snapshot(repo), 'utf8'));
    expect(Object.keys(snap)).toContain('newdir/deep/f.txt');
  });

  test('never records .gitignored paths', () => {
    const repo = mkRepo();
    write(repo, 'ignored.log', 'x');
    write(repo, 'build/out.js', 'x');
    const snap = JSON.parse(fs.readFileSync(snapshot(repo), 'utf8'));
    expect(Object.keys(snap)).toEqual([]);
  });

  test('overwrites an existing output file; clean tree gives no entries', () => {
    const repo = mkRepo();
    const out = path.join(mktmp(), 'baseline.json');
    fs.writeFileSync(out, 'garbage');
    const r = run(repo, 'snapshot', out);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(Object.keys(JSON.parse(fs.readFileSync(out, 'utf8')))).toEqual([]);
  });

  test('records a rename as old path (null) and new path (hash)', () => {
    const repo = mkRepo();
    git(repo, 'mv', 'a.txt', 'a2.txt');
    const snap = JSON.parse(fs.readFileSync(snapshot(repo), 'utf8'));
    expect(snap).toHaveProperty('a.txt', null);
    expect(snap['a2.txt']).toBe(git(repo, 'hash-object', 'a2.txt').trim());
  });
});

describe('sdlc-changes changed: candidate selection', () => {
  test('AC2: new, edited and deleted files after a snapshot are included', () => {
    const repo = mkRepo();
    const base = snapshot(repo);
    write(repo, 'new.txt', 'new\n');
    write(repo, 'a.txt', 'a edited\n');
    fs.rmSync(path.join(repo, 'b.txt'));
    expect(changed(repo, base)).toEqual({ include: ['a.txt', 'b.txt', 'new.txt'], skipped: [] });
  });

  test('AC2: staged changes made after the snapshot are included', () => {
    const repo = mkRepo();
    const base = snapshot(repo);
    write(repo, 'staged-new.txt', 'n\n');
    git(repo, 'add', 'staged-new.txt');
    write(repo, 'c.txt', 'c edit\n');
    git(repo, 'add', 'c.txt');
    expect(changed(repo, base).include).toEqual(['c.txt', 'staged-new.txt']);
  });

  test('AC3: dirty at baseline and unchanged since is in neither list', () => {
    const repo = mkRepo();
    write(repo, 'a.txt', 'dirty\n');
    write(repo, 'u.txt', 'untracked\n');
    fs.rmSync(path.join(repo, 'b.txt'));
    write(repo, 's.txt', 's\n');
    git(repo, 'add', 's.txt');
    const base = snapshot(repo);
    expect(changed(repo, base)).toEqual({ include: [], skipped: [] });
  });

  test('AC4: dirty at baseline and edited since is skipped as pre-existing', () => {
    const repo = mkRepo();
    write(repo, 'a.txt', 'dirty\n');
    write(repo, 'u.txt', 'untracked\n');
    const base = snapshot(repo);
    write(repo, 'a.txt', 'dirty and edited\n');
    write(repo, 'u.txt', 'untracked and edited\n');
    expect(changed(repo, base)).toEqual({
      include: [],
      skipped: [
        { path: 'a.txt', reason: 'pre-existing local changes' },
        { path: 'u.txt', reason: 'pre-existing local changes' },
      ],
    });
  });

  test('AC4: deleted at baseline then recreated is pre-existing; still deleted is dropped', () => {
    const repo = mkRepo();
    fs.rmSync(path.join(repo, 'a.txt'));
    fs.rmSync(path.join(repo, 'b.txt'));
    const base = snapshot(repo);
    write(repo, 'a.txt', 'back again\n');
    expect(changed(repo, base)).toEqual({
      include: [],
      skipped: [{ path: 'a.txt', reason: 'pre-existing local changes' }],
    });
  });

  test('a file whose content returns to the baseline hash is dropped', () => {
    const repo = mkRepo();
    write(repo, 'a.txt', 'dirty\n');
    const base = snapshot(repo);
    write(repo, 'a.txt', 'other\n');
    write(repo, 'a.txt', 'dirty\n');
    expect(changed(repo, base)).toEqual({ include: [], skipped: [] });
  });

  test('a clean tree after a clean snapshot gives empty lists', () => {
    const repo = mkRepo();
    expect(changed(repo, snapshot(repo))).toEqual({ include: [], skipped: [] });
  });

  test('relevant project paths are all included', () => {
    const repo = mkRepo();
    const base = snapshot(repo);
    const paths = [
      'scripts/x.sh', 'README.md', 'CLAUDE.md', 'AGENTS.md', '.gitlab-ci.yml', 'package.json',
      'package-lock.json', 'yarn.lock', 'Docs/backlog/s/specs-1.md', 'server/app.js',
      'Engineering/e.md', '.env.example', 'server/.env.example',
    ];
    for (const p of paths) write(repo, p);
    const res = changed(repo, base);
    expect(res.skipped).toEqual([]);
    expect([...res.include].sort()).toEqual([...paths].sort());
  });
});

describe('sdlc-changes changed: skip rules', () => {
  test('AC5: sensitive, configuration and generated files are skipped with their reasons', () => {
    const repo = mkRepo();
    const base = snapshot(repo);
    const expected = {
      '.env': 'sensitive file',
      '.env.local': 'sensitive file',
      '.env.production': 'sensitive file',
      'key.pem': 'sensitive file',
      'cert.key': 'sensitive file',
      'store.p12': 'sensitive file',
      'app.keystore': 'sensitive file',
      'id_rsa': 'sensitive file',
      'id_rsa.pub': 'sensitive file',
      '.vscode/x.json': 'local or agent configuration',
      '.idea/workspace.xml': 'local or agent configuration',
      '.claude/settings.json': 'local or agent configuration',
      'node_modules/x/index.js': 'generated',
      '.DS_Store': 'generated',
    };
    for (const p of Object.keys(expected)) write(repo, p);
    write(repo, '.env.example');
    const res = changed(repo, base);
    expect(reasons(res)).toEqual(expected);
    expect(res.include).toEqual(['.env.example']);
  });

  test('AC6: patterns match at any depth', () => {
    const repo = mkRepo();
    const base = snapshot(repo);
    const expected = {
      'server/.env': 'sensitive file',
      'server/.env.staging': 'sensitive file',
      'a/b/key.pem': 'sensitive file',
      'a/b/id_rsa': 'sensitive file',
      'client/.vscode/s.json': 'local or agent configuration',
      'Engineering/.claude/x': 'local or agent configuration',
      'server/.idea/y.xml': 'local or agent configuration',
      'server/node_modules/x': 'generated',
      'server/sub/.DS_Store': 'generated',
    };
    for (const p of Object.keys(expected)) write(repo, p);
    write(repo, 'server/.env.example');
    const res = changed(repo, base);
    expect(reasons(res)).toEqual(expected);
    expect(res.include).toEqual(['server/.env.example']);
  });

  test('look-alike names are not skipped', () => {
    const repo = mkRepo();
    const base = snapshot(repo);
    const paths = ['environment.js', 'server/env.txt', 'keys.md', 'monkey.js', 'vscode/x.json', 'claude/x.md', 'my_node_modules/x.js'];
    for (const p of paths) write(repo, p);
    const res = changed(repo, base);
    expect(res.skipped).toEqual([]);
    expect([...res.include].sort()).toEqual([...paths].sort());
  });

  test('AC7: over 1 MiB is skipped as too large; exactly 1 MiB is included', () => {
    const repo = mkRepo();
    const base = snapshot(repo);
    write(repo, 'big.bin', Buffer.alloc(MIB + 1, 1));
    write(repo, 'exact.bin', Buffer.alloc(MIB, 1));
    expect(changed(repo, base)).toEqual({
      include: ['exact.bin'],
      skipped: [{ path: 'big.bin', reason: 'too large' }],
    });
  });

  test('AC7: a deleted large file is included, never too large', () => {
    const repo = mkRepo({ 'big.bin': Buffer.alloc(MIB + 10, 1) });
    const base = snapshot(repo);
    fs.rmSync(path.join(repo, 'big.bin'));
    expect(changed(repo, base)).toEqual({ include: ['big.bin'], skipped: [] });
  });

  test('AC8: precedence between rules', () => {
    const repo = mkRepo({ 'server/.env': 'v1\n', 'huge.bin': Buffer.alloc(10, 1) });
    // Dirty at baseline: both files edited before the snapshot.
    write(repo, 'server/.env', 'v2\n');
    write(repo, 'huge.bin', Buffer.alloc(MIB + 5, 2));
    const base = snapshot(repo);
    write(repo, 'server/.env', 'v3\n'); // sensitive beats pre-existing
    write(repo, 'huge.bin', Buffer.alloc(MIB + 5, 3)); // pre-existing beats too large
    write(repo, 'big.pem', Buffer.alloc(2 * MIB, 1)); // sensitive beats too large
    write(repo, '.claude/big.bin', Buffer.alloc(2 * MIB, 1)); // config beats too large
    write(repo, 'node_modules/.env', 'x'); // sensitive beats generated
    write(repo, '.vscode/.env', 'x'); // sensitive beats config
    write(repo, '.claude/node_modules/x.js', 'x'); // config beats generated
    expect(reasons(changed(repo, base))).toEqual({
      'server/.env': 'sensitive file',
      'huge.bin': 'pre-existing local changes',
      'big.pem': 'sensitive file',
      '.claude/big.bin': 'local or agent configuration',
      'node_modules/.env': 'sensitive file',
      '.vscode/.env': 'sensitive file',
      '.claude/node_modules/x.js': 'local or agent configuration',
    });
  });

  test('AC9: .gitignored files are never listed', () => {
    const repo = mkRepo();
    const base = snapshot(repo);
    write(repo, 'ignored.log', 'x');
    write(repo, 'build/out.js', 'x');
    write(repo, 'kept.txt', 'x');
    expect(changed(repo, base)).toEqual({ include: ['kept.txt'], skipped: [] });
  });

  test('AC10: a rename is one delete (old path) plus one add (new path)', () => {
    const repo = mkRepo();
    const base = snapshot(repo);
    git(repo, 'mv', 'a.txt', 'renamed.txt');
    expect(changed(repo, base)).toEqual({ include: ['a.txt', 'renamed.txt'], skipped: [] });
  });

  test('AC10: an unstaged move (delete + untracked) gives the same result', () => {
    const repo = mkRepo();
    const base = snapshot(repo);
    fs.renameSync(path.join(repo, 'a.txt'), path.join(repo, 'moved.txt'));
    expect(changed(repo, base)).toEqual({ include: ['a.txt', 'moved.txt'], skipped: [] });
  });

  test('a rename into a skipped location only skips the new path', () => {
    const repo = mkRepo();
    const base = snapshot(repo);
    fs.mkdirSync(path.join(repo, '.claude'));
    git(repo, 'mv', 'a.txt', '.claude/a.txt');
    expect(changed(repo, base)).toEqual({
      include: ['a.txt'],
      skipped: [{ path: '.claude/a.txt', reason: 'local or agent configuration' }],
    });
  });

  test('paths with spaces are handled', () => {
    const repo = mkRepo();
    const base = snapshot(repo);
    write(repo, 'server/my file.js', 'x');
    expect(changed(repo, base).include).toEqual(['server/my file.js']);
  });
});

describe('sdlc-changes changed: ordering', () => {
  test('lists are sorted by byte order and have no duplicates across lists', () => {
    const repo = mkRepo();
    const base = snapshot(repo);
    for (const p of ['b/z.txt', 'B.txt', 'a/b.txt', 'a.txt2', 'Z.txt', '_x.txt']) write(repo, p);
    write(repo, 'server/.env', 'x');
    write(repo, 'a/.env', 'x');
    write(repo, '.env', 'x');
    const res = changed(repo, base);
    const byteSorted = list => [...list].sort((x, y) => Buffer.compare(Buffer.from(x), Buffer.from(y)));
    expect(res.include).toEqual(byteSorted(res.include));
    const sk = res.skipped.map(s => s.path);
    expect(sk).toEqual(byteSorted(sk));
    const all = [...res.include, ...sk];
    expect(new Set(all).size).toBe(all.length);
    expect(res.include).toEqual(['B.txt', 'Z.txt', '_x.txt', 'a.txt2', 'a/b.txt', 'b/z.txt']);
  });

  test('stdout is a single JSON line and nothing else', () => {
    const repo = mkRepo();
    const base = snapshot(repo);
    write(repo, 'n.txt');
    const r = run(repo, 'changed', base);
    expect(r.stdout.endsWith('\n')).toBe(true);
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
    expect(Object.keys(JSON.parse(r.stdout)).sort()).toEqual(['include', 'skipped']);
  });
});

describe('sdlc-changes errors (AC11)', () => {
  const expectFailure = r => {
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr.trim().length).toBeGreaterThan(0);
    expect(r.stderr.trim().split('\n')).toHaveLength(1);
  };

  test('no subcommand', () => {
    expectFailure(run(mkRepo()));
  });

  test('unknown subcommand', () => {
    expectFailure(run(mkRepo(), 'frobnicate', 'x'));
  });

  test('changed without a baseline argument', () => {
    expectFailure(run(mkRepo(), 'changed'));
  });

  test('snapshot without an output argument', () => {
    expectFailure(run(mkRepo(), 'snapshot'));
  });

  test('missing baseline file is not treated as empty', () => {
    const repo = mkRepo();
    write(repo, 'n.txt');
    expectFailure(run(repo, 'changed', path.join(mktmp(), 'nope.json')));
  });

  test('baseline that is not JSON', () => {
    const repo = mkRepo();
    const f = path.join(mktmp(), 'b.json');
    fs.writeFileSync(f, 'not json {');
    expectFailure(run(repo, 'changed', f));
  });

  test('baseline that is JSON of the wrong shape', () => {
    const repo = mkRepo();
    for (const body of ['[]', '"x"', '5', 'null', '{"a.txt": 5}']) {
      const f = path.join(mktmp(), 'b.json');
      fs.writeFileSync(f, body);
      expectFailure(run(repo, 'changed', f));
    }
  });

  test('baseline path that is a directory', () => {
    expectFailure(run(mkRepo(), 'changed', mktmp()));
  });

  test('changed outside a git work tree', () => {
    const base = snapshot(mkRepo());
    expectFailure(run(mktmp(), 'changed', base));
  });

  test('snapshot outside a git work tree', () => {
    expectFailure(run(mktmp(), 'snapshot', path.join(mktmp(), 'b.json')));
  });

  test('snapshot to an unwritable output path', () => {
    const repo = mkRepo();
    expectFailure(run(repo, 'snapshot', path.join(mktmp(), 'no-such-dir', 'b.json')));
  });
});
