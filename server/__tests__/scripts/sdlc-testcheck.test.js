const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const TC = 'scripts/sdlc-testcheck.cjs';
const FA = path.join(root, 'server/__tests__/a.test.js');
const FB = path.join(root, 'server/__tests__/b.test.js');
const KA = '__tests__/a.test.js';
const KB = '__tests__/b.test.js';

let tmp;
let tmps = [];
// A new, empty folder. Every test starts with one; a test that checks several cases calls it between them.
function fresh() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-'));
  tmps.push(tmp);
}
beforeEach(fresh);
afterEach(() => {
  for (const t of tmps) fs.rmSync(t, { recursive: true, force: true });
  tmps = [];
});

const p = n => path.join(tmp, n);
const writeJson = (n, o) => { fs.writeFileSync(p(n), JSON.stringify(o)); return p(n); };
const file = (name, assertions) => ({
  name,
  status: assertions.some(a => a[1] === 'failed') ? 'failed' : 'passed',
  assertionResults: assertions.map(([fullName, st]) => ({ fullName, status: st })),
});
const suiteFail = name => ({ name, status: 'failed', assertionResults: [] });
const jestJson = files => ({ testResults: files });
const claimsFile = lines => { fs.writeFileSync(p('test-issues.md'), lines.join('\n') + '\n'); return p('test-issues.md'); };
const run = (...args) => spawnSync('node', [TC, ...args], { cwd: root, encoding: 'utf8' });
const readNow = () => JSON.parse(fs.readFileSync(p('now.json'), 'utf8'));
const flakyPath = () => p('flaky-tests.md');
const NOT_CLAIMED = 'failing test is NOT claimed as a test defect (source bug, not test repair)';

describe('sdlc-testcheck unclaimed', () => {
  test('prints the failing keys that are not claimed, a failed suite by its suite key, and nothing when all pass or are claimed', () => {
    let now = writeJson('now.json', jestJson([
      file(FA, [['one', 'failed'], ['two', 'failed'], ['ok', 'passed']]),
      file(FB, [['three', 'failed']]),
    ]));
    let r = run('unclaimed', now, claimsFile(['server/__tests__/a.test.js :: two :: spec says so']));
    expect(r.status).toBe(0);
    expect(r.stdout.split('\n').filter(Boolean).sort()).toEqual([`${KA}::one`, `${KB}::three`]);

    // all failures are claimed
    fresh();
    now = writeJson('now.json', jestJson([file(FA, [['one', 'failed'], ['ok', 'passed']])]));
    r = run('unclaimed', now, claimsFile(['server/__tests__/a.test.js :: one :: spec']));
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');

    // a missing claim file means nothing is claimed
    r = run('unclaimed', now, p('absent.md'));
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(`${KA}::one`);

    // all tests pass
    fresh();
    now = writeJson('now.json', jestJson([file(FA, [['ok', 'passed']])]));
    r = run('unclaimed', now, p('absent.md'));
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');

    // a suite that failed to run
    fresh();
    now = writeJson('now.json', jestJson([suiteFail(FA)]));
    expect(run('unclaimed', now, p('absent.md')).stdout.trim()).toBe(`${KA}::<suite failed to run>`);
  });

  test('unclaimed and merge-retry without arguments give usage and exit 1', () => {
    for (const cmd of ['unclaimed', 'merge-retry']) {
      const r = run(cmd);
      expect([cmd, r.status]).toEqual([cmd, 1]);
      expect(r.stderr).toMatch(/usage/i);
    }
  });
});

describe('sdlc-testcheck merge-retry', () => {
  const FLAKY = key => `${key} :: first run: failed :: re-run: passed`;
  const WARNING = key => `WARNING: flaky test passed on re-run, not rejected: ${key}`;

  test('a key that passed on re-run is marked passed, with a WARNING and a line appended to flaky-tests.md; the rest of now.json is unchanged', () => {
    fs.writeFileSync(flakyPath(), 'earlier line\n');
    const before = jestJson([
      file(FA, [['flaky', 'failed'], ['keep pass', 'passed'], ['keep fail', 'failed']]),
      file(FB, [['b ok', 'passed']]),
    ]);
    before.numTotalTests = 4;
    const now = writeJson('now.json', before);
    const re = writeJson('retry-1.json', jestJson([file(FA, [['flaky', 'passed']])]));
    const r = run('merge-retry', now, claimsFile([]), flakyPath(), re);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(WARNING(`${KA}::flaky`));
    expect(fs.readFileSync(flakyPath(), 'utf8').split('\n').filter(Boolean)).toEqual(['earlier line', FLAKY(`${KA}::flaky`)]);
    const expected = JSON.parse(JSON.stringify(before));
    expected.testResults[0].assertionResults[0].status = 'passed';
    expect(readNow()).toEqual(expected);
  });

  test('several re-run files are treated together, and a suite that failed to run counts as passed when it passes on re-run', () => {
    let now = writeJson('now.json', jestJson([file(FA, [['a1', 'failed']]), file(FB, [['b1', 'failed']])]));
    const r1 = writeJson('retry-1.json', jestJson([file(FA, [['a1', 'passed']])]));
    const r2 = writeJson('retry-2.json', jestJson([file(FB, [['b1', 'passed']])]));
    let r = run('merge-retry', now, claimsFile([]), flakyPath(), r1, r2);
    expect(r.stdout.match(/WARNING: flaky test passed on re-run, not rejected: /g)).toHaveLength(2);
    expect(fs.readFileSync(flakyPath(), 'utf8').split('\n').filter(Boolean)).toHaveLength(2);
    expect(run('unclaimed', now, p('absent.md')).stdout).toBe('');

    fresh();
    now = writeJson('now.json', jestJson([suiteFail(FA)]));
    const re = writeJson('retry-1.json', jestJson([file(FA, [['t', 'passed']])]));
    r = run('merge-retry', now, claimsFile([]), flakyPath(), re);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(WARNING(`${KA}::<suite failed to run>`));
    expect(fs.readFileSync(flakyPath(), 'utf8').trim()).toBe(FLAKY(`${KA}::<suite failed to run>`));
    expect(run('unclaimed', now, p('absent.md')).stdout).toBe('');
  });

  test('a key that fails again, is missing from the re-run, or has an unreadable re-run file stays failing: nothing is written', () => {
    // failed again: precheck rejects it
    let before = jestJson([file(FA, [['broken', 'failed']])]);
    let now = writeJson('now.json', before);
    let cl = claimsFile(['server/__tests__/a.test.js :: other :: spec']);
    let re = writeJson('retry-1.json', jestJson([file(FA, [['broken', 'failed']])]));
    let r = run('merge-retry', now, cl, flakyPath(), re);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('WARNING');
    expect(readNow()).toEqual(before);
    expect(fs.existsSync(flakyPath())).toBe(false);
    const pc = run('precheck', now, cl, '3');
    expect(pc.status).toBe(1);
    expect(pc.stderr).toContain(`${NOT_CLAIMED}: ${KA}::broken`);

    // missing from the re-run JSON
    fresh();
    now = writeJson('now.json', jestJson([file(FA, [['gone', 'failed']])]));
    cl = claimsFile([]);
    re = writeJson('retry-1.json', jestJson([file(FB, [['unrelated', 'passed']])]));
    r = run('merge-retry', now, cl, flakyPath(), re);
    expect(r.status).toBe(0);
    expect(readNow().testResults[0].assertionResults[0].status).toBe('failed');
    expect(fs.existsSync(flakyPath())).toBe(false);
    expect(run('precheck', now, cl, '3').stderr).toContain(`${NOT_CLAIMED}: ${KA}::gone`);

    // unparseable and non-existent re-run files do not crash
    fresh();
    now = writeJson('now.json', jestJson([file(FA, [['x', 'failed']])]));
    fs.writeFileSync(p('retry-1.json'), '{not json');
    r = run('merge-retry', now, claimsFile([]), flakyPath(), p('retry-1.json'), p('retry-absent.json'));
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(readNow().testResults[0].assertionResults[0].status).toBe('failed');
    expect(fs.existsSync(flakyPath())).toBe(false);

    // a suite that fails to run again
    fresh();
    now = writeJson('now.json', jestJson([suiteFail(FA)]));
    re = writeJson('retry-1.json', jestJson([suiteFail(FA)]));
    run('merge-retry', now, claimsFile([]), flakyPath(), re);
    expect(run('unclaimed', now, p('absent.md')).stdout.trim()).toBe(`${KA}::<suite failed to run>`);
    expect(fs.existsSync(flakyPath())).toBe(false);

    // an empty retry set writes nothing and prints nothing
    fresh();
    before = jestJson([file(FA, [['ok', 'passed']])]);
    now = writeJson('now.json', before);
    r = run('merge-retry', now, claimsFile([]), flakyPath());
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(fs.existsSync(flakyPath())).toBe(false);
    expect(readNow()).toEqual(before);
  });

  test('a claimed failing key is never changed or listed, and precheck exits 0 once every unclaimed failure was flaky', () => {
    let now = writeJson('now.json', jestJson([file(FA, [['claimed', 'failed'], ['loose', 'failed']])]));
    let cl = claimsFile(['server/__tests__/a.test.js :: claimed :: spec']);
    let re = writeJson('retry-1.json', jestJson([file(FA, [['claimed', 'passed'], ['loose', 'passed']])]));
    const r = run('merge-retry', now, cl, flakyPath(), re);
    expect(r.status).toBe(0);
    const a = readNow().testResults[0].assertionResults;
    expect(a.find(x => x.fullName === 'claimed').status).toBe('failed');
    expect(a.find(x => x.fullName === 'loose').status).toBe('passed');
    expect(fs.readFileSync(flakyPath(), 'utf8')).not.toContain('claimed');
    expect(fs.readFileSync(flakyPath(), 'utf8')).toContain(`${KA}::loose`);
    expect(r.stdout).not.toContain(`${KA}::claimed`);

    fresh();
    now = writeJson('now.json', jestJson([file(FA, [['claimed', 'failed'], ['flaky', 'failed']])]));
    cl = claimsFile(['server/__tests__/a.test.js :: claimed :: the spec says so']);
    re = writeJson('retry-1.json', jestJson([file(FA, [['flaky', 'passed']])]));
    expect(run('precheck', now, cl, '3').status).toBe(1);
    run('merge-retry', now, cl, flakyPath(), re);
    const pc = run('precheck', now, cl, '3');
    expect(pc.stderr).toBe('');
    expect(pc.status).toBe(0);
  });
});

describe('sdlc-testcheck retry-plan', () => {
  const plan = keys => {
    const r = spawnSync('node', [TC, 'retry-plan'], { cwd: root, encoding: 'utf8', input: keys.join('\n') + '\n' });
    expect(r.status).toBe(0);
    return r.stdout.split('\n').filter(Boolean).map(l => l.split('\t'));
  };

  test('names give an anchored, escaped pattern that matches only them: one line per file, an alternation for several names', () => {
    const name = 'adds (a) item.[x] to cart';
    const [[f, pat]] = plan([`${KA}::${name}`]);
    expect(f).toBe(KA);
    expect(pat.startsWith('^')).toBe(true);
    expect(pat.endsWith('$')).toBe(true);
    let re = new RegExp(pat);
    expect(re.test(name)).toBe(true);
    expect(re.test('adds a item.x to cart')).toBe(false);
    expect(re.test('adds (a) itemZx to cart')).toBe(false);
    expect(re.test(name + ' extra')).toBe(false);
    expect(re.test('prefix ' + name)).toBe(false);

    const names = ['first (one)', 'second.two', 'third [3]'];
    const out = plan(names.map(n => `${KA}::${n}`));
    expect(out).toHaveLength(1);
    re = new RegExp(out[0][1]);
    names.forEach(n => expect(re.test(n)).toBe(true));
    expect(re.test('first one')).toBe(false);
    expect(re.test('secondXtwo')).toBe(false);
    expect(re.test('first (one) second.two')).toBe(false);

    expect(plan([`${KA}::x`, `${KB}::y`, `${KA}::z`]).map(o => o[0]).sort()).toEqual([KA, KB]);
  });

  test('a suite-failed-to-run key gives an empty pattern (the whole file), also next to named keys; empty input prints nothing', () => {
    let out = plan([`${KA}::<suite failed to run>`]);
    expect(out).toHaveLength(1);
    expect(out[0][0]).toBe(KA);
    expect(out[0][1] || '').toBe('');

    out = plan([`${KA}::named`, `${KA}::<suite failed to run>`, `${KB}::other`]);
    expect(out.find(o => o[0] === KA)[1] || '').toBe('');
    expect(out.find(o => o[0] === KB)[1]).toMatch(/^\^.*\$$/);

    const r = spawnSync('node', [TC, 'retry-plan'], { cwd: root, encoding: 'utf8', input: '' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });
});

describe('precheck justification', () => {
  test('a claim citing the spec, the plan, a decision or an isolation defect passes; one with no such reason is rejected', () => {
    const now = writeJson('now.json', jestJson([file(FA, [['t', 'failed']])]));
    for (const why of ['contradicts specs-1.md §6', 'plan-1.md step 4 replaces console.error', 'decision Q2 says so', 'leaked mock from another test']) {
      const r = run('precheck', now, claimsFile([`server/${KA} :: t :: ${why}`]), '3');
      expect([why, r.status, r.stderr]).toEqual([why, 0, '']);
    }
    const r = run('precheck', now, claimsFile([`server/${KA} :: t :: it is just wrong`]), '3');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`claim gives no spec/plan/decision/isolation justification: ${KA}::t`);
  });
});
