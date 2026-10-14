const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const sh = (dir, cmd, args, env) => spawnSync(cmd, args, { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
const write = (dir, f, text = 'x\n') => {
  fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
  fs.writeFileSync(path.join(dir, f), text);
};

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-ship-'));
  sh(dir, 'git', ['init', '-q']);
  sh(dir, 'git', ['config', 'user.email', 't@t']);
  sh(dir, 'git', ['config', 'user.name', 't']);
  fs.mkdirSync(path.join(dir, 'scripts'));
  for (const f of ['sdlc-ship.sh', 'sdlc-changes.cjs']) fs.copyFileSync(path.join(root, 'scripts', f), path.join(dir, 'scripts', f));
  write(dir, '.gitignore', '.env\nserver/.env\nDocs/backlog/*/logs/\n');
  write(dir, 'Docs/backlog/index.md', '- [ ] `alpha` - thing\n');
  write(dir, 'Docs/backlog/alpha/brief.md');
  write(dir, 'README.md', 'r\n');
  write(dir, 'dev.txt', 'dev\n');
  sh(dir, 'git', ['add', '-A']);
  sh(dir, 'git', ['commit', '-q', '-m', 'init']);
  return dir;
}
const baseline = dir => sh(dir, 'node', ['scripts/sdlc-changes.cjs', 'snapshot', 'Docs/backlog/alpha/logs/baseline.json']);
const ship = (dir, env) => sh(dir, 'bash', ['scripts/sdlc-ship.sh', 'alpha', 'Docs/backlog/alpha', 'Docs/backlog/alpha/logs/baseline.json', 'Docs/backlog/index.md'], env);
const log = dir => sh(dir, 'git', ['log', '--format=%s']).stdout.trim().split('\n');

describe('scripts/sdlc-ship.sh', () => {
  test('commits changes anywhere in one feat commit, lists them in the body, and ticks the backlog in its own commit', () => {
    const dir = repo();
    baseline(dir);
    write(dir, 'scripts/new.sh');
    write(dir, 'README.md', 'changed\n');
    write(dir, 'server/a.js');
    const r = ship(dir);
    expect(r.status).toBe(0);
    expect(log(dir)[0]).toBe('chore(backlog): mark alpha done');
    expect(log(dir)[1]).toBe('feat(alpha): implement per Docs/backlog/alpha/specs-1.md');
    const body = sh(dir, 'git', ['log', '-2', '--format=%b']).stdout;
    for (const f of ['scripts/new.sh', 'README.md', 'server/a.js']) expect(body).toContain(f);
    expect(sh(dir, 'git', ['status', '--porcelain']).stdout).toBe('');
    expect(r.stdout).toContain('DONE: alpha on');
    expect(r.stdout).toContain('Committed 3 file(s), skipped 0');
  });

  test('files dirty or staged before the run stay as they were; .env.local is skipped and listed; new .env keys reach .env.example as placeholders', () => {
    const dir = repo();
    write(dir, 'mine.txt', 'untracked\n');
    write(dir, 'dev.txt', 'modified\n');
    write(dir, 'staged.txt');
    sh(dir, 'git', ['add', 'staged.txt']);
    write(dir, '.env', 'A=1\n');
    baseline(dir);
    write(dir, 'server/a.js');
    write(dir, 'server/.env.local', 'SECRET=1\n');
    write(dir, '.env', 'A=1\nTOKEN=topsecret\n');
    const r = ship(dir);
    expect(r.status).toBe(0);

    // pre-existing dirty files stay uncommitted and untouched; what the developer staged stays staged
    expect(fs.readFileSync(path.join(dir, 'mine.txt'), 'utf8')).toBe('untracked\n');
    expect(fs.readFileSync(path.join(dir, 'dev.txt'), 'utf8')).toBe('modified\n');
    expect(sh(dir, 'git', ['status', '--porcelain']).stdout.split('\n').filter(Boolean).sort())
      .toEqual([' M dev.txt', '?? mine.txt', '?? server/.env.local', 'A  staged.txt'].sort());
    expect(sh(dir, 'git', ['show', '--name-only', '--format=', 'HEAD~1']).stdout).not.toContain('staged.txt');

    // .env.local is not committed and appears in ship-skipped.md
    expect(sh(dir, 'git', ['ls-files']).stdout).not.toContain('.env.local');
    expect(fs.readFileSync(path.join(dir, 'Docs/backlog/alpha/logs/ship-skipped.md'), 'utf8')).toContain('server/.env.local: sensitive file');
    expect(r.stdout).toContain('skipped 1');

    // new keys in the git-ignored .env
    const committed = sh(dir, 'git', ['show', 'HEAD~1:.env.example']).stdout;
    expect(committed).toContain('TOKEN=change-me');
    expect(committed).not.toContain('topsecret');
  });

  test('warns and exits 0 with nothing to commit, with a slug missing from the backlog, and with a backlog file dirty at baseline', () => {
    // no cycle changes: no feat commit
    let dir = repo();
    baseline(dir);
    let r = ship(dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('WARNING: nothing to commit');
    expect(log(dir).some(s => s.startsWith('feat('))).toBe(false);

    // a slug missing from the backlog: no backlog commit
    dir = repo();
    write(dir, 'Docs/backlog/index.md', '- [ ] `other` - x\n');
    sh(dir, 'git', ['commit', '-q', '-am', 'swap']);
    baseline(dir);
    write(dir, 'server/a.js');
    r = ship(dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('WARNING: alpha not found in Docs/backlog/index.md; not ticked');
    expect(log(dir).some(s => s.startsWith('chore(backlog)'))).toBe(false);

    // a backlog file dirty at baseline is ticked but not committed
    dir = repo();
    write(dir, 'Docs/backlog/index.md', '- [ ] `alpha` - thing\n# mine\n');
    baseline(dir);
    write(dir, 'server/a.js');
    r = ship(dir);
    expect(r.status).toBe(0);
    expect(fs.readFileSync(path.join(dir, 'Docs/backlog/index.md'), 'utf8')).toContain('- [x] `alpha`');
    expect(log(dir).some(s => s.startsWith('chore(backlog)'))).toBe(false);
    expect(r.stdout).toContain('WARNING');
  });

  test('a failing git commit exits 1', () => {
    const dir = repo();
    baseline(dir);
    write(dir, 'server/a.js');
    fs.mkdirSync(path.join(dir, '.git/hooks'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    expect(ship(dir).status).toBe(1);
  });
});
