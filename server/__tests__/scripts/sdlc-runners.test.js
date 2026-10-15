const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const helper = path.join(root, 'scripts/sdlc-runners.cjs');
const CHECK = path.join(root, 'scripts/sdlc-testcheck.cjs');
const runners = require(helper);
const { parseJestLike, parseMocha, mochaCrashFile, parseNodeTest, parseJUnit, globToRegex, suiteFiles, mochaConfigWithoutSpec, run } = runners;

// Real output of each runner for test/math.test.js (pass, fail, nested, skipped) and test/broken.test.js (throws on
// load), recorded from a project at /project (scripts/sdlc-node-test-reporter.mjs for node:test, Node 18 and 22).
const FIX = path.join(__dirname, 'fixtures/runners');
const fixture = f => fs.readFileSync(path.join(FIX, f), 'utf8');
const NODE_MODULES = path.join(root, 'server/node_modules');

const project = files => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-runners-'));
  for (const [f, v] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), typeof v === 'string' ? v : JSON.stringify(v));
  }
  return dir;
};
const keys = parts => parts.tests.map(t => `${t.status} ${t.file} :: ${t.name}`).sort();
const MATH = [
  'failed test/math.test.js :: math fails', 'passed test/math.test.js :: math adds', 'passed test/math.test.js :: math inner deep',
  'passed test/math.test.js :: top level', 'skipped test/math.test.js :: math skipped one',
];

describe('parsing each runner\'s report', () => {
  test('jest, vitest and mocha report the same tests, statuses and broken file', () => {
    const jest = parseJestLike(JSON.parse(fixture('jest.json')), { root: '/project' });
    const vitest = parseJestLike(JSON.parse(fixture('vitest.json')), { root: '/project' });
    const mocha = parseMocha(JSON.parse(fixture('mocha.json')), { root: '/project' });
    for (const parts of [jest, vitest, mocha]) expect(keys(parts)).toEqual(MATH);
    expect(jest.suiteErrors).toEqual([expect.objectContaining({ file: 'test/broken.test.js' })]);
    expect(vitest.suiteErrors[0]).toEqual({ file: 'test/broken.test.js', message: expect.stringContaining('boom at load') });
    expect(jest.tests.find(t => t.status === 'failed').message).toContain('assert.strictEqual');
    expect(mocha.tests.find(t => t.status === 'failed').message).toMatch(/1 !== 2|Expected values to be strictly equal/);
    expect(mochaCrashFile(fixture('mocha-broken.err'), '/project')).toBe('test/broken.test.js');
    expect(mochaCrashFile('Error at node:internal/x.js:1:2\n at (/elsewhere/node_modules/a/b.js:3:4)', '/project')).toBeNull();
  });

  test('node:test on Node 18 and 22: full names from nesting, containers left out, skip and todo, a file that fails to load', () => {
    for (const v of ['18', '22']) {
      const parts = parseNodeTest(fixture(`node-test-${v}.jsonl`), { root: '/project' });
      expect(keys(parts)).toEqual([...MATH.slice(0, 3), 'passed test/math.test.js :: parent child ok', MATH[3],
        'skipped test/math.test.js :: math later', MATH[4]].sort());
      expect(parts.suiteErrors.map(e => e.file)).toEqual(['test/broken.test.js']);
    }
  });

  test('node:test on Node 18 names ES module files by file: URL; they come out as paths', () => {
    const lines = [
      { event: 'start', name: 'esm ok', nesting: 0, file: 'file:///project/src/a.test.mjs' },
      { event: 'pass', name: 'esm ok', nesting: 0, file: 'file:///project/src/a.test.mjs' },
      { event: 'fail', name: 'file:///project/src/b.test.mjs', nesting: 0, file: 'file:///project/src/b.test.mjs', failureType: 'testCodeFailure', message: 'boom' },
    ].map(l => JSON.stringify(l)).join('\n');
    const parts = parseNodeTest(lines, { root: '/project' });
    expect(parts.tests).toEqual([{ file: 'src/a.test.mjs', name: 'esm ok', status: 'passed', message: null }]);
    expect(parts.suiteErrors).toEqual([{ file: 'src/b.test.mjs', message: 'boom' }]);
  });

  test('JUnit XML: nested suites, classnames, file attributes, failures, errors, skips and entities', () => {
    const xml = `<?xml version="1.0"?><testsuites>
      <testsuite name="test/a.test.js" file="test/a.test.js">
        <testsuite name="math">
          <testcase name="adds" classname="test"/>
          <testcase name="fails &amp; &lt;stops&gt;" classname="test"><failure message="1 &quot;!=&quot; 2">trace</failure></testcase>
          <testcase name="later"><skipped/></testcase>
        </testsuite>
      </testsuite>
      <testsuite name="jest tests"><testcase classname="api returns 404" name="returns 404" file="src/api.test.ts"><error message="boom"/></testcase></testsuite>
    </testsuites>`;
    const parts = parseJUnit(xml, { root: '/project' });
    expect(parts.tests).toEqual([
      { file: 'test/a.test.js', name: 'math adds', status: 'passed', message: null },
      { file: 'test/a.test.js', name: 'math fails & <stops>', status: 'failed', message: '1 "!=" 2' },
      { file: 'test/a.test.js', name: 'math later', status: 'skipped', message: null },
      { file: 'src/api.test.ts', name: 'api returns 404', status: 'failed', message: 'boom' },
    ]);
  });
});

describe('test files and settings', () => {
  test('globs: **, *, ?, classes, braces and extglobs', () => {
    const m = (g, p) => new RegExp(globToRegex(g)).test(p);
    expect(m('__tests__/**', '__tests__/a/b.test.js')).toBe(true);
    expect(m('**/__tests__/**/*.[jt]s?(x)', '__tests__/a.test.js')).toBe(true);
    expect(m('**/__tests__/**/*.[jt]s?(x)', 'src/__tests__/deep/a.test.tsx')).toBe(true);
    expect(m('**/?(*.)+(spec|test).[jt]s?(x)', 'src/a.spec.ts')).toBe(true);
    expect(m('**/?(*.)+(spec|test).[jt]s?(x)', 'src/a.ts')).toBe(false);
    expect(m('test/**/*.{js,cjs,mjs,ts}', 'test/x.mjs')).toBe(true);
    expect(m('test/*.test.js', 'test/sub/x.test.js')).toBe(false);
    expect(m('a.b?', 'a.bc')).toBe(true);
    expect(m('a.b?', 'axbc')).toBe(false);

    const dir = project({ 'pkg/test/a.test.js': '', 'pkg/test/sub/b.test.js': '', 'pkg/test/helper.js': '', 'pkg/node_modules/x/test/c.test.js': '', 'pkg/.cache/test/d.test.js': '' });
    expect(suiteFiles(dir, { dir: 'pkg', testGlobs: ['test/**/*.test.js'] })).toEqual(['pkg/test/a.test.js', 'pkg/test/sub/b.test.js']);
  });

  test('mocha settings without spec, from .mocharc.json (with comments), .yml, .cjs and package.json', () => {
    expect(mochaConfigWithoutSpec(project({ '.mocharc.json': '{ // c\n "spec": "test/**", /* x */ "timeout": 5000, "require": ["./setup.js"] }\n' })))
      .toEqual({ timeout: 5000, require: ['./setup.js'] });
    expect(mochaConfigWithoutSpec(project({ '.mocharc.yml': "spec: 'test/**'\nrecursive: true\nnode-option:\n  - import=tsx\n" })))
      .toEqual({ recursive: true, 'node-option': ['import=tsx'] });
    expect(mochaConfigWithoutSpec(project({ '.mocharc.cjs': "module.exports = { spec: ['a'], ui: 'tdd' };\n", 'package.json': { mocha: { ui: 'bdd', timeout: 9 } } })))
      .toEqual({ ui: 'tdd', timeout: 9 });
    expect(mochaConfigWithoutSpec(project({}))).toEqual({});
  });
});

describe('running', () => {
  const suite = (runner, extra = {}) => ({ name: 's', dir: '.', runner, packageManager: 'npm', testGlobs: ['test/**/*.test.js'], testCmd: '', ...extra });
  const nodeTestFiles = {
    'test/math.test.js': "const { describe, it } = require('node:test');\nconst assert = require('node:assert');\n"
      + "describe('math', () => {\n  it('adds', () => assert.strictEqual(1 + 1, 2));\n  it('fails', () => assert.strictEqual(1, 2));\n});\n",
    'test/broken.test.js': "throw new Error('boom at load');\n",
  };

  test('node:test: the project\'s own command with the reporter added; a narrowed run re-runs the file', () => {
    const dir = project(nodeTestFiles);
    const all = run(suite('node-test', { testCmd: 'node --test test/math.test.js test/broken.test.js' }), { root: dir });
    expect(all).toMatchObject({ runner: 'node-test', ok: false, exitCode: 1, command: 'node --test test/math.test.js test/broken.test.js' });
    expect(keys(all)).toEqual(['failed test/math.test.js :: math fails', 'passed test/math.test.js :: math adds']);
    expect(all.suiteErrors.map(e => e.file)).toEqual(['test/broken.test.js']);

    const one = run(suite('node-test', { testCmd: 'unused' }), { root: dir, files: ['test/math.test.js'], names: ['math adds'] });
    expect(one.command).toBe("node --test 'test/math.test.js'");
    expect(keys(one)).toEqual(keys(all));
    expect(one.suiteErrors).toEqual([]);
  });

  test('jest: whole suite, one file and one test by full name, also from a suite folder below the root', () => {
    const dir = project({
      'server/package.json': { name: 'server' },
      'server/__tests__/a.test.js': "describe('a', () => { test('works', () => {}); test('breaks', () => { expect(1).toBe(2); }); });\n",
      'server/__tests__/b.test.js': "test('b ok', () => {});\n",
    });
    fs.symlinkSync(NODE_MODULES, path.join(dir, 'server/node_modules'));
    const s = suite('jest', { dir: 'server', testGlobs: ['__tests__/**'] });
    const all = run(s, { root: dir });
    expect(all.ok).toBe(false);
    expect(keys(all)).toEqual(['failed server/__tests__/a.test.js :: a breaks', 'passed server/__tests__/a.test.js :: a works', 'passed server/__tests__/b.test.js :: b ok']);
    const one = run(s, { root: dir, files: ['server/__tests__/a.test.js'], names: ['a works'] });
    expect(one.command).toContain("jest --json --outputFile=");
    expect(one.command).toContain("'__tests__/a.test.js' -t '^(?:a works)$'");
    expect(one).toMatchObject({ ok: true, exitCode: 0 });
    expect(keys(one)).toEqual(['passed server/__tests__/a.test.js :: a works', 'skipped server/__tests__/a.test.js :: a breaks']);
  });

  test('generic JUnit: runs the command and reads its report; no report is an error with the output', () => {
    const xml = '<testsuites><testsuite name="suite" file="t/x.test.sh"><testcase name="one"/><testcase name="two"><failure message="no"/></testcase></testsuite></testsuites>';
    const dir = project({ 'make-report.sh': `mkdir -p out && printf '%s' '${xml}' > out/junit.xml && exit 1\n` });
    const r = run(suite('generic-junit', { testCmd: 'sh make-report.sh', report: 'out/junit.xml' }), { root: dir });
    expect(r).toMatchObject({ ok: false, exitCode: 1 });
    expect(keys(r)).toEqual(['failed t/x.test.sh :: suite two', 'passed t/x.test.sh :: suite one']);

    const none = run(suite('generic-junit', { testCmd: 'echo cannot start >&2; exit 127', report: 'out/missing.xml' }), { root: dir });
    expect(none).toMatchObject({ ok: false, exitCode: 127, noReport: true, tests: [] });
    expect(none.suiteErrors[0]).toEqual({ file: null, message: 'cannot start' });
  });

  // vitest and mocha are not installed here: a stand-in for the process writes their recorded reports.
  const fakeRunner = (reportFor, calls) => (sh, [, command], opts) => {
    calls.push({ command, cwd: opts.cwd });
    const out = (command.match(/(?:--outputFile=|output=)'([^']+)'/) || [])[1];
    const { report, stderr = '', status = 1 } = reportFor(command);
    if (report && out) fs.writeFileSync(out, report);
    return { status, stdout: '', stderr };
  };

  test('vitest: the command it builds and the report it reads', () => {
    const calls = [];
    const r = run(suite('vitest', { packageManager: 'pnpm' }), { root: '/project', files: ['test/math.test.js'], names: ['math adds', 'a|b'],
      spawn: fakeRunner(() => ({ report: fixture('vitest.json') }), calls) });
    expect(calls[0].command).toMatch(/^pnpm exec vitest run --reporter=json --outputFile='[^']+' 'test\/math.test.js' -t '\^\(\?:math adds\|a\\\|b\)\$'$/);
    expect(keys(r)).toEqual(MATH);
    expect(r.suiteErrors).toEqual([]);
  });

  test('mocha: one file that fails to load stops mocha, so the files run one by one with a spec-less config', () => {
    const dir = project({ 'test/math.test.js': '', 'test/broken.test.js': '', '.mocharc.json': { spec: 'test/**/*.test.js', timeout: 100 } });
    const calls = [];
    const crash = fixture('mocha-broken.err').replace(/\/project/g, dir);
    const r = run(suite('mocha'), { root: dir, spawn: fakeRunner(command => {
      if (command.includes("'test/broken.test.js'") || !command.includes('--config')) return { stderr: crash };
      return { report: fixture('mocha.json').replace(/\/project/g, dir) };
    }, calls) });
    expect(calls.map(c => c.command.replace(/'[^']*sdlc-run-[^']*'/g, 'TMP'))).toEqual([
      'npx mocha --reporter json --reporter-option output=TMP',
      "npx mocha --reporter json --reporter-option output=TMP --config TMP --no-package 'test/broken.test.js'",
      "npx mocha --reporter json --reporter-option output=TMP --config TMP --no-package 'test/math.test.js'",
    ]);
    expect(keys(r)).toEqual(MATH);
    expect(r.suiteErrors.map(e => e.file)).toEqual(['test/broken.test.js']);
    expect(r.command).toContain('then file by file: test/broken.test.js failed to load');
  });
});

describe('sdlc-testcheck reads RunResult files like Jest output', () => {
  // A project laid out like this repo (tests in server/__tests__), run once by Jest itself and once through the adapter.
  const dir = project({
    'server/package.json': { name: 'server' },
    'server/__tests__/a.test.js': "describe('a', () => { test('works', () => {}); test('breaks', () => { expect(1).toBe(2); }); });\n",
    'server/__tests__/broken.test.js': "throw new Error('boom');\n",
    'issues.md': 'server/__tests__/a.test.js :: a breaks :: contradicts the spec decision\n',
  });
  fs.symlinkSync(NODE_MODULES, path.join(dir, 'server/node_modules'));
  const jestOut = path.join(dir, 'jest.json');
  spawnSync('npx', ['jest', '--json', `--outputFile=${jestOut}`], { cwd: path.join(dir, 'server'), encoding: 'utf8' });
  const runOut = path.join(dir, 'run.json');
  fs.writeFileSync(runOut, JSON.stringify(run({ name: 's', dir: 'server', runner: 'jest', packageManager: 'npm', testGlobs: ['__tests__/**'] }, { root: dir })));
  const check = (...args) => spawnSync('node', [CHECK, ...args], { cwd: dir, encoding: 'utf8' });

  test('unclaimed, namecheck, redcheck and precheck give the same answers', () => {
    const unclaimedJest = check('unclaimed', jestOut, 'issues.md');
    expect(unclaimedJest.stdout).toBe('__tests__/broken.test.js::<suite failed to run>\n');
    expect(check('unclaimed', runOut, 'issues.md').stdout).toBe(unclaimedJest.stdout);
    expect(check('namecheck', jestOut, runOut).status).toBe(0);
    expect(check('namecheck', runOut, jestOut).status).toBe(0);
    expect(check('redcheck', jestOut, runOut).status).toBe(0);
    const pre = r => check('precheck', r, 'issues.md', '3').stderr;
    expect(pre(runOut)).toBe(pre(jestOut));
    expect(pre(runOut)).toContain('failing test is NOT claimed as a test defect (source bug, not test repair): __tests__/broken.test.js::<suite failed to run>');
  });

  test('merge-retry marks an unclaimed failure that passed on re-run as flaky in a RunResult file', () => {
    const now = path.join(dir, 'now.json');
    fs.copyFileSync(runOut, now);
    const retry = path.join(dir, 'retry.json');
    fs.writeFileSync(retry, JSON.stringify({ tests: [{ file: 'server/__tests__/broken.test.js', name: 'x', status: 'passed' }], suiteErrors: [] }));
    const r = check('merge-retry', now, 'issues.md', path.join(dir, 'flaky.md'), retry);
    expect(r.stdout).toContain('WARNING: flaky test passed on re-run, not rejected: __tests__/broken.test.js::<suite failed to run>');
    expect(JSON.parse(fs.readFileSync(now, 'utf8')).suiteErrors).toEqual([]);
    expect(check('unclaimed', now, 'issues.md').stdout).toBe('');
  });
});

describe('command line', () => {
  test('run writes the result and exits 0, 1 or 3; parse converts a report', () => {
    const dir = project({
      'package.json': { scripts: { test: 'node --test test/a.test.js' } },
      'test/a.test.js': "const { test } = require('node:test');\ntest('ok', () => {});\n",
    });
    const out = path.join(dir, 'r.json');
    const ok = spawnSync('node', [helper, 'run', dir, '--out', out], { encoding: 'utf8' });
    expect(ok.stdout).toBe('a (node-test): 1 passed, 0 failed, 0 skipped, 0 file errors\n'.replace('a (', `${path.basename(dir)} (`));
    expect(ok.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(out, 'utf8'))).toMatchObject({ ok: true, tests: [{ file: 'test/a.test.js', name: 'ok', status: 'passed' }] });

    fs.writeFileSync(path.join(dir, 'test/a.test.js'), "const { test } = require('node:test');\ntest('ok', () => { throw new Error('x'); });\n");
    expect(spawnSync('node', [helper, 'run', dir, '--out', out], { encoding: 'utf8' }).status).toBe(1);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test test/a.test.js; exit 0' } }));
    fs.writeFileSync(path.join(dir, 'sdlc.config.json'), JSON.stringify({ suites: [{ runner: 'generic-junit', testCmd: 'true', report: 'none.xml' }] }));
    expect(spawnSync('node', [helper, 'run', dir, '--out', out], { encoding: 'utf8' }).status).toBe(3);

    const parsed = spawnSync('node', [helper, 'parse', 'vitest', path.join(FIX, 'vitest.json'), '--root', '/project'], { encoding: 'utf8' });
    expect(keys(JSON.parse(parsed.stdout))).toEqual(MATH);
    expect(spawnSync('node', [helper, 'parse', 'karma', 'x'], { encoding: 'utf8' }).status).toBe(2);
  });
});
