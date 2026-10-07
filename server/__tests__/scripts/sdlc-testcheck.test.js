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
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

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
const NOT_CLAIMED = 'failing test is NOT claimed as a test defect';

describe('sdlc-testcheck unclaimed', () => {
  test('prints only failing keys that are not claimed', () => {
    const now = writeJson('now.json', jestJson([
      file(FA, [['one', 'failed'], ['two', 'failed'], ['ok', 'passed']]),
      file(FB, [['three', 'failed']]),
    ]));
    const cl = claimsFile(['server/__tests__/a.test.js :: two :: spec says so']);
    const r = run('unclaimed', now, cl);
    expect(r.status).toBe(0);
    expect(r.stdout.split('\n').filter(Boolean).sort()).toEqual([`${KA}::one`, `${KB}::three`]);
  });

  test('prints nothing when all failures are claimed', () => {
    const now = writeJson('now.json', jestJson([file(FA, [['one', 'failed'], ['ok', 'passed']])]));
    const cl = claimsFile(['server/__tests__/a.test.js :: one :: spec']);
    const r = run('unclaimed', now, cl);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });

  test('missing claim file means nothing is claimed', () => {
    const now = writeJson('now.json', jestJson([file(FA, [['one', 'failed']])]));
    const r = run('unclaimed', now, p('absent.md'));
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(`${KA}::one`);
  });

  test('prints nothing when all tests pass', () => {
    const now = writeJson('now.json', jestJson([file(FA, [['ok', 'passed']])]));
    const r = run('unclaimed', now, p('absent.md'));
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });

  test('suite that failed to run is listed with the suite key', () => {
    const now = writeJson('now.json', jestJson([suiteFail(FA)]));
    const r = run('unclaimed', now, p('absent.md'));
    expect(r.stdout.trim()).toBe(`${KA}::<suite failed to run>`);
  });

  test('missing arguments give usage and exit 1', () => {
    const r = run('unclaimed');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/usage/i);
  });
});

describe('sdlc-testcheck merge-retry', () => {
  test('marks a key that passed on re-run as passed, writes the line and the WARNING', () => {
    const now = writeJson('now.json', jestJson([file(FA, [['flaky one', 'failed'], ['ok', 'passed']])]));
    const cl = claimsFile([]);
    const re = writeJson('retry-1.json', jestJson([file(FA, [['flaky one', 'passed']])]));
    const r = run('merge-retry', now, cl, flakyPath(), re);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`WARNING: flaky test passed on re-run, not rejected: ${KA}::flaky one`);
    expect(fs.readFileSync(flakyPath(), 'utf8').trim()).toBe(`${KA}::flaky one :: first run: failed :: re-run: passed`);
    expect(readNow().testResults[0].assertionResults.find(a => a.fullName === 'flaky one').status).toBe('passed');
  });

  test('a key that failed again stays failing and precheck rejects it', () => {
    const now = writeJson('now.json', jestJson([file(FA, [['broken', 'failed']])]));
    const cl = claimsFile(['server/__tests__/a.test.js :: other :: spec']);
    const re = writeJson('retry-1.json', jestJson([file(FA, [['broken', 'failed']])]));
    const r = run('merge-retry', now, cl, flakyPath(), re);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('WARNING');
    expect(readNow().testResults[0].assertionResults[0].status).toBe('failed');
    const pc = run('precheck', now, cl, '3');
    expect(pc.status).toBe(1);
    expect(pc.stderr).toContain(`${NOT_CLAIMED}: ${KA}::broken`);
  });

  test('a key missing from the re-run JSON stays failing', () => {
    const now = writeJson('now.json', jestJson([file(FA, [['gone', 'failed']])]));
    const cl = claimsFile([]);
    const re = writeJson('retry-1.json', jestJson([file(FB, [['unrelated', 'passed']])]));
    const r = run('merge-retry', now, cl, flakyPath(), re);
    expect(r.status).toBe(0);
    expect(readNow().testResults[0].assertionResults[0].status).toBe('failed');
    expect(fs.existsSync(flakyPath())).toBe(false);
    expect(run('precheck', now, cl, '3').stderr).toContain(`${NOT_CLAIMED}: ${KA}::gone`);
  });

  test('a claimed failing key is never changed or listed even if it passes in the re-run', () => {
    const now = writeJson('now.json', jestJson([file(FA, [['claimed', 'failed'], ['loose', 'failed']])]));
    const cl = claimsFile(['server/__tests__/a.test.js :: claimed :: spec']);
    const re = writeJson('retry-1.json', jestJson([file(FA, [['claimed', 'passed'], ['loose', 'passed']])]));
    const r = run('merge-retry', now, cl, flakyPath(), re);
    expect(r.status).toBe(0);
    const a = readNow().testResults[0].assertionResults;
    expect(a.find(x => x.fullName === 'claimed').status).toBe('failed');
    expect(a.find(x => x.fullName === 'loose').status).toBe('passed');
    expect(fs.readFileSync(flakyPath(), 'utf8')).not.toContain('claimed');
    expect(fs.readFileSync(flakyPath(), 'utf8')).toContain(`${KA}::loose`);
    expect(r.stdout).not.toContain(`${KA}::claimed`);
  });

  test('precheck exits 0 when every unclaimed failure was flaky (valid claims)', () => {
    const now = writeJson('now.json', jestJson([file(FA, [['claimed', 'failed'], ['flaky', 'failed']])]));
    const cl = claimsFile(['server/__tests__/a.test.js :: claimed :: the spec says so']);
    const re = writeJson('retry-1.json', jestJson([file(FA, [['flaky', 'passed']])]));
    expect(run('precheck', now, cl, '3').status).toBe(1);
    run('merge-retry', now, cl, flakyPath(), re);
    const pc = run('precheck', now, cl, '3');
    expect(pc.stderr).toBe('');
    expect(pc.status).toBe(0);
  });

  test('all other entries of now.json stay unchanged', () => {
    const before = jestJson([
      file(FA, [['flaky', 'failed'], ['keep pass', 'passed'], ['keep fail', 'failed']]),
      file(FB, [['b ok', 'passed']]),
    ]);
    before.numTotalTests = 4;
    const now = writeJson('now.json', before);
    const re = writeJson('retry-1.json', jestJson([file(FA, [['flaky', 'passed']])]));
    run('merge-retry', now, claimsFile([]), flakyPath(), re);
    const expected = JSON.parse(JSON.stringify(before));
    expected.testResults[0].assertionResults[0].status = 'passed';
    expect(readNow()).toEqual(expected);
  });

  test('flaky-tests.md is not created and now.json is not changed when nothing is flaky', () => {
    const before = jestJson([file(FA, [['x', 'failed']])]);
    const now = writeJson('now.json', before);
    const re = writeJson('retry-1.json', jestJson([file(FA, [['x', 'failed']])]));
    const r = run('merge-retry', now, claimsFile([]), flakyPath(), re);
    expect(r.status).toBe(0);
    expect(fs.existsSync(flakyPath())).toBe(false);
    expect(readNow()).toEqual(before);
  });

  test('empty retry set writes nothing and prints nothing', () => {
    const before = jestJson([file(FA, [['ok', 'passed']])]);
    const now = writeJson('now.json', before);
    const r = run('merge-retry', now, claimsFile([]), flakyPath());
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(fs.existsSync(flakyPath())).toBe(false);
    expect(readNow()).toEqual(before);
  });

  test('a suite that failed to run and passes on re-run counts as passed', () => {
    const now = writeJson('now.json', jestJson([suiteFail(FA)]));
    const re = writeJson('retry-1.json', jestJson([file(FA, [['t', 'passed']])]));
    const r = run('merge-retry', now, claimsFile([]), flakyPath(), re);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`WARNING: flaky test passed on re-run, not rejected: ${KA}::<suite failed to run>`);
    expect(fs.readFileSync(flakyPath(), 'utf8').trim()).toBe(`${KA}::<suite failed to run> :: first run: failed :: re-run: passed`);
    expect(run('unclaimed', now, p('absent.md')).stdout).toBe('');
  });

  test('a suite that fails to run again stays failing', () => {
    const now = writeJson('now.json', jestJson([suiteFail(FA)]));
    const re = writeJson('retry-1.json', jestJson([suiteFail(FA)]));
    run('merge-retry', now, claimsFile([]), flakyPath(), re);
    expect(run('unclaimed', now, p('absent.md')).stdout.trim()).toBe(`${KA}::<suite failed to run>`);
    expect(fs.existsSync(flakyPath())).toBe(false);
  });

  test('unparseable and non-existent re-run files do not crash; keys stay failing', () => {
    const now = writeJson('now.json', jestJson([file(FA, [['x', 'failed']])]));
    fs.writeFileSync(p('retry-1.json'), '{not json');
    const r = run('merge-retry', now, claimsFile([]), flakyPath(), p('retry-1.json'), p('retry-absent.json'));
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(readNow().testResults[0].assertionResults[0].status).toBe('failed');
    expect(fs.existsSync(flakyPath())).toBe(false);
  });

  test('results of several re-run files are treated together', () => {
    const now = writeJson('now.json', jestJson([file(FA, [['a1', 'failed']]), file(FB, [['b1', 'failed']])]));
    const r1 = writeJson('retry-1.json', jestJson([file(FA, [['a1', 'passed']])]));
    const r2 = writeJson('retry-2.json', jestJson([file(FB, [['b1', 'passed']])]));
    const r = run('merge-retry', now, claimsFile([]), flakyPath(), r1, r2);
    expect(r.stdout.match(/WARNING: flaky test passed on re-run, not rejected: /g)).toHaveLength(2);
    expect(fs.readFileSync(flakyPath(), 'utf8').split('\n').filter(Boolean)).toHaveLength(2);
    expect(run('unclaimed', now, p('absent.md')).stdout).toBe('');
  });

  test('flaky lines are appended to an existing flaky-tests.md', () => {
    fs.writeFileSync(flakyPath(), 'earlier line\n');
    const now = writeJson('now.json', jestJson([file(FA, [['f', 'failed']])]));
    const re = writeJson('retry-1.json', jestJson([file(FA, [['f', 'passed']])]));
    run('merge-retry', now, claimsFile([]), flakyPath(), re);
    const lines = fs.readFileSync(flakyPath(), 'utf8').split('\n').filter(Boolean);
    expect(lines).toEqual(['earlier line', `${KA}::f :: first run: failed :: re-run: passed`]);
  });

  test('missing arguments give usage and exit 1', () => {
    const r = run('merge-retry');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/usage/i);
  });
});

describe('sdlc-testcheck retry-plan', () => {
  const plan = keys => {
    const r = spawnSync('node', [TC, 'retry-plan'], { cwd: root, encoding: 'utf8', input: keys.join('\n') + '\n' });
    expect(r.status).toBe(0);
    return r.stdout.split('\n').filter(Boolean).map(l => l.split('\t'));
  };

  test('a single name gives an anchored, escaped pattern that matches only that name', () => {
    const name = 'adds (a) item.[x] to cart';
    const [[f, pat]] = plan([`${KA}::${name}`]);
    expect(f).toBe(KA);
    expect(pat.startsWith('^')).toBe(true);
    expect(pat.endsWith('$')).toBe(true);
    const re = new RegExp(pat);
    expect(re.test(name)).toBe(true);
    expect(re.test('adds a item.x to cart')).toBe(false);
    expect(re.test('adds (a) itemZx to cart')).toBe(false);
    expect(re.test(name + ' extra')).toBe(false);
    expect(re.test('prefix ' + name)).toBe(false);
  });

  test('several names in one file give one line with an alternation', () => {
    const names = ['first (one)', 'second.two', 'third [3]'];
    const out = plan(names.map(n => `${KA}::${n}`));
    expect(out).toHaveLength(1);
    const re = new RegExp(out[0][1]);
    names.forEach(n => expect(re.test(n)).toBe(true));
    expect(re.test('first one')).toBe(false);
    expect(re.test('secondXtwo')).toBe(false);
    expect(re.test('first (one) second.two')).toBe(false);
  });

  test('one line per distinct file', () => {
    const out = plan([`${KA}::x`, `${KB}::y`, `${KA}::z`]);
    expect(out.map(o => o[0]).sort()).toEqual([KA, KB]);
  });

  test('a suite-failed-to-run key gives an empty pattern', () => {
    const out = plan([`${KA}::<suite failed to run>`]);
    expect(out).toHaveLength(1);
    expect(out[0][0]).toBe(KA);
    expect(out[0][1] || '').toBe('');
  });

  test('a suite key together with named keys runs the whole file', () => {
    const out = plan([`${KA}::named`, `${KA}::<suite failed to run>`, `${KB}::other`]);
    expect(out.find(o => o[0] === KA)[1] || '').toBe('');
    expect(out.find(o => o[0] === KB)[1]).toMatch(/^\^.*\$$/);
  });

  test('empty input prints nothing', () => {
    const r = spawnSync('node', [TC, 'retry-plan'], { cwd: root, encoding: 'utf8', input: '' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });
});
