const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const helper = path.join(root, 'scripts/sdlc-changes.cjs');
const ship = path.join(root, 'scripts/sdlc-ship.sh');
const SLUG = 'alpha';
const DOCS = `Docs/backlog/${SLUG}`;
const BACKLOG = 'Docs/backlog/index.md';

function git(dir, ...args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
}
function write(dir, rel, content = 'x\n') {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
}
function tmpRepo(backlog = `# Backlog\n- [ ] \`${SLUG}\` - Feature: thing\n`) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-ship-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  write(dir, '.gitignore', 'Docs/backlog/*/logs/\n');
  write(dir, BACKLOG, backlog);
  write(dir, 'README.md', 'readme\n');
  write(dir, 'server/app.js', 'a\n');
  write(dir, 'dev.txt', 'dev\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}
const baseline = dir => {
  const f = path.join(dir, DOCS, 'logs/baseline.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  expect(spawnSync('node', [helper, 'snapshot', f], { cwd: dir }).status).toBe(0);
};
const runShip = (dir, env = {}) => spawnSync('bash', [ship, SLUG, DOCS, `${DOCS}/logs/baseline.json`, BACKLOG],
  { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
const subjects = dir => git(dir, 'log', '--format=%s').trim().split('\n');
const files = (dir, rev) => git(dir, 'show', '--name-only', '--format=', rev).trim().split('\n').sort();

describe('scripts/sdlc-ship.sh', () => {
  test('changes in scripts/, README.md and server/ go into one feat commit that lists them', () => {
    const dir = tmpRepo();
    baseline(dir);
    write(dir, 'scripts/x.sh');
    write(dir, 'README.md', 'changed\n');
    write(dir, 'server/app.js', 'b\n');
    write(dir, `${DOCS}/specs-1.md`);
    const r = runShip(dir);
    expect(r.status).toBe(0);
    expect(subjects(dir)).toEqual([`chore(backlog): mark ${SLUG} done`, `feat(${SLUG}): implement per ${DOCS}/specs-1.md`, 'init']);
    expect(files(dir, 'HEAD~1')).toEqual([`${DOCS}/specs-1.md`, 'README.md', 'scripts/x.sh', 'server/app.js']);
    const body = git(dir, 'log', '-1', '--format=%b', 'HEAD~1');
    ['scripts/x.sh', 'README.md', 'server/app.js'].forEach(f => expect(body).toContain(f));
    expect(fs.readFileSync(path.join(dir, BACKLOG), 'utf8')).toContain(`- [x] \`${SLUG}\``);
    expect(git(dir, 'status', '--porcelain')).toBe('');
  });

  test("the developer's own uncommitted work stays uncommitted and untouched", () => {
    const dir = tmpRepo();
    write(dir, 'dev.txt', 'dirty\n');
    write(dir, 'wip.txt', 'wip\n');
    baseline(dir);
    write(dir, 'server/app.js', 'b\n');
    expect(runShip(dir).status).toBe(0);
    expect(files(dir, 'HEAD~1')).toEqual(['server/app.js']);
    expect(fs.readFileSync(path.join(dir, 'dev.txt'), 'utf8')).toBe('dirty\n');
    expect(fs.readFileSync(path.join(dir, 'wip.txt'), 'utf8')).toBe('wip\n');
    expect(git(dir, 'status', '--porcelain').split('\n').filter(Boolean).sort()).toEqual([' M dev.txt', '?? wip.txt']);
  });

  test('something the developer staged beforehand is not committed and stays staged', () => {
    const dir = tmpRepo();
    write(dir, 'staged.txt', 's\n');
    git(dir, 'add', 'staged.txt');
    baseline(dir);
    write(dir, 'server/app.js', 'b\n');
    expect(runShip(dir).status).toBe(0);
    expect(files(dir, 'HEAD~1')).toEqual(['server/app.js']);
    expect(git(dir, 'status', '--porcelain').trim()).toBe('A  staged.txt');
  });

  test('a deleted file is committed as a deletion', () => {
    const dir = tmpRepo();
    baseline(dir);
    fs.unlinkSync(path.join(dir, 'dev.txt'));
    expect(runShip(dir).status).toBe(0);
    expect(git(dir, 'show', '--name-status', '--format=', 'HEAD~1').trim()).toBe('D\tdev.txt');
  });

  test('.env is not committed and appears in ship-skipped.md', () => {
    const dir = tmpRepo();
    baseline(dir);
    write(dir, 'server/.env', 'SECRET=1\n');
    write(dir, 'server/app.js', 'b\n');
    const r = runShip(dir);
    expect(r.status).toBe(0);
    expect(files(dir, 'HEAD~1')).toEqual(['server/app.js']);
    const skipped = fs.readFileSync(path.join(dir, DOCS, 'logs/ship-skipped.md'), 'utf8');
    expect(skipped).toContain('server/.env: sensitive file');
    expect(r.stdout).toContain('server/.env: sensitive file');
  });

  test('no cycle changes: warning, no feat commit, exit 0', () => {
    const dir = tmpRepo();
    baseline(dir);
    const r = runShip(dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('WARNING: nothing to commit');
    expect(subjects(dir).some(s => s.startsWith('feat('))).toBe(false);
    expect(r.stdout).toContain('Committed 0 file(s), skipped 0');
  });

  test('a slug missing from the backlog warns, makes no backlog commit and exits 0', () => {
    const dir = tmpRepo('# Backlog\n- [ ] `other` - Feature: y\n');
    baseline(dir);
    write(dir, 'server/app.js', 'b\n');
    const r = runShip(dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`WARNING: ${SLUG} not found in ${BACKLOG}; not ticked`);
    expect(subjects(dir)).toEqual([`feat(${SLUG}): implement per ${DOCS}/specs-1.md`, 'init']);
  });

  test('a backlog file that was dirty at baseline is ticked but not committed', () => {
    const dir = tmpRepo();
    write(dir, BACKLOG, `# Backlog\n- [ ] \`${SLUG}\` - Feature: thing\n- [ ] \`next\` - Feature: n\n`);
    baseline(dir);
    write(dir, 'server/app.js', 'b\n');
    const r = runShip(dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('WARNING');
    expect(subjects(dir)).toEqual([`feat(${SLUG}): implement per ${DOCS}/specs-1.md`, 'init']);
    expect(fs.readFileSync(path.join(dir, BACKLOG), 'utf8')).toContain(`- [x] \`${SLUG}\``);
    expect(git(dir, 'status', '--porcelain')).toBe(` M ${BACKLOG}\n`);
  });

  test('the final line reports the counts', () => {
    const dir = tmpRepo();
    baseline(dir);
    write(dir, 'server/app.js', 'b\n');
    write(dir, 'README.md', 'c\n');
    write(dir, '.env', 'S=1\n');
    const last = runShip(dir).stdout.trim().split('\n').pop();
    expect(last).toBe(`DONE: ${SLUG} on ${git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim()}. Committed 2 file(s), skipped 1 (see ${DOCS}/logs/ship-skipped.md).`);
  });

  test('a failing git commit exits 1 with the git error', () => {
    const dir = tmpRepo();
    baseline(dir);
    write(dir, 'server/app.js', 'b\n');
    git(dir, 'config', 'user.useConfigOnly', 'true');
    git(dir, 'config', '--unset', 'user.email');
    const r = runShip(dir, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', EMAIL: '', HOME: dir });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/identity|email|author/i);
    expect(subjects(dir)).toEqual(['init']);
  });
});
