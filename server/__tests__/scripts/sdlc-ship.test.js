const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const scriptsDir = path.resolve(__dirname, '../../../scripts');
const ship = path.join(scriptsDir, 'sdlc-ship.sh');
const changes = path.join(scriptsDir, 'sdlc-changes.cjs');

const SLUG = 'demo';
const DOCS = `Docs/backlog/${SLUG}`;
const BASELINE = `${DOCS}/logs/baseline.json`;
const BACKLOG = 'Docs/backlog/index.md';
const INDEX = `- [ ] \`${SLUG}\` - Feature: demo\n- [ ] \`other\` - Feature: other\n`;

const tmpRoots = [];
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
function git(root, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: root, encoding: 'utf8', env });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}
function write(root, rel, text = 'x\n') {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
function mkRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-ship-'));
  tmpRoots.push(root);
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'user.email', 't@example.com');
  write(root, '.gitignore', 'Docs/backlog/*/logs/\n');
  write(root, BACKLOG, INDEX);
  write(root, `${DOCS}/brief.md`, 'brief\n');
  write(root, 'server/app.js', 'v1\n');
  write(root, 'README.md', 'readme\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}
const baseline = root => {
  const r = spawnSync('node', [changes, 'snapshot', path.join(root, BASELINE)], { cwd: root, encoding: 'utf8', env });
  expect(r.status).toBe(0);
};
const runShip = root => spawnSync('bash', [ship, SLUG, DOCS, BASELINE, BACKLOG], { cwd: root, encoding: 'utf8', env });
const subjects = root => git(root, 'log', '--format=%s').trim().split('\n');
const filesOf = (root, rev) => git(root, 'show', '--name-only', '--format=', rev).trim().split('\n').filter(Boolean).sort();

afterAll(() => tmpRoots.forEach(r => fs.rmSync(r, { recursive: true, force: true })));

describe('scripts/sdlc-ship.sh', () => {
  test('commits changes in scripts/, README.md and server/ in one feat commit whose body lists them', () => {
    const root = mkRepo();
    baseline(root);
    write(root, 'scripts/tool.sh');
    write(root, 'README.md', 'edited\n');
    write(root, 'server/app.js', 'v2\n');
    write(root, `${DOCS}/review-1.md`, 'review\n');
    const r = runShip(root);
    expect(r.status).toBe(0);
    expect(subjects(root).slice(0, 2)).toEqual([`chore(backlog): mark ${SLUG} done`, `feat(${SLUG}): implement per ${DOCS}/specs-1.md`]);
    const expected = [`${DOCS}/review-1.md`, 'README.md', 'scripts/tool.sh', 'server/app.js'].sort();
    expect(filesOf(root, 'HEAD~1')).toEqual(expected);
    const body = git(root, 'log', '-1', '--format=%b', 'HEAD~1');
    for (const f of expected) expect(body).toContain(f);
    expect(git(root, 'status', '--short')).toBe('');
    expect(read(root, BACKLOG)).toContain(`- [x] \`${SLUG}\``);
    expect(read(root, BACKLOG)).toContain('- [ ] `other`');
  });

  test('deleted files are committed', () => {
    const root = mkRepo();
    baseline(root);
    fs.rmSync(path.join(root, 'README.md'));
    expect(runShip(root).status).toBe(0);
    expect(filesOf(root, 'HEAD~1')).toEqual(['README.md']);
    expect(fs.existsSync(path.join(root, 'README.md'))).toBe(false);
  });

  test('pre-existing untracked and modified files stay uncommitted and untouched', () => {
    const root = mkRepo();
    write(root, 'notes.txt', 'mine\n');
    write(root, 'README.md', 'my edit\n');
    baseline(root);
    write(root, 'server/app.js', 'v2\n');
    expect(runShip(root).status).toBe(0);
    expect(filesOf(root, 'HEAD~1')).toEqual(['server/app.js']);
    expect(read(root, 'notes.txt')).toBe('mine\n');
    expect(read(root, 'README.md')).toBe('my edit\n');
    expect(git(root, 'status', '--short').trimEnd().split('\n').sort()).toEqual([' M README.md', '?? notes.txt']);
  });

  test('something the developer staged beforehand is not committed and stays staged', () => {
    const root = mkRepo();
    write(root, 'staged.txt', 'staged\n');
    git(root, 'add', 'staged.txt');
    baseline(root);
    write(root, 'server/app.js', 'v2\n');
    expect(runShip(root).status).toBe(0);
    expect(filesOf(root, 'HEAD~1')).toEqual(['server/app.js']);
    expect(git(root, 'diff', '--cached', '--name-only').trim()).toBe('staged.txt');
  });

  test('a .env left in server/ is not committed and appears in ship-skipped.md', () => {
    const root = mkRepo();
    baseline(root);
    write(root, 'server/app.js', 'v2\n');
    write(root, 'server/.env', 'SECRET=1\n');
    expect(runShip(root).status).toBe(0);
    expect(filesOf(root, 'HEAD~1')).toEqual(['server/app.js']);
    expect(read(root, `${DOCS}/logs/ship-skipped.md`)).toContain('server/.env: sensitive file');
    expect(fs.existsSync(path.join(root, 'server/.env'))).toBe(true);
  });

  test('no cycle changes warns, makes no feat commit and exits 0', () => {
    const root = mkRepo();
    baseline(root);
    const r = runShip(root);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('WARNING: nothing to commit');
    expect(subjects(root).some(s => s.startsWith('feat('))).toBe(false);
    expect(r.stdout).toContain(`DONE: ${SLUG}`);
  });

  test('a slug missing from the backlog warns, makes no backlog commit and exits 0', () => {
    const root = mkRepo();
    write(root, BACKLOG, '- [ ] `other` - Feature: other\n');
    git(root, 'commit', '-q', '-am', 'drop slug');
    baseline(root);
    write(root, 'server/app.js', 'v2\n');
    const r = runShip(root);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`WARNING: ${SLUG} not found in ${BACKLOG}; not ticked`);
    expect(subjects(root).some(s => s.startsWith('chore(backlog)'))).toBe(false);
    expect(subjects(root)[0]).toBe(`feat(${SLUG}): implement per ${DOCS}/specs-1.md`);
  });

  test('a backlog file that was dirty at baseline is ticked but not committed', () => {
    const root = mkRepo();
    write(root, BACKLOG, `${INDEX}- [ ] \`mine\` - Feature: my own entry\n`);
    baseline(root);
    write(root, 'server/app.js', 'v2\n');
    const r = runShip(root);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('WARNING');
    expect(read(root, BACKLOG)).toContain(`- [x] \`${SLUG}\``);
    expect(subjects(root).some(s => s.startsWith('chore(backlog)'))).toBe(false);
    expect(git(root, 'status', '--short').trimEnd()).toBe(` M ${BACKLOG}`);
  });

  test('the final line reports the committed and skipped counts', () => {
    const root = mkRepo();
    baseline(root);
    write(root, 'server/app.js', 'v2\n');
    write(root, 'scripts/tool.sh');
    write(root, '.env');
    const r = runShip(root);
    const last = r.stdout.trim().split('\n').pop();
    expect(last).toMatch(new RegExp(`^DONE: ${SLUG} on \\S+\\. Committed 2 file\\(s\\), skipped 1 \\(see .*ship-skipped\\.md\\)\\.$`));
  });

  test('a failing git commit exits 1 with the git error', () => {
    const root = mkRepo();
    baseline(root);
    write(root, 'server/app.js', 'v2\n');
    const r = spawnSync('bash', [ship, SLUG, DOCS, BASELINE, BACKLOG], {
      cwd: root, encoding: 'utf8', env: { ...env, GIT_AUTHOR_NAME: '', GIT_COMMITTER_NAME: '', GIT_AUTHOR_EMAIL: '', GIT_COMMITTER_EMAIL: '' },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/ident|identity|empty/i);
  });
});
