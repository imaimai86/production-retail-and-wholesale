const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../../..');
const script = path.join(repoRoot, 'scripts', 'backlog-list.cjs');

const USAGE = 'Usage: backlog-list [status[,status...]] [--status <list>] [--json]';
const unknown = v => `Unknown status "${v}". Valid: pending, in-progress, blocked, parked, completed, all`;

const tmpRoots = [];
function mkRoot(indexText, briefs = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-list-'));
  tmpRoots.push(root);
  const dir = path.join(root, 'Docs', 'backlog');
  fs.mkdirSync(dir, { recursive: true });
  if (indexText !== null) fs.writeFileSync(path.join(dir, 'index.md'), indexText);
  for (const [slug, text] of Object.entries(briefs)) {
    fs.mkdirSync(path.join(dir, slug), { recursive: true });
    if (text !== null) fs.writeFileSync(path.join(dir, slug, 'brief.md'), text);
  }
  return root;
}

function git(root, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

function gitInit(root) {
  git(root, 'init', '-q');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'init');
}

function run(root, args = [], env = {}) {
  const r = spawnSync('node', [script, ...args], {
    cwd: os.tmpdir(),
    encoding: 'utf8',
    env: { ...process.env, BACKLOG_ROOT: root, ...env },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const json = (root, args = []) => JSON.parse(run(root, [...args, '--json']).out);

function hashTree(dir) {
  const h = crypto.createHash('sha1');
  const walk = d => {
    for (const name of fs.readdirSync(d).sort()) {
      if (name === '.git') continue;
      const p = path.join(d, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else h.update(path.relative(dir, p)).update(fs.readFileSync(p));
    }
  };
  walk(dir);
  return h.digest('hex');
}

afterAll(() => {
  for (const r of tmpRoots) fs.rmSync(r, { recursive: true, force: true });
});

const brief = (type, pri) => `# Brief\n\nType: ${type}\nPriority: ${pri}\n`;

describe('require()', () => {
  test('exports the parsing functions and does not run main', () => {
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    let mod;
    try {
      jest.isolateModules(() => {
        mod = require(script);
      });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    for (const fn of [
      'parseIndex', 'parseTitle', 'parseBrief', 'parseArgs',
      'normalizeStatuses', 'formatTable', 'formatJson', 'main',
    ]) {
      expect(typeof mod[fn]).toBe('function');
    }
  });
});

describe('parseIndex', () => {
  const { parseIndex } = require(script);

  test('accepts markers space, x, X, ! and ~', () => {
    const items = parseIndex('- [ ] `a` - t\n- [x] `b` - t\n- [X] `c` - t\n- [!] `d` - t\n- [~] `e` - t\n');
    expect(items.map(i => [i.marker, i.slug])).toEqual([[' ', 'a'], ['x', 'b'], ['X', 'c'], ['!', 'd'], ['~', 'e']]);
  });

  test('ignores header, blank lines, other markers and lines without a slug', () => {
    const text = '# Backlog\n\nSome text\n- [-] `skipped` - t\n- [ ] no slug here\n- [ ] `ok` - t\n';
    expect(parseIndex(text).map(i => i.slug)).toEqual(['ok']);
  });

  test('keeps duplicate slugs as separate entries', () => {
    expect(parseIndex('- [ ] `a` - one\n- [x] `a` - two\n')).toHaveLength(2);
  });
});

describe('parseTitle', () => {
  const { parseTitle } = require(script);

  test('Bug: and Feature: prefixes give a lowercase type', () => {
    expect(parseTitle('Bug: Broken thing')).toMatchObject({ type: 'bug', title: 'Broken thing' });
    expect(parseTitle('Feature: New thing')).toMatchObject({ type: 'feature', title: 'New thing' });
  });

  test('prefix is case-insensitive', () => {
    expect(parseTitle('BUG: x')).toMatchObject({ type: 'bug', title: 'x' });
    expect(parseTitle('fEaTuRe: y')).toMatchObject({ type: 'feature', title: 'y' });
  });

  test('old-format text is the whole title with no type', () => {
    const r = parseTitle('Block inventory transfers');
    expect(r.type).toBeFalsy();
    expect(r.title).toBe('Block inventory transfers');
  });

  test('trailing (blocked: reason) is removed from the title', () => {
    expect(parseTitle('Bug: Thing (blocked: waiting on infra)')).toMatchObject({
      type: 'bug',
      title: 'Thing',
      blockedReason: 'waiting on infra',
    });
  });

  test('long titles are never truncated', () => {
    const long = 'x'.repeat(300);
    expect(parseTitle(`Feature: ${long}`).title).toBe(long);
  });
});

describe('parseArgs / normalizeStatuses', () => {
  const { parseArgs, normalizeStatuses } = require(script);
  const thrown = fn => {
    try {
      fn();
    } catch (e) {
      return e;
    }
    return null;
  };

  test('no arguments means all', () => {
    expect(parseArgs([]).json).toBe(false);
    expect(normalizeStatuses(parseArgs([]).raw || 'all')).toBeTruthy();
  });

  test('--json is detected in any position', () => {
    expect(parseArgs(['--json', 'pending']).json).toBe(true);
    expect(parseArgs(['pending', '--json']).json).toBe(true);
    expect(parseArgs(['--status', 'blocked', '--json']).json).toBe(true);
  });

  test.each([
    [['pending', '--status', 'blocked']],
    [['--status']],
    [['--bogus']],
    [['pending', 'blocked']],
  ])('bad usage %j throws code 2 with the usage message', argv => {
    const e = thrown(() => parseArgs(argv));
    expect(e).toMatchObject({ code: 2, message: USAGE });
  });

  test('unknown and empty list items throw the Unknown status message', () => {
    expect(thrown(() => normalizeStatuses('bogus'))).toMatchObject({ message: unknown('bogus') });
    expect(thrown(() => normalizeStatuses('pending,'))).toMatchObject({ message: unknown('') });
    expect(thrown(() => normalizeStatuses('Pending,BoGuS'))).toMatchObject({ message: unknown('BoGuS') });
  });
});

describe('criterion 1: markers and titles', () => {
  const index = [
    '# Backlog',
    '',
    '- [ ] `p` - Feature: Pending one',
    '- [x] `c` - Bug: Completed one',
    '- [X] `cu` - Bug: Upper x',
    '- [!] `b` - Feature: Blocked one (blocked: waiting on vendor)',
    '- [!] `b2` - Feature: Blocked without reason',
    '- [ ] `old` - Old format title without prefix',
    '- [x] `cx` - Bug: Completed with note (blocked: stale)',
    '- [ ] `px` - Bug: Pending with note (blocked: maybe)',
    '- [-] `other` - Feature: ignored marker',
    '',
  ].join('\n');
  const root = mkRoot(index);
  const items = json(root);
  const by = slug => items.find(i => i.slug === slug);

  test('statuses follow the markers; other markers are ignored', () => {
    expect(items.map(i => [i.slug, i.status])).toEqual([
      ['p', 'pending'], ['c', 'completed'], ['cu', 'completed'], ['b', 'blocked'],
      ['b2', 'blocked'], ['old', 'pending'], ['cx', 'completed'], ['px', 'pending'],
    ]);
  });

  test('blocked reason goes to the note, not the title', () => {
    expect(by('b')).toMatchObject({ title: 'Blocked one', note: 'waiting on vendor; no brief' });
  });

  test('[!] without (blocked:) is blocked with only the no brief note', () => {
    expect(by('b2')).toMatchObject({ status: 'blocked', note: 'no brief' });
  });

  test('(blocked:) on [x] and [ ] keeps the status but still moves the text', () => {
    expect(by('cx')).toMatchObject({ status: 'completed', title: 'Completed with note' });
    expect(by('cx').note).toContain('stale');
    expect(by('px')).toMatchObject({ status: 'pending', title: 'Pending with note' });
    expect(by('px').note).toContain('maybe');
  });

  test('old-format line parses with the whole text as title', () => {
    expect(by('old')).toMatchObject({ title: 'Old format title without prefix', type: null });
  });

  test('duplicate slugs are all listed and counted', () => {
    const r = mkRoot('- [ ] `d` - Bug: one\n- [x] `d` - Bug: two\n');
    expect(json(r)).toHaveLength(2);
    expect(run(r).out).toContain('total 2');
  });
});

describe('criterion 2: in-progress detection', () => {
  const index = '- [ ] `loc` - Bug: a\n- [ ] `rem` - Bug: b\n- [ ] `none` - Bug: c\n- [x] `done` - Bug: d\n- [!] `blk` - Bug: e\n';

  test('local sdlc/<slug> branch makes a [ ] item in-progress; completed and blocked keep status', () => {
    const root = mkRoot(index);
    gitInit(root);
    for (const s of ['loc', 'done', 'blk']) git(root, 'branch', `sdlc/${s}`);
    const st = Object.fromEntries(json(root).map(i => [i.slug, i.status]));
    expect(st).toEqual({ loc: 'in-progress', rem: 'pending', none: 'pending', done: 'completed', blk: 'blocked' });
  });

  test('remote-tracking origin/sdlc/<slug> also makes it in-progress', () => {
    const root = mkRoot(index);
    gitInit(root);
    git(root, 'update-ref', 'refs/remotes/origin/sdlc/rem', 'HEAD');
    git(root, 'update-ref', 'refs/remotes/origin/sdlc/done', 'HEAD');
    const st = Object.fromEntries(json(root).map(i => [i.slug, i.status]));
    expect(st.rem).toBe('in-progress');
    expect(st.done).toBe('completed');
  });

  test('a similarly named branch does not match', () => {
    const root = mkRoot('- [ ] `abc` - Bug: a\n');
    gitInit(root);
    git(root, 'branch', 'sdlc/abcd');
    git(root, 'branch', 'feature/abc');
    expect(json(root)[0].status).toBe('pending');
  });

  test('outside a git repository nothing is in-progress and stderr is empty', () => {
    const root = mkRoot(index);
    const r = run(root, ['--json']);
    expect(r.code).toBe(0);
    expect(r.err).toBe('');
    expect(JSON.parse(r.out).filter(i => i.status === 'in-progress')).toEqual([]);
  });

  test('table prints in-progress in lowercase and the footer counts it', () => {
    const root = mkRoot(index);
    gitInit(root);
    git(root, 'branch', 'sdlc/loc');
    const out = run(root).out;
    expect(out).toMatch(/^in-progress {2}loc/m);
    expect(out).toContain('pending 2 · in-progress 1 · blocked 1 · parked 0 · completed 1 · total 5');
  });
});

describe('criterion 3: filters and arguments', () => {
  const index = '- [ ] `p` - Bug: a\n- [x] `c` - Bug: b\n- [!] `b` - Bug: c (blocked: r)\n- [ ] `ip` - Bug: d\n';
  let root;
  beforeAll(() => {
    root = mkRoot(index);
    gitInit(root);
    git(root, 'branch', 'sdlc/ip');
  });
  const slugs = args => json(root, args).map(i => i.slug);

  test.each([
    [[], ['p', 'c', 'b', 'ip']],
    [['all'], ['p', 'c', 'b', 'ip']],
    [['pending'], ['p']],
    [['in-progress'], ['ip']],
    [['blocked'], ['b']],
    [['completed'], ['c']],
    [['pending,in-progress'], ['p', 'ip']],
    [['blocked,completed'], ['c', 'b']],
    [['--status', 'pending'], ['p']],
    [['--status', 'pending,blocked'], ['p', 'b']],
    [['open'], ['p']],
    [['done'], ['c']],
    [['PENDING'], ['p']],
    [['Open,DONE'], ['p', 'c']],
    [['pending', '--json'], ['p']],
  ])('filter %j', (args, expected) => {
    expect(slugs(args.filter(a => a !== '--json'))).toEqual(expected);
  });

  test('table mode honours the filter and keeps index order', () => {
    const lines = run(root, ['pending,completed']).out.split('\n');
    const rows = lines.slice(1, lines.indexOf(''));
    expect(rows.map(l => l.split(/\s+/)[1])).toEqual(['p', 'c']);
  });

  test.each([['bogus'], ['pending,'], [',pending'], ['pending,,blocked'], ['']])(
    'unknown status %j exits 2 with the exact message and empty stdout',
    value => {
      const r = run(root, [value]);
      expect(r.code).toBe(2);
      expect(r.out).toBe('');
      const offending = ['pending,', ',pending', 'pending,,blocked'].includes(value) ? '' : value;
      expect(r.err.trim()).toBe(unknown(offending));
    }
  );

  test('unknown value keeps the case as typed', () => {
    expect(run(root, ['BoGuS']).err.trim()).toBe(unknown('BoGuS'));
  });

  test('unknown status with --json still exits 2 and prints nothing to stdout', () => {
    const r = run(root, ['nope', '--json']);
    expect(r.code).toBe(2);
    expect(r.out).toBe('');
  });

  test.each([
    [['pending', '--status', 'blocked']],
    [['--status']],
    [['--status', '--json']],
    [['--bogus']],
    [['-x']],
    [['pending', 'blocked']],
  ])('bad usage %j exits 2 with the usage message', args => {
    const r = run(root, args);
    expect(r.code).toBe(2);
    expect(r.out).toBe('');
    expect(r.err.trim()).toBe(USAGE);
  });

  test('argument errors are checked before the index is read', () => {
    const noIndex = mkRoot(null);
    const r = run(noIndex, ['bogus']);
    expect(r.code).toBe(2);
    expect(r.err).not.toContain('not found');
  });
});

describe('criterion 4: TYPE and PRI', () => {
  const index = [
    '- [ ] `pfx` - Bug: prefix wins',
    '- [ ] `fromBrief` - old format title',
    '- [ ] `upper` - old format two',
    '- [ ] `nobrief` - old format three',
    '- [ ] `nopri` - old format four',
    '- [ ] `badpri` - old format five',
    '',
  ].join('\n');
  const root = mkRoot(index, {
    pfx: brief('feature', 'P0'),
    fromBrief: brief('feature', 'P1 (blocks use)'),
    upper: brief('Bug', 'P3'),
    nopri: '# Brief\n\nType: bug\n',
    badpri: brief('bug', 'urgent'),
  });
  const by = Object.fromEntries(json(root).map(i => [i.slug, i]));

  test('prefix beats the brief Type line', () => {
    expect(by.pfx.type).toBe('bug');
  });

  test('brief Type is used when there is no prefix, lowercased', () => {
    expect(by.fromBrief.type).toBe('feature');
    expect(by.upper.type).toBe('bug');
  });

  test('priority is the P0-P3 token of the brief Priority line', () => {
    expect(by.fromBrief.priority).toBe('P1');
    expect(by.pfx.priority).toBe('P0');
    expect(by.upper.priority).toBe('P3');
  });

  test('absent values are null in JSON', () => {
    expect(by.nobrief).toMatchObject({ type: null, priority: null, hasBrief: false });
    expect(by.nopri.priority).toBeNull();
    expect(by.badpri.priority).toBeNull();
  });

  test('absent values print "-" in the table', () => {
    const row = run(root).out.split('\n').find(l => l.startsWith('pending') && l.includes('nobrief'));
    expect(row.split(/\s+/).slice(1, 4)).toEqual(['nobrief', '-', '-']);
  });
});

describe('criterion 5: footer, Not in index, no brief, empty result', () => {
  const index = '- [ ] `a` - Bug: has brief\n- [!] `b` - Bug: blocked (blocked: waiting)\n- [x] `c` - Bug: done\n';
  const root = mkRoot(index, {
    a: brief('bug', 'P2'),
    c: brief('bug', 'P2'),
    zeta: brief('bug', 'P2'),
    alpha: brief('feature', 'P1'),
    emptydir: null,
  });
  fs.writeFileSync(path.join(root, 'Docs', 'backlog', 'loose-file.md'), 'x');

  test('footer counts ignore the filter', () => {
    const out = run(root, ['blocked']).out;
    expect(out).toContain('pending 1 · in-progress 0 · blocked 1 · parked 0 · completed 1 · total 3');
  });

  test('Not in index lists brief folders without an index line, sorted', () => {
    const out = run(root).out;
    expect(out).toContain('Not in index: alpha, zeta');
    expect(out).not.toContain('emptydir');
    expect(out).not.toContain('loose-file');
  });

  test('Not in index line is absent when empty', () => {
    expect(run(mkRoot('- [ ] `a` - Bug: x\n', { a: brief('bug', 'P1') })).out).not.toContain('Not in index');
  });

  test('footer follows one blank line; Not in index is the last line', () => {
    const lines = run(root).out.replace(/\n$/, '').split('\n');
    const blank = lines.indexOf('');
    expect(blank).toBeGreaterThan(0);
    expect(lines[blank + 1]).toMatch(/^pending \d+ · in-progress \d+ · blocked \d+ · parked \d+ · completed \d+ · total \d+$/);
    expect(lines[blank + 2]).toBe('Not in index: alpha, zeta');
    expect(lines).toHaveLength(blank + 3);
  });

  test('missing brief shows "no brief", joined with a blocked reason', () => {
    const r = mkRoot('- [ ] `x` - Bug: t\n- [!] `y` - Bug: t (blocked: waiting)\n- [!] `z` - Bug: t (blocked: why)\n', {
      z: brief('bug', 'P1'),
    });
    const notes = Object.fromEntries(json(r).map(i => [i.slug, i.note]));
    expect(notes).toEqual({ x: 'no brief', y: 'waiting; no brief', z: 'why' });
    const out = run(r).out;
    expect(out).toMatch(/^pending\s+x\s.*no brief$/m);
    expect(out).toMatch(/waiting; no brief$/m);
  });

  test('empty result prints the No items line and the footer, exit 0', () => {
    const r = run(mkRoot('- [ ] `a` - Bug: x\n', { a: brief('bug', 'P1') }), ['blocked']);
    expect(r.code).toBe(0);
    expect(r.out).toBe(
      'No items with status: blocked\n\npending 1 · in-progress 0 · blocked 0 · parked 0 · completed 0 · total 1\n'
    );
  });

  test('empty-result message echoes the filter as typed', () => {
    const r = run(mkRoot('- [ ] `a` - Bug: x\n', { a: brief('bug', 'P1') }), ['Blocked,DONE']);
    expect(r.out.split('\n')[0]).toBe('No items with status: Blocked,DONE');
  });

  test('empty index prints no items for the default filter', () => {
    const r = run(mkRoot('# Backlog\n'));
    expect(r.code).toBe(0);
    expect(r.out).toContain('No items with status: all');
    expect(r.out).toContain('total 0');
  });
});

describe('table layout', () => {
  const index = '- [ ] `a` - Bug: Fix\n- [x] `bb` - Feature: Done thing\n- [!] `c` - Bug: Stuck (blocked: waiting)\n';
  const root = mkRoot(index, {
    a: brief('bug', 'P1 (blocks use)'),
    bb: brief('feature', 'P2'),
    c: brief('bug', 'P0'),
  });
  const out = run(root).out;
  const lines = out.split('\n');

  test('header row names the six columns', () => {
    expect(lines[0].split(/\s{2,}/)).toEqual(['STATUS', 'SLUG', 'TYPE', 'PRI', 'TITLE', 'NOTE']);
  });

  test('exact padded layout', () => {
    expect(lines.slice(0, 4)).toEqual([
      'STATUS     SLUG  TYPE     PRI  TITLE       NOTE',
      'pending    a     bug      P1   Fix',
      'completed  bb    feature  P2   Done thing',
      'blocked    c     bug      P0   Stuck       waiting',
    ]);
  });

  test('no trailing whitespace, no colours, no border lines', () => {
    for (const l of lines) expect(l).toBe(l.trimEnd());
    expect(out).not.toMatch(/\u001b\[/);
    expect(out).not.toMatch(/^[-=+|]{3,}/m);
  });

  test('output ends with a single newline', () => {
    expect(out.endsWith('\n')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(false);
  });

  test('long titles are not truncated', () => {
    const long = 'word '.repeat(60).trim();
    const r = mkRoot(`- [ ] \`a\` - Feature: ${long}\n`, { a: brief('feature', 'P1') });
    expect(run(r).out).toContain(long);
  });
});

describe('criterion 6: JSON output and missing index', () => {
  const index = '- [ ] `a` - Bug: One\n- [!] `b` - Feature: Two (blocked: why)\n';
  const root = mkRoot(index, { a: brief('bug', 'P1 (x)') });

  test('stdout parses as an array of objects with exactly the seven fields', () => {
    const r = run(root, ['--json']);
    expect(r.code).toBe(0);
    const arr = JSON.parse(r.out);
    expect(Array.isArray(arr)).toBe(true);
    for (const o of arr) {
      expect(Object.keys(o).sort()).toEqual(
        ['hasBrief', 'note', 'priority', 'slug', 'status', 'title', 'type'].sort()
      );
      expect(typeof o.hasBrief).toBe('boolean');
    }
  });

  test('values for a complete item', () => {
    expect(json(root)[0]).toEqual({
      status: 'pending', slug: 'a', type: 'bug', priority: 'P1', title: 'One', note: '', hasBrief: true,
    });
  });

  test('values for an item with absent fields use null and ""', () => {
    expect(json(root)[1]).toEqual({
      status: 'blocked', slug: 'b', type: 'feature', priority: null, title: 'Two', note: 'why; no brief', hasBrief: false,
    });
  });

  test('no footer and no extra text', () => {
    const out = run(root, ['--json']).out;
    expect(out).not.toContain('total');
    expect(out).not.toContain('Not in index');
    expect(out.trim().startsWith('[')).toBe(true);
    expect(out.trim().endsWith(']')).toBe(true);
  });

  test('empty match is [] with no No items line', () => {
    const r = run(root, ['completed', '--json']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual([]);
    expect(r.out).not.toContain('No items');
  });

  test('--json works with --status, in any position', () => {
    expect(json(root, ['--status', 'blocked']).map(i => i.slug)).toEqual(['b']);
    const r = run(root, ['--json', '--status', 'blocked']);
    expect(JSON.parse(r.out).map(i => i.slug)).toEqual(['b']);
  });

  test('missing index exits 1 with the message and empty stdout', () => {
    for (const args of [[], ['--json'], ['blocked']]) {
      const r = run(mkRoot(null), args);
      expect(r.code).toBe(1);
      expect(r.out).toBe('');
      expect(r.err.trim()).toBe('Docs/backlog/index.md not found');
    }
  });
});

describe('root resolution', () => {
  test('works from any working directory using BACKLOG_ROOT', () => {
    const root = mkRoot('- [ ] `a` - Bug: x\n', { a: brief('bug', 'P1') });
    const r = spawnSync('node', [script, '--json'], {
      cwd: '/',
      encoding: 'utf8',
      env: { ...process.env, BACKLOG_ROOT: root },
    });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)[0].slug).toBe('a');
  });

  test('defaults to the repo root when BACKLOG_ROOT is unset', () => {
    const env = { ...process.env };
    delete env.BACKLOG_ROOT;
    const r = spawnSync('node', [script, '--json'], { cwd: os.tmpdir(), encoding: 'utf8', env });
    expect(r.status).toBe(0);
    expect(Array.isArray(JSON.parse(r.stdout))).toBe(true);
  });
});

describe('criterion 7: read-only', () => {
  test('tree hash and git status are identical before and after runs', () => {
    const root = mkRoot('- [ ] `a` - Bug: x\n- [!] `b` - Bug: y (blocked: z)\n', { a: brief('bug', 'P1'), extra: brief('bug', 'P2') });
    gitInit(root);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'seed');
    git(root, 'branch', 'sdlc/a');
    const before = { hash: hashTree(root), status: git(root, 'status', '--porcelain=v1'), branches: git(root, 'branch', '-a') };
    for (const args of [[], ['--json'], ['blocked'], ['bogus'], ['--status']]) run(root, args);
    expect({ hash: hashTree(root), status: git(root, 'status', '--porcelain=v1'), branches: git(root, 'branch', '-a') }).toEqual(before);
  });

  test('the script source contains no file-write or network calls', () => {
    const src = fs.readFileSync(script, 'utf8');
    expect(src).not.toMatch(/writeFile|appendFile|mkdirSync|unlinkSync|rmSync|renameSync|copyFile/);
    expect(src).not.toMatch(/require\(['"](https?|net|dns)['"]\)|fetch\(/);
  });
});

describe('parked status', () => {
  const index = [
    '- [ ] `p` - Bug: pending',
    '- [~] `k` - Feature: Parked one (parked: not needed yet)',
    '- [~] `k2` - Feature: Parked without reason',
    '- [x] `c` - Bug: done',
    '- [!] `b` - Bug: stuck (blocked: waiting)',
    '',
  ].join('\n');
  const mk = () => mkRoot(index, { p: brief('bug', 'P1'), k: brief('feature', 'P3'), k2: brief('feature', 'P3'), c: brief('bug', 'P2'), b: brief('bug', 'P2') });
  const by = (root, slug) => json(root).find(i => i.slug === slug);

  test('[~] is parked, and the parked reason goes to the note, not the title', () => {
    const r = mk();
    expect(by(r, 'k')).toMatchObject({ status: 'parked', title: 'Parked one', note: 'not needed yet' });
    expect(by(r, 'k2')).toMatchObject({ status: 'parked', note: '' });
  });

  test('a parked item with an sdlc/<slug> branch stays parked, not in-progress', () => {
    const r = mk();
    gitInit(r);
    git(r, 'branch', 'sdlc/k');
    expect(by(r, 'k').status).toBe('parked');
  });

  test('parked is a filter value, listed by all, and counted in the footer', () => {
    const r = mk();
    expect(json(r, ['parked']).map(i => i.slug)).toEqual(['k', 'k2']);
    expect(json(r, ['pending,parked']).map(i => i.slug)).toEqual(['p', 'k', 'k2']);
    expect(json(r, ['all'])).toHaveLength(5);
    expect(run(r, ['blocked']).out).toContain('pending 1 · in-progress 0 · blocked 1 · parked 2 · completed 1 · total 5');
  });

  test('the table prints parked in lowercase', () => {
    expect(run(mk(), ['parked']).out).toMatch(/^parked +k /m);
  });
});
