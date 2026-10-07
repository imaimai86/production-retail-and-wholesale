const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const script = path.resolve(__dirname, '../../../scripts/sdlc-changes.cjs');

const tmpRoots = [];
function git(root, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}
function write(root, rel, text = 'x\n') {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}
function mkRepo(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-changes-'));
  tmpRoots.push(root);
  git(root, 'init', '-q');
  write(root, '.gitignore', 'ignored.txt\nlogs/\n');
  for (const [rel, text] of Object.entries(files)) write(root, rel, text);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}
function run(root, ...args) {
  return spawnSync('node', [script, ...args], { cwd: root, encoding: 'utf8' });
}
const snapshot = root => {
  const file = path.join(root, 'logs', 'baseline.json');
  const r = run(root, 'snapshot', file);
  expect(r.status).toBe(0);
  return file;
};
function changed(root, baseline) {
  const r = run(root, 'changed', baseline);
  expect(r.status).toBe(0);
  return JSON.parse(r.stdout);
}

afterAll(() => tmpRoots.forEach(r => fs.rmSync(r, { recursive: true, force: true })));

describe('scripts/sdlc-changes.cjs', () => {
  test('usage errors exit 2', () => {
    const root = mkRepo();
    expect(run(root).status).toBe(2);
    expect(run(root, 'bogus', 'x').status).toBe(2);
    expect(run(root, 'snapshot').status).toBe(2);
  });

  test('snapshot records modified, untracked, deleted and staged paths with hashes', () => {
    const root = mkRepo({ 'a.txt': '1\n', 'b.txt': '2\n', 'c.txt': '3\n' });
    write(root, 'a.txt', 'changed\n');
    fs.rmSync(path.join(root, 'b.txt'));
    write(root, 'new/u.txt', 'untracked\n');
    write(root, 'staged.txt', 'staged\n');
    git(root, 'add', 'staged.txt');
    write(root, 'ignored.txt');
    const snap = JSON.parse(fs.readFileSync(snapshot(root), 'utf8'));
    expect(Object.keys(snap).sort()).toEqual(['a.txt', 'b.txt', 'new/u.txt', 'staged.txt']);
    expect(snap['b.txt']).toBeNull();
    for (const p of ['a.txt', 'new/u.txt', 'staged.txt']) expect(snap[p]).toMatch(/^[0-9a-f]{40}$/);
  });

  test('a new file, an edited tracked file and a deleted tracked file are included', () => {
    const root = mkRepo({ 'a.txt': '1\n', 'b.txt': '2\n' });
    const base = snapshot(root);
    write(root, 'scripts/new.sh');
    write(root, 'a.txt', 'edited\n');
    fs.rmSync(path.join(root, 'b.txt'));
    const r = changed(root, base);
    expect(r.include).toEqual(['a.txt', 'b.txt', 'scripts/new.sh']);
    expect(r.skipped).toEqual([]);
  });

  test('a file that was dirty and is unchanged is in neither list', () => {
    const root = mkRepo({ 'a.txt': '1\n' });
    write(root, 'a.txt', 'dirty\n');
    write(root, 'u.txt', 'untracked\n');
    const base = snapshot(root);
    expect(changed(root, base)).toEqual({ include: [], skipped: [] });
  });

  test('a file that was dirty and then edited is skipped as pre-existing local changes', () => {
    const root = mkRepo({ 'a.txt': '1\n' });
    write(root, 'a.txt', 'dirty\n');
    const base = snapshot(root);
    write(root, 'a.txt', 'dirty and edited\n');
    expect(changed(root, base)).toEqual({
      include: [],
      skipped: [{ path: 'a.txt', reason: 'pre-existing local changes' }],
    });
  });

  test('secrets, local config and generated files are skipped with the right reason; .env.example is included', () => {
    const root = mkRepo();
    const base = snapshot(root);
    for (const p of ['.env', 'server/.env', '.env.local', 'key.pem', 'id_rsa', 'a.p12', 'a.keystore', 'b.key']) write(root, p);
    for (const p of ['.vscode/x.json', '.idea/y.xml', '.claude/settings.json']) write(root, p);
    for (const p of ['node_modules/x/index.js', '.DS_Store']) write(root, p);
    write(root, '.env.example');
    const r = changed(root, base);
    expect(r.include).toEqual(['.env.example']);
    const reasons = Object.fromEntries(r.skipped.map(s => [s.path, s.reason]));
    for (const p of ['.env', 'server/.env', '.env.local', 'key.pem', 'id_rsa', 'a.p12', 'a.keystore', 'b.key']) expect(reasons[p]).toBe('sensitive file');
    for (const p of ['.vscode/x.json', '.idea/y.xml', '.claude/settings.json']) expect(reasons[p]).toBe('local or agent configuration');
    for (const p of ['node_modules/x/index.js', '.DS_Store']) expect(reasons[p]).toBe('generated');
  });

  test('relevant files outside server/ are included', () => {
    const root = mkRepo();
    const base = snapshot(root);
    const files = ['scripts/sdlc.sh', 'README.md', 'CLAUDE.md', 'AGENTS.md', '.gitlab-ci.yml', 'package.json', 'package-lock.json', 'Docs/x.md', 'server/a.js', 'Engineering/bugs.md'];
    files.forEach(f => write(root, f));
    expect(changed(root, base).include).toEqual([...files].sort());
  });

  test('a file over 1 MiB is skipped as too large', () => {
    const root = mkRepo();
    const base = snapshot(root);
    write(root, 'big.bin', 'a'.repeat(1024 * 1024 + 1));
    write(root, 'ok.bin', 'a'.repeat(1024 * 1024));
    const r = changed(root, base);
    expect(r.include).toEqual(['ok.bin']);
    expect(r.skipped).toEqual([{ path: 'big.bin', reason: 'too large' }]);
  });

  test('a gitignored file is never listed', () => {
    const root = mkRepo();
    const base = snapshot(root);
    write(root, 'ignored.txt');
    write(root, 'logs/run.out');
    expect(changed(root, base)).toEqual({ include: [], skipped: [] });
  });

  test('a rename appears as one delete and one add', () => {
    const root = mkRepo({ 'old.txt': 'content\n' });
    const base = snapshot(root);
    git(root, 'mv', 'old.txt', 'new.txt');
    expect(changed(root, base).include).toEqual(['new.txt', 'old.txt']);
  });
});
