const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const helper = path.join(root, 'scripts/sdlc-changes.cjs');

const sh = (dir, cmd, args) => spawnSync(cmd, args, { cwd: dir, encoding: 'utf8' });
const write = (dir, f, text = 'x\n') => {
  fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
  fs.writeFileSync(path.join(dir, f), text);
};

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-changes-'));
  sh(dir, 'git', ['init', '-q']);
  sh(dir, 'git', ['config', 'user.email', 't@t']);
  sh(dir, 'git', ['config', 'user.name', 't']);
  write(dir, '.gitignore', 'node_modules/\n.env\nignored.txt\n');
  write(dir, 'tracked.txt', 'one\n');
  write(dir, 'gone.txt', 'bye\n');
  write(dir, 'old.txt', 'rename me\n');
  sh(dir, 'git', ['add', '-A']);
  sh(dir, 'git', ['commit', '-q', '-m', 'init']);
  return dir;
}
const base = dir => `${dir}-base.json`;
const snapshot = dir => sh(dir, 'node', [helper, 'snapshot', base(dir)]);
const changed = dir => JSON.parse(sh(dir, 'node', [helper, 'changed', base(dir)]).stdout);

describe('sdlc-changes snapshot', () => {
  test('records modified, untracked, deleted and staged paths with hashes', () => {
    const dir = repo();
    write(dir, 'tracked.txt', 'changed\n');
    write(dir, 'new.txt');
    fs.unlinkSync(path.join(dir, 'gone.txt'));
    write(dir, 'staged.txt');
    sh(dir, 'git', ['add', 'staged.txt']);
    expect(snapshot(dir).status).toBe(0);
    const files = JSON.parse(fs.readFileSync(base(dir), 'utf8')).files;
    expect(Object.keys(files).sort()).toEqual(['gone.txt', 'new.txt', 'staged.txt', 'tracked.txt']);
    expect(files['gone.txt']).toBeNull();
    expect(files['new.txt']).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('sdlc-changes changed', () => {
  test('new, edited, deleted and renamed files are included; a .gitignored file is never listed', () => {
    let dir = repo();
    snapshot(dir);
    write(dir, 'new.txt');
    write(dir, 'tracked.txt', 'edited\n');
    fs.unlinkSync(path.join(dir, 'gone.txt'));
    write(dir, 'ignored.txt');
    const r = changed(dir);
    expect(r.include.sort()).toEqual(['gone.txt', 'new.txt', 'tracked.txt']);
    expect(r.skipped).toEqual([]);

    // a rename is one delete and one add
    dir = repo();
    snapshot(dir);
    sh(dir, 'git', ['mv', 'old.txt', 'renamed.txt']);
    expect(changed(dir).include.sort()).toEqual(['old.txt', 'renamed.txt']);
  });

  test('a file dirty before the run is in neither list while unchanged, and skipped as pre-existing once edited again', () => {
    const dir = repo();
    write(dir, 'tracked.txt', 'mine\n');
    snapshot(dir);
    expect(changed(dir)).toMatchObject({ include: [], skipped: [] });

    write(dir, 'tracked.txt', 'mine and cycle\n');
    expect(changed(dir)).toMatchObject({ include: [], skipped: [{ path: 'tracked.txt', reason: 'pre-existing local changes' }] });
  });

  test('sensitive, config, generated and over 1 MiB files are skipped; .env.example is included', () => {
    const dir = repo();
    snapshot(dir);
    for (const f of ['.env.local', 'server/.env.production', 'key.pem', 'id_rsa_x']) write(dir, f);
    for (const f of ['.vscode/x.json', '.claude/settings.json']) write(dir, f);
    write(dir, 'node_modules/x/index.js');
    write(dir, '.DS_Store');
    write(dir, '.env.example');
    write(dir, 'big.bin', 'a'.repeat(1024 * 1024 + 1));
    const r = changed(dir);
    const reason = p => (r.skipped.find(s => s.path === p) || {}).reason;
    expect(reason('.env.local')).toBe('sensitive file');
    expect(reason('server/.env.production')).toBe('sensitive file');
    expect(reason('key.pem')).toBe('sensitive file');
    expect(reason('id_rsa_x')).toBe('sensitive file');
    expect(reason('.vscode/x.json')).toBe('local or agent configuration');
    expect(reason('.claude/settings.json')).toBe('local or agent configuration');
    expect(reason('big.bin')).toBe('too large');
    expect(r.include).toEqual(['.env.example']);
  });

  test('keys added to a git-ignored .env are mirrored into .env.example with placeholders', () => {
    const dir = repo();
    write(dir, '.env', 'A=1\n');
    write(dir, '.env.example', 'A=change-me\n');
    sh(dir, 'git', ['add', '-A']);
    sh(dir, 'git', ['commit', '-q', '-m', 'ex']);
    snapshot(dir);
    write(dir, '.env', 'A=1\nSECRET_KEY=hunter2\n');
    expect(sh(dir, 'node', [helper, 'mirror', base(dir)]).status).toBe(0);
    const example = fs.readFileSync(path.join(dir, '.env.example'), 'utf8');
    expect(example).toBe('A=change-me\nSECRET_KEY=change-me\n');
    expect(example).not.toContain('hunter2');
    expect(changed(dir).include).toEqual(['.env.example']);
  });
});

describe('sdlc-changes mark (files per stage)', () => {
  const mark = (dir, stage) => sh(dir, 'node', [helper, 'mark', `${dir}-stages.json`, ...(stage ? [stage] : [])]);
  const stages = dir => JSON.parse(fs.readFileSync(`${dir}-stages.json`, 'utf8')).stages;
  const commit = (dir, msg) => {
    sh(dir, 'git', ['add', '-A']);
    sh(dir, 'git', ['commit', '-q', '-m', msg]);
  };

  test('credits each stage with the files that changed while it ran, committed or not, but not the commit that collects earlier work', () => {
    let dir = repo();
    mark(dir);
    write(dir, 'Docs/backlog/s/specs-1.md');
    mark(dir, 'Spec');
    write(dir, 'Docs/backlog/s/plan-1.md');
    write(dir, 'tracked.txt', 'edited\n');
    mark(dir, 'Plan');
    expect(stages(dir)).toEqual({ Spec: ['Docs/backlog/s/specs-1.md'], Plan: ['Docs/backlog/s/plan-1.md', 'tracked.txt'] });

    // a file created and committed inside one stage still counts for that stage
    dir = repo();
    mark(dir);
    write(dir, 'server/__tests__/new.test.js');
    commit(dir, 'test: add failing tests');
    mark(dir, 'Red tests');
    expect(stages(dir)).toEqual({ 'Red tests': ['server/__tests__/new.test.js'] });

    // the commit that collects earlier work is not credited with it
    dir = repo();
    mark(dir);
    write(dir, 'a.js');
    mark(dir, 'Implement');
    commit(dir, 'feat: ship');
    mark(dir, 'Commit');
    expect(stages(dir)).toEqual({ Implement: ['a.js'] });
  });

  test('an already dirty, unchanged file and sensitive or generated files are never credited; a second pass adds to a stage; a mark without a stage only resets', () => {
    let dir = repo();
    write(dir, 'dirty-before.txt');
    mark(dir);
    write(dir, 'one.js');
    mark(dir, 'Implement');
    write(dir, 'two.js');
    mark(dir, 'Implement');
    expect(stages(dir)).toEqual({ Implement: ['one.js', 'two.js'] });

    dir = repo();
    mark(dir);
    write(dir, '.env.local', 'SECRET=1\n');
    write(dir, 'node_modules/x/index.js');
    write(dir, 'real.js');
    mark(dir);
    mark(dir, 'Spec');
    expect(stages(dir)).toEqual({});
    write(dir, 'later.js');
    mark(dir, 'Plan');
    expect(stages(dir)).toEqual({ Plan: ['later.js'] });
  });
});
