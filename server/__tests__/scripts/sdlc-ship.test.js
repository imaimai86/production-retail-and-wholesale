const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const SLUG = 'demo-slug';
const DOCS = `Docs/backlog/${SLUG}`;
const LOG = `${DOCS}/logs`;
const BASELINE = `${LOG}/baseline.json`;
const BACKLOG = 'Docs/backlog/index.md';
const FEAT_SUBJECT = `feat(${SLUG}): implement per ${DOCS}/specs-1.md`;
const TICK_SUBJECT = `chore(backlog): mark ${SLUG} done`;

const tmpDirs = [];
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
const read = (repo, rel) => fs.readFileSync(path.join(repo, rel), 'utf8');

// Temporary repo holding copies of the two scripts under test, an initial commit and a backlog.
function mkRepo({ backlog = `- [ ] \`${SLUG}\` demo item\n- [ ] \`other\` other item\n` } = {}) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-ship-'));
  tmpDirs.push(repo);
  git(repo, 'init', '-q');
  git(repo, 'symbolic-ref', 'HEAD', 'refs/heads/feature-branch');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'commit.gpgsign', 'false');
  for (const f of ['sdlc-changes.cjs', 'sdlc-ship.sh']) {
    write(repo, `scripts/${f}`, fs.readFileSync(path.join(root, 'scripts', f), 'utf8'));
  }
  write(repo, '.gitignore', 'Docs/backlog/*/logs/\nignored.log\n');
  write(repo, 'README.md', '# readme\n');
  write(repo, 'server/app.js', 'app\n');
  write(repo, 'scripts/other.sh', 'echo hi\n');
  write(repo, BACKLOG, backlog);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
  fs.mkdirSync(path.join(repo, LOG), { recursive: true });
  return repo;
}

const sh = (cwd, args) =>
  spawnSync('bash', ['scripts/sdlc-ship.sh', ...args], { cwd, encoding: 'utf8' });

const snapshot = repo => {
  const r = spawnSync('node', ['scripts/sdlc-changes.cjs', 'snapshot', BASELINE], { cwd: repo, encoding: 'utf8' });
  expect(r.status).toBe(0);
};

const ship = (repo, args = [SLUG, DOCS, BASELINE, BACKLOG]) => sh(repo, args);

const subjects = repo => git(repo, 'log', '--format=%s').trim().split('\n');
const head = repo => git(repo, 'rev-parse', 'HEAD').trim();
const featSha = repo => git(repo, 'log', `--grep=^feat(${SLUG})`, '--format=%H', '-n1').trim();
const filesOf = (repo, sha) =>
  git(repo, 'show', '--name-only', '--format=', sha).trim().split('\n').filter(Boolean).sort();
const bodyOf = (repo, sha) => git(repo, 'log', '-1', '--format=%b', sha).trimEnd();
const lastLine = out => out.trimEnd().split('\n').pop();
const staged = repo => git(repo, 'diff', '--cached', '--name-only').trim().split('\n').filter(Boolean).sort();

describe('sdlc-ship.sh', () => {
  test('AC12: scripts/, README.md and server/ changes land in one feat commit with a body', () => {
    const repo = mkRepo();
    snapshot(repo);
    write(repo, 'scripts/new.sh', 'echo new\n');
    write(repo, 'README.md', '# readme\nmore\n');
    write(repo, 'server/app.js', 'app v2\n');
    write(repo, 'server/routes/new.js', 'route\n');
    const before = subjects(repo).length;

    const r = ship(repo);
    expect(r.status).toBe(0);
    const feats = subjects(repo).filter(s => s === FEAT_SUBJECT);
    expect(feats).toHaveLength(1);
    const sha = featSha(repo);
    const expected = ['README.md', 'scripts/new.sh', 'server/app.js', 'server/routes/new.js'];
    expect(filesOf(repo, sha)).toEqual(expected);
    expect(bodyOf(repo, sha).split('\n')).toEqual(expected);
    // feat commit + backlog tick commit, nothing more
    expect(subjects(repo)).toHaveLength(before + 2);
    expect(git(repo, 'status', '--porcelain').trim()).toBe('');
  });

  test('AC12: Docs and Engineering changes are committed too', () => {
    const repo = mkRepo();
    snapshot(repo);
    write(repo, `${DOCS}/specs-1.md`, 'spec\n');
    write(repo, 'Engineering/notes.md', 'n\n');
    expect(ship(repo).status).toBe(0);
    expect(filesOf(repo, featSha(repo))).toEqual([`${DOCS}/specs-1.md`, 'Engineering/notes.md']);
  });

  test('AC13: pre-existing untracked and modified files stay uncommitted and byte-identical', () => {
    const repo = mkRepo();
    write(repo, 'notes.txt', 'my private notes\n');
    write(repo, 'server/app.js', 'dev edit in progress\n');
    snapshot(repo);
    write(repo, 'scripts/new.sh', 'new\n');

    const r = ship(repo);
    expect(r.status).toBe(0);
    expect(filesOf(repo, featSha(repo))).toEqual(['scripts/new.sh']);
    expect(read(repo, 'notes.txt')).toBe('my private notes\n');
    expect(read(repo, 'server/app.js')).toBe('dev edit in progress\n');
    const status = git(repo, 'status', '--porcelain').trim().split('\n').sort();
    expect(status).toEqual([' M server/app.js', '?? notes.txt']);
  });

  test('AC13: pre-existing file edited further during the cycle is skipped, not committed', () => {
    const repo = mkRepo();
    write(repo, 'server/app.js', 'dev edit\n');
    snapshot(repo);
    write(repo, 'server/app.js', 'dev edit plus agent edit\n');
    write(repo, 'scripts/new.sh', 'new\n');
    const r = ship(repo);
    expect(r.status).toBe(0);
    expect(filesOf(repo, featSha(repo))).toEqual(['scripts/new.sh']);
    expect(read(repo, `${LOG}/ship-skipped.md`)).toContain('- server/app.js: pre-existing local changes');
    expect(read(repo, 'server/app.js')).toBe('dev edit plus agent edit\n');
  });

  test('AC14: something staged beforehand is not committed and stays staged', () => {
    const repo = mkRepo();
    write(repo, 'staged.txt', 'staged by dev\n');
    git(repo, 'add', 'staged.txt');
    write(repo, 'README.md', '# readme edited by dev\n');
    git(repo, 'add', 'README.md');
    snapshot(repo);
    write(repo, 'scripts/new.sh', 'new\n');

    const r = ship(repo);
    expect(r.status).toBe(0);
    expect(filesOf(repo, featSha(repo))).toEqual(['scripts/new.sh']);
    expect(staged(repo)).toEqual(['README.md', 'staged.txt']);
  });

  test('AC15: .env created in server/ is skipped and listed in ship-skipped.md', () => {
    const repo = mkRepo();
    snapshot(repo);
    write(repo, 'server/.env', 'SECRET=1\n');
    write(repo, 'server/new.js', 'x\n');

    const r = ship(repo);
    expect(r.status).toBe(0);
    expect(filesOf(repo, featSha(repo))).toEqual(['server/new.js']);
    expect(git(repo, 'ls-files', 'server/.env').trim()).toBe('');
    expect(read(repo, `${LOG}/ship-skipped.md`)).toContain('- server/.env: sensitive file');
    expect(r.stdout).toContain('- server/.env: sensitive file');
    expect(read(repo, 'server/.env')).toBe('SECRET=1\n');
  });

  test('skipped list has one "- path: reason" line per entry, in helper order', () => {
    const repo = mkRepo();
    snapshot(repo);
    write(repo, 'server/.env', 's\n');
    write(repo, '.claude/settings.json', '{}\n');
    write(repo, 'node_modules/x/i.js', 'x\n');
    write(repo, 'real.js', 'x\n');
    expect(ship(repo).status).toBe(0);
    expect(read(repo, `${LOG}/ship-skipped.md`).trimEnd().split('\n')).toEqual([
      '- .claude/settings.json: local or agent configuration',
      '- node_modules/x/i.js: generated',
      '- server/.env: sensitive file',
    ]);
  });

  test('AC16: no cycle changes gives WARNING, no feat commit, exit 0, tick still made', () => {
    const repo = mkRepo();
    snapshot(repo);
    const r = ship(repo);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('WARNING: nothing to commit');
    expect(subjects(repo).some(s => s.startsWith('feat('))).toBe(false);
    expect(subjects(repo)[0]).toBe(TICK_SUBJECT);
    expect(lastLine(r.stdout)).toBe(
      `DONE: ${SLUG} on feature-branch. Committed 1 file(s), skipped 0 (see ${LOG}/ship-skipped.md).`
    );
  });

  test('AC16: no cycle changes and slug not in backlog reports 0 committed', () => {
    const repo = mkRepo({ backlog: '- [ ] `other` x\n' });
    snapshot(repo);
    const head0 = head(repo);
    const r = ship(repo);
    expect(r.status).toBe(0);
    expect(head(repo)).toBe(head0);
    expect(lastLine(r.stdout)).toContain('Committed 0 file(s), skipped 0');
  });

  test('AC17: slug missing from the backlog warns and makes no backlog commit', () => {
    const repo = mkRepo({ backlog: '- [ ] `other` x\n' });
    snapshot(repo);
    write(repo, 'server/new.js', 'x\n');
    const r = ship(repo);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`WARNING: ${SLUG} not found in ${BACKLOG}; not ticked`);
    expect(subjects(repo).some(s => s.startsWith('chore(backlog)'))).toBe(false);
    expect(read(repo, BACKLOG)).toBe('- [ ] `other` x\n');
    expect(lastLine(r.stdout)).toContain('Committed 1 file(s)');
  });

  test('already ticked backlog line makes no commit and does not fail', () => {
    const repo = mkRepo({ backlog: `- [x] \`${SLUG}\` done\n` });
    snapshot(repo);
    write(repo, 'server/new.js', 'x\n');
    const r = ship(repo);
    expect(r.status).toBe(0);
    expect(subjects(repo).some(s => s.startsWith('chore(backlog)'))).toBe(false);
    expect(lastLine(r.stdout)).toContain('Committed 1 file(s)');
  });

  test('backlog tick changes only the matching line, in its own commit', () => {
    const repo = mkRepo();
    snapshot(repo);
    write(repo, 'server/new.js', 'x\n');
    expect(ship(repo).status).toBe(0);
    expect(read(repo, BACKLOG)).toBe(`- [x] \`${SLUG}\` demo item\n- [ ] \`other\` other item\n`);
    expect(subjects(repo)[0]).toBe(TICK_SUBJECT);
    expect(filesOf(repo, 'HEAD')).toEqual([BACKLOG]);
    expect(fs.existsSync(path.join(repo, `${BACKLOG}.bak`))).toBe(false);
  });

  test('AC18: backlog file dirty at baseline is ticked on disk but not committed, with a warning', () => {
    const repo = mkRepo();
    write(repo, BACKLOG, `- [ ] \`${SLUG}\` demo item\n- [ ] \`other\` other item\n- [ ] \`dev-added\` mine\n`);
    snapshot(repo);
    write(repo, 'server/new.js', 'x\n');

    const r = ship(repo);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/already modified before the run/);
    expect(r.stdout).toMatch(/not committed/);
    expect(read(repo, BACKLOG)).toContain(`- [x] \`${SLUG}\``);
    expect(read(repo, BACKLOG)).toContain('`dev-added`');
    expect(subjects(repo).some(s => s.startsWith('chore(backlog)'))).toBe(false);
    expect(git(repo, 'status', '--porcelain').trim()).toBe(` M ${BACKLOG}`.trim());
    expect(lastLine(r.stdout)).toContain('Committed 1 file(s)');
  });

  test('AC19: backlog changed during the cycle is committed only by the tick commit', () => {
    const repo = mkRepo();
    snapshot(repo);
    write(repo, BACKLOG, `- [ ] \`${SLUG}\` demo item\n- [ ] \`other\` other item\n- [ ] \`added\` new item\n`);
    write(repo, 'server/new.js', 'x\n');

    const r = ship(repo);
    expect(r.status).toBe(0);
    expect(filesOf(repo, featSha(repo))).toEqual(['server/new.js']);
    expect(subjects(repo)[0]).toBe(TICK_SUBJECT);
    expect(filesOf(repo, 'HEAD')).toEqual([BACKLOG]);
    expect(read(repo, BACKLOG)).toContain('`added`');
    expect(read(repo, `${LOG}/ship-skipped.md`)).not.toContain(BACKLOG);
    // 1 feat file + 1 tick; the backlog file is counted once.
    expect(lastLine(r.stdout)).toBe(
      `DONE: ${SLUG} on feature-branch. Committed 2 file(s), skipped 0 (see ${LOG}/ship-skipped.md).`
    );
  });

  test('AC19: backlog changed during the cycle and nothing else changed is not "nothing to commit" noise', () => {
    const repo = mkRepo();
    snapshot(repo);
    write(repo, BACKLOG, `- [ ] \`${SLUG}\` demo item\n- [ ] \`added\` new item\n`);
    const r = ship(repo);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('WARNING: nothing to commit');
    expect(subjects(repo).some(s => s.startsWith('feat('))).toBe(false);
    expect(filesOf(repo, 'HEAD')).toEqual([BACKLOG]);
    expect(lastLine(r.stdout)).toContain('Committed 1 file(s)');
  });

  test('AC20: final stdout line reports branch, committed and skipped counts', () => {
    const repo = mkRepo();
    snapshot(repo);
    write(repo, 'server/a.js', 'x\n');
    write(repo, 'server/b.js', 'x\n');
    write(repo, 'README.md', '# r\nedit\n');
    write(repo, 'server/.env', 's\n');
    const r = ship(repo);
    expect(r.status).toBe(0);
    expect(lastLine(r.stdout)).toBe(
      `DONE: ${SLUG} on feature-branch. Committed 4 file(s), skipped 1 (see ${LOG}/ship-skipped.md).`
    );
  });

  test('AC21: with no skipped files ship-skipped.md says "No files skipped."', () => {
    const repo = mkRepo();
    snapshot(repo);
    write(repo, 'server/a.js', 'x\n');
    const r = ship(repo);
    expect(r.status).toBe(0);
    expect(read(repo, `${LOG}/ship-skipped.md`).trim()).toBe('No files skipped.');
    expect(r.stdout).toContain('No files skipped.');
  });

  test('AC21: more than 50 files list 50 paths then "... and K more"; N counts all', () => {
    const repo = mkRepo();
    snapshot(repo);
    const names = [];
    for (let i = 1; i <= 60; i++) {
      const n = `server/gen/f${String(i).padStart(2, '0')}.js`;
      names.push(n);
      write(repo, n, `${i}\n`);
    }
    const r = ship(repo);
    expect(r.status).toBe(0);
    const sha = featSha(repo);
    expect(filesOf(repo, sha)).toHaveLength(60);
    const body = bodyOf(repo, sha).split('\n');
    expect(body).toHaveLength(51);
    expect(body.slice(0, 50)).toEqual(names.slice(0, 50));
    expect(body[50]).toBe('... and 10 more');
    expect(lastLine(r.stdout)).toContain('Committed 61 file(s), skipped 0');
  });

  test('AC21: exactly 50 files have no "... and K more" line', () => {
    const repo = mkRepo();
    snapshot(repo);
    for (let i = 1; i <= 50; i++) write(repo, `server/gen/f${String(i).padStart(2, '0')}.js`, `${i}\n`);
    expect(ship(repo).status).toBe(0);
    const body = bodyOf(repo, featSha(repo)).split('\n');
    expect(body).toHaveLength(50);
    expect(body.join('\n')).not.toMatch(/and \d+ more/);
  });

  test('AC22: a failing git commit exits 1 with the git error and no DONE line', () => {
    const repo = mkRepo();
    snapshot(repo);
    write(repo, 'server/new.js', 'x\n');
    const hook = path.join(repo, '.git/hooks/pre-commit');
    fs.writeFileSync(hook, '#!/bin/sh\necho "hook rejected commit" >&2\nexit 1\n');
    fs.chmodSync(hook, 0o755);
    const head0 = head(repo);

    const r = ship(repo);
    expect(r.status).toBe(1);
    expect(r.stderr.length).toBeGreaterThan(0);
    expect(r.stdout).not.toMatch(/^DONE:/m);
    expect(head(repo)).toBe(head0);
  });

  test('AC22: a failing backlog commit also exits 1 without a DONE line', () => {
    const repo = mkRepo();
    snapshot(repo);
    // No cycle changes, so the only commit is the backlog tick, which the hook rejects.
    const hook = path.join(repo, '.git/hooks/pre-commit');
    fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n');
    fs.chmodSync(hook, 0o755);
    const r = ship(repo);
    expect(r.status).toBe(1);
    expect(r.stdout).not.toMatch(/^DONE:/m);
  });

  test('AC23: wrong argument count prints usage and exits 1; nothing is committed', () => {
    const repo = mkRepo();
    snapshot(repo);
    write(repo, 'server/new.js', 'x\n');
    const head0 = head(repo);
    for (const args of [[], [SLUG], [SLUG, DOCS, BASELINE], [SLUG, DOCS, BASELINE, BACKLOG, 'extra']]) {
      const r = ship(repo, args);
      expect(r.status).toBe(1);
      expect(`${r.stdout}${r.stderr}`).toMatch(/usage/i);
      expect(r.stdout).not.toMatch(/^DONE:/m);
    }
    expect(head(repo)).toBe(head0);
    expect(read(repo, BACKLOG)).toContain(`- [ ] \`${SLUG}\``);
  });

  test('AC23: a failing helper (missing or invalid baseline) exits 1 and commits nothing', () => {
    const repo = mkRepo();
    write(repo, 'server/new.js', 'x\n');
    const head0 = head(repo);

    // Missing baseline
    let r = ship(repo);
    expect(r.status).toBe(1);
    expect(r.stdout).not.toMatch(/^DONE:/m);

    // Invalid baseline
    write(repo, BASELINE, 'not json');
    r = ship(repo);
    expect(r.status).toBe(1);
    expect(r.stdout).not.toMatch(/^DONE:/m);

    expect(head(repo)).toBe(head0);
    expect(read(repo, BACKLOG)).toContain(`- [ ] \`${SLUG}\``);
    expect(git(repo, 'ls-files', 'server/new.js').trim()).toBe('');
  });
});
