const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const helper = path.resolve(__dirname, '../../../scripts/sdlc-changes.cjs');

function git(dir, ...args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
}
function write(dir, rel, content = 'x\n') {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
}
function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-changes-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  write(dir, 'tracked.txt', 'one\n');
  write(dir, 'other.txt', 'one\n');
  write(dir, '.gitignore', 'ignored.log\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}
const baseFile = dir => path.join(`${dir}-baseline`, 'baseline.json');
const run = (dir, cmd) => spawnSync('node', [helper, cmd, baseFile(dir)], { cwd: dir, encoding: 'utf8' });
const snapshot = dir => { const r = run(dir, 'snapshot'); expect(r.status).toBe(0); };
const changed = dir => { const r = run(dir, 'changed'); expect(r.status).toBe(0); return JSON.parse(r.stdout); };
const reasons = res => Object.fromEntries(res.skipped.map(s => [s.path, s.reason]));

describe('sdlc-changes snapshot', () => {
  test('records modified, untracked, deleted and staged paths with hashes', () => {
    const dir = tmpRepo();
    write(dir, 'tracked.txt', 'edited\n');
    write(dir, 'new/untracked.txt', 'u\n');
    fs.unlinkSync(path.join(dir, 'other.txt'));
    write(dir, 'staged.txt', 's\n');
    git(dir, 'add', 'staged.txt');
    snapshot(dir);
    const snap = JSON.parse(fs.readFileSync(baseFile(dir), 'utf8'));
    expect(Object.keys(snap).sort()).toEqual(['new/untracked.txt', 'other.txt', 'staged.txt', 'tracked.txt']);
    expect(snap['other.txt']).toBeNull();
    expect(snap['tracked.txt']).toBe(git(dir, 'hash-object', 'tracked.txt').trim());
  });
});

describe('sdlc-changes changed', () => {
  test('new, edited and deleted files since the snapshot are included', () => {
    const dir = tmpRepo();
    snapshot(dir);
    write(dir, 'scripts/new.sh');
    write(dir, 'tracked.txt', 'edited\n');
    fs.unlinkSync(path.join(dir, 'other.txt'));
    const res = changed(dir);
    expect(res.include.sort()).toEqual(['other.txt', 'scripts/new.sh', 'tracked.txt']);
    expect(res.skipped).toEqual([]);
  });

  test('a file dirty before the run and unchanged is in neither list', () => {
    const dir = tmpRepo();
    write(dir, 'tracked.txt', 'dirty\n');
    write(dir, 'untracked.txt');
    snapshot(dir);
    expect(changed(dir)).toEqual({ include: [], skipped: [] });
  });

  test('a file dirty before the run and edited again is skipped as pre-existing', () => {
    const dir = tmpRepo();
    write(dir, 'tracked.txt', 'dirty\n');
    snapshot(dir);
    write(dir, 'tracked.txt', 'dirty and edited\n');
    const res = changed(dir);
    expect(res.include).toEqual([]);
    expect(res.skipped).toEqual([{ path: 'tracked.txt', reason: 'pre-existing local changes' }]);
  });

  test('secrets, editor and agent config and generated files are skipped with the right reason', () => {
    const dir = tmpRepo();
    snapshot(dir);
    const files = ['.env', '.env.local', 'server/.env', '.vscode/x.json', '.idea/y.xml', '.claude/settings.json',
      'key.pem', 'a.key', 'b.p12', 'id_rsa', 'id_rsa.pub', 'c.keystore', 'node_modules/x/index.js', '.DS_Store', '.env.example'];
    files.forEach(f => write(dir, f));
    const res = changed(dir);
    expect(res.include).toEqual(['.env.example']);
    expect(reasons(res)).toEqual({
      '.env': 'sensitive file', '.env.local': 'sensitive file', 'server/.env': 'sensitive file',
      'key.pem': 'sensitive file', 'a.key': 'sensitive file', 'b.p12': 'sensitive file',
      'id_rsa': 'sensitive file', 'id_rsa.pub': 'sensitive file', 'c.keystore': 'sensitive file',
      '.vscode/x.json': 'local or agent configuration', '.idea/y.xml': 'local or agent configuration',
      '.claude/settings.json': 'local or agent configuration',
      'node_modules/x/index.js': 'generated', '.DS_Store': 'generated',
    });
  });

  test('a file over 1 MiB is skipped as too large', () => {
    const dir = tmpRepo();
    snapshot(dir);
    write(dir, 'big.bin', Buffer.alloc(1024 * 1024 + 1));
    write(dir, 'small.bin', Buffer.alloc(1024));
    const res = changed(dir);
    expect(res.include).toEqual(['small.bin']);
    expect(res.skipped).toEqual([{ path: 'big.bin', reason: 'too large' }]);
  });

  test('a .gitignored file is never listed', () => {
    const dir = tmpRepo();
    snapshot(dir);
    write(dir, 'ignored.log');
    expect(changed(dir)).toEqual({ include: [], skipped: [] });
  });

  test('a rename appears as one delete and one add', () => {
    const dir = tmpRepo();
    snapshot(dir);
    git(dir, 'mv', 'tracked.txt', 'renamed.txt');
    expect(changed(dir).include.sort()).toEqual(['renamed.txt', 'tracked.txt']);
  });

  test('a missing baseline file exits 1', () => {
    const dir = tmpRepo();
    expect(run(dir, 'changed').status).toBe(1);
  });
});
