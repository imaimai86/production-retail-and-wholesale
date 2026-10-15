const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const helper = path.join(root, 'scripts/sdlc-config.cjs');
const { detect, suggest, setupPlan, provision, resolve, testDir, allowedTools, worktreeBase, shellEnv, codeIndexers, agentRules } = require(helper);

// A throwaway project: { 'path/file': text or object (written as JSON) }.
function project(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-config-'));
  for (const [f, v] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), typeof v === 'string' ? v : JSON.stringify(v));
  }
  return dir;
}
const cli = (...args) => spawnSync('node', [helper, ...args], { encoding: 'utf8' });
const noGraft = { PATH: '/usr/bin:/bin' };
const ok = (dir, opts = { env: noGraft }) => {
  const r = resolve(dir, opts);
  expect(r.errors).toEqual([]);
  return r.config;
};
const errorsOf = dir => resolve(dir, { env: noGraft }).errors.join('\n');

describe('detection', () => {
  test('finds jest from a config file, the package.json key, the test script or the dependency, strongest first', () => {
    const [s] = detect(project({ 'package.json': { scripts: { test: 'jest --ci' }, devDependencies: { jest: '^29' }, jest: {} }, 'package-lock.json': '{}' }));
    expect(s).toMatchObject({ dir: '.', runner: 'jest', language: 'javascript', packageManager: 'npm', testCmd: 'npm test' });
    expect(s.evidence).toEqual(['jest: package.json "jest" key', 'jest: scripts.test runs jest', 'jest: dependency jest']);

    const [c] = detect(project({ 'package.json': { devDependencies: { jest: '^29' } }, 'jest.config.ts': '' }));
    expect(c).toMatchObject({ runner: 'jest', testCmd: 'npx jest' });
    expect(c.evidence[0]).toBe('jest: config file jest.config.ts');
  });

  test('vitest with TypeScript, pnpm and its own config; mocha with its spec; node:test from the script', () => {
    const [v] = detect(project({
      'package.json': { scripts: { test: 'vitest' }, devDependencies: { vitest: '^2', typescript: '^5' } },
      'vitest.config.ts': '', 'pnpm-lock.yaml': '',
    }));
    expect(v).toMatchObject({ runner: 'vitest', language: 'typescript', packageManager: 'pnpm', testCmd: 'pnpm test' });

    const [m] = detect(project({ 'package.json': { devDependencies: { mocha: '^10' } }, '.mocharc.json': { spec: './spec/**/*.spec.js' }, 'yarn.lock': '' }));
    expect(m).toMatchObject({ runner: 'mocha', packageManager: 'yarn', testCmd: 'yarn mocha', testGlobs: ['spec/**/*.spec.js'] });

    const [n] = detect(project({ 'package.json': { scripts: { test: 'node --test test/' } }, 'tsconfig.json': '{}' }));
    expect(n).toMatchObject({ runner: 'node-test', language: 'typescript', testCmd: 'npm test' });
  });

  test('scans sub-folders (monorepos), runs their tests from the root, and skips node_modules, dot folders and delegating roots', () => {
    const dir = project({
      'package.json': { scripts: { test: 'npm run test --prefix server' }, devDependencies: { eslint: '^8' } },
      'package-lock.json': '{}',
      'server/package.json': { scripts: { test: 'jest' }, jest: { testMatch: ['<rootDir>/__tests__/**/*.test.js'] } },
      'packages/web/package.json': { scripts: { test: 'vitest run' }, devDependencies: { vitest: '^2' } },
      'packages/web/node_modules/x/package.json': { scripts: { test: 'mocha' } },
      '.claude/plugin/package.json': { scripts: { test: 'mocha' } },
      'a/b/c/package.json': { scripts: { test: 'mocha' } },
    });
    const found = detect(dir);
    expect(found.map(f => [f.dir, f.runner, f.testCmd])).toEqual([
      ['packages/web', 'vitest', 'npm --prefix packages/web test'],
      ['server', 'jest', 'npm --prefix server test'],
    ]);
    expect(found[1].testGlobs).toEqual(['__tests__/**/*.test.js']);
  });

  test('reports a tie as ambiguous, ignores a bare dependency next to real evidence, and finds nothing in an empty project', () => {
    const [t] = detect(project({ 'package.json': { scripts: { test: 'jest && vitest run' } } }));
    expect(t.runner).toBeNull();
    expect(t.candidates.sort()).toEqual(['jest', 'vitest']);
    expect(t.testCmd).toBeUndefined();

    const [d] = detect(project({ 'package.json': { scripts: { test: 'vitest' }, devDependencies: { jest: '^29', vitest: '^2' } } }));
    expect(d.runner).toBe('vitest');

    expect(detect(project({ 'package.json': { scripts: { test: 'echo "Error: no test specified" && exit 1' } } }))).toEqual([]);
    expect(detect(project({ 'README.txt': 'x' }))).toEqual([]);
  });
});

describe('detection in real-world layouts', () => {
  test('follows the scripts a test script runs, and finds a runner called by its path', () => {
    const [s] = detect(project({ 'package.json': {
      scripts: { test: 'npm run lint && npm run cover', cover: 'istanbul cover ../../node_modules/mocha/bin/_mocha -- --recursive', lint: 'eslint .' },
    } }));
    expect(s).toMatchObject({ runner: 'mocha', testCmd: 'npm test' });
    expect(s.evidence).toEqual(['mocha: scripts.cover runs mocha']);

    const [y] = detect(project({ 'package.json': { scripts: { test: 'yarn _test', _test: 'TZ=UTC jest --no-cache' } }, 'yarn.lock': '' }));
    expect(y).toMatchObject({ runner: 'jest', testCmd: 'yarn test' });
  });

  test('a monorepo root with only a hoisted dependency is not a suite; workspace folders are found at any depth', () => {
    const dir = project({
      'package.json': { devDependencies: { mocha: '^10' }, workspaces: ['packages/instruments/*'] },
      'packages/instruments/a/package.json': { scripts: { test: 'vitest run' } },
    });
    expect(detect(dir).map(f => [f.dir, f.runner])).toEqual([['packages/instruments/a', 'vitest']]);

    const pnpm = project({
      'package.json': {}, 'pnpm-workspace.yaml': "packages:\n  - 'tools/**'\n",
      'tools/x/y/z/package.json': { scripts: { test: 'jest' } },
    });
    expect(detect(pnpm).map(f => [f.dir, f.testCmd])).toEqual([['tools/x/y/z', 'pnpm --dir tools/x/y/z test']]);
  });

  test('a root jest config with projects covers the jest packages under it, not packages using another runner', () => {
    const dir = project({
      'package.json': { scripts: { test: 'jest' } },
      'jest.config.js': "module.exports = { projects: ['<rootDir>/packages/**/jest.config.js'] };\n",
      'packages/a/package.json': {}, 'packages/a/jest.config.js': 'module.exports = {};\n',
      'packages/b/package.json': { scripts: { test: 'mocha' } },
    });
    const found = detect(dir);
    expect(found.map(f => [f.dir, f.runner])).toEqual([['.', 'jest'], ['packages/b', 'mocha']]);
    expect(found[0].covers).toEqual(['packages/a']);
  });

  test('an unrecognised runner is reported and skipped with a warning; a script that only hands off to a sub-folder is not', () => {
    const dir = project({
      'package.json': { scripts: { test: 'npm run test --prefix server' } },
      'server/package.json': { scripts: { test: 'jest' } },
      'e2e/package.json': { scripts: { test: 'playwright test' } },
    });
    const found = detect(dir);
    expect(found.map(f => [f.dir, f.runner, Boolean(f.unknown)])).toEqual([['e2e', null, true], ['server', 'jest', false]]);
    const r = resolve(dir, { env: noGraft });
    expect(r.errors).toEqual([]);
    expect(r.config.suites.map(s => s.dir)).toEqual(['server']);
    expect(r.warnings.filter(w => !w.includes('graft'))).toEqual([expect.stringContaining('e2e: skipped, its test script uses a runner that is not recognised (scripts.test: playwright test)')]);
    fs.writeFileSync(path.join(dir, 'sdlc.config.json'), JSON.stringify({ suites: [{ dir: 'e2e' }] }));
    expect(errorsOf(dir)).toContain('suites[0]: the test script in e2e uses a runner that is not recognised; set "runner"');
    const out = cli('detect', dir);
    expect(out.status).toBe(0);
    expect(out.stdout).toContain('e2e: test runner not recognised');
  });
});

describe('settings', () => {
  test('without a file: detected suites plus defaults', () => {
    const dir = project({ 'package.json': { scripts: { test: 'jest' } }, 'package-lock.json': '{}' });
    const c = ok(dir);
    expect(c.suites).toEqual([expect.objectContaining({ dir: '.', runner: 'jest', testCmd: 'npm test', sourceGlobs: ['**'], setup: null, report: null })]);
    expect(c).toMatchObject({
      backlogDir: 'Docs/backlog', integration: null, lint: null,
      worktree: { base: '../{repo}-sdlc', link: ['node_modules'] },
      git: { branchPrefix: 'sdlc/', base: null, conflictSuffixStart: 10001 },
      agent: { allowCommands: [], codeSearch: 'none' },
      ship: { envExample: true, maxFileBytes: 1048576 },
    });
    expect(typeof c.ui.timezone).toBe('string');
    expect(worktreeBase(c)).toBe(path.join(path.dirname(dir), `${path.basename(dir)}-sdlc`));
  });

  test('a file suite is completed from detection; an explicit runner gets that runner\'s defaults; code search auto needs graft on PATH and a graft/ index', () => {
    const dir = project({
      'server/package.json': { scripts: { test: 'jest' } },
      'web/package.json': { devDependencies: { vitest: '^2' } },
      'sdlc.config.json': { suites: [{ dir: 'server/' }, { dir: 'web', runner: 'vitest', name: 'ui' }], agent: { codeSearch: 'auto' } },
    });
    const c = ok(dir);
    expect(c.suites.map(s => [s.name, s.runner, s.testCmd])).toEqual([
      ['server', 'jest', 'npm --prefix server test'],
      ['ui', 'vitest', 'cd web && npx vitest run'],
    ]);
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-bin-'));
    fs.writeFileSync(path.join(bin, 'graft'), '#!/bin/sh\n', { mode: 0o755 });
    expect(ok(dir, { env: { PATH: `${bin}:/usr/bin:/bin` } }).agent.codeSearch).toBe('none');
    fs.mkdirSync(path.join(dir, 'graft'));
    expect(ok(dir, { env: { PATH: `${bin}:/usr/bin:/bin` } }).agent.codeSearch).toBe('graft');
  });

  test('rejects bad files with the setting at fault', () => {
    expect(errorsOf(project({ 'sdlc.config.json': '{ nope' }))).toMatch(/sdlc\.config\.json: not valid JSON/);
    const bad = errorsOf(project({
      'sdlc.config.json': { backlogDir: '', suits: [], git: { conflictSuffixStart: 'x' }, agent: { codeSearch: 'grep' }, suites: [{ runner: 'karma' }] },
    }));
    for (const e of ['backlogDir: must be a non-empty string', 'suits: unknown setting', 'git.conflictSuffixStart: must be a whole number',
      'suites[0].runner: must be one of']) expect(bad).toContain(e);
    expect(errorsOf(project({ 'package.json': { scripts: { test: 'jest' } }, 'sdlc.config.json': { agent: { codeSearch: 'grep' } } })))
      .toContain('agent.codeSearch: "grep" is not a code indexer (use auto, none, graft, graphify)');

    expect(errorsOf(project({ 'sdlc.config.json': { suites: [{ dir: 'missing' }] } }))).toContain('suites[0].dir: folder missing does not exist');
    expect(errorsOf(project({ 'x/a.txt': '', 'sdlc.config.json': { suites: [{ dir: 'x' }] } }))).toContain('suites[0]: no test runner found in x; set "runner"');
    expect(errorsOf(project({ 'x/package.json': { scripts: { test: 'jest; mocha' } }, 'sdlc.config.json': { suites: [{ dir: 'x' }] } })))
      .toMatch(/suites\[0\]: x matches (jest and mocha|mocha and jest) equally; set "runner"/);
    expect(errorsOf(project({ 'sdlc.config.json': { suites: [{ runner: 'generic-junit', testCmd: 'make test' }] } }))).toContain('needs "testCmd" and "report"');
    expect(errorsOf(project({ 'package.json': { scripts: { test: 'jest' } }, 'sdlc.config.json': { ui: { timezone: 'Mars/Base' } } })))
      .toContain('ui.timezone: unknown time zone "Mars/Base"');
    expect(errorsOf(project({ 'package.json': { scripts: { test: 'jest' } }, 'sdlc.config.json': { suites: [{ name: 'a' }, { name: 'a' }] } })))
      .toContain('suite name "a" is used twice');
    expect(errorsOf(project({ 'package.json': {} }))).toContain('no test suite found');
  });

  test('test folder: the fixed part in front of the globs, inside the suite folder', () => {
    expect(testDir({ dir: 'server', testGlobs: ['__tests__/**'] })).toBe('server/__tests__');
    expect(testDir({ dir: '.', testGlobs: ['test/unit/**/*.js', 'test/e2e/*.js'] })).toBe('test');
    expect(testDir({ dir: 'web', testGlobs: ['**/*.test.ts'] })).toBe('web');
    expect(testDir({ dir: '.', testGlobs: ['src/**/*.spec.ts', 'lib/*.spec.ts'] })).toBe('.');
  });
});

describe('this repository', () => {
  // The values the scripts hard-code today; sdlc.config.json must reproduce them exactly.
  const sdlcSh = fs.readFileSync(path.join(root, 'scripts/sdlc.sh'), 'utf8');

  // sdlc.sh's code_search_setup, run in a temp folder with or without graft (a stand-in on PATH and a graft/ index).
  const shAllowed = withGraft => {
    const fn = sdlcSh.slice(sdlcSh.indexOf('code_search_setup() {'), sdlcSh.indexOf('\ncode_search_setup\n'));
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-allowed-'));
    fs.symlinkSync(path.join(root, 'scripts'), path.join(cwd, 'scripts'));
    fs.mkdirSync(path.join(cwd, 'logs'));
    const bin = path.join(cwd, 'bin');
    fs.mkdirSync(bin);
    if (withGraft) { fs.writeFileSync(path.join(bin, 'graft'), '#!/bin/sh\n', { mode: 0o755 }); fs.mkdirSync(path.join(cwd, 'graft')); }
    const rules = `SDLC_AGENT_RULES=(${agentRules(ok(root)).map(r => `'${r}'`).join(' ')})`;
    const r = spawnSync('bash', ['-c', `set -euo pipefail\nLOG=logs\n${rules}\n${fn}\ncode_search_setup >/dev/null\nprintf '%s\\n' "\${ALLOWED[@]}"`],
      { cwd, encoding: 'utf8', env: { PATH: `${bin}:/usr/bin:/bin:${path.dirname(process.execPath)}` } });
    return r.stdout.trim().split('\n');
  };

  // Before the scripts read the settings, these were constants in sdlc.sh and sdlc-mod.sh; the settings must keep them.
  test('sdlc.config.json gives the values sdlc.sh and sdlc-mod.sh used before they read settings', () => {
    const c = ok(root);
    expect(c.suites).toHaveLength(1);
    expect(c.suites[0].testCmd).toBe('npm test');
    expect(testDir(c.suites[0])).toBe('server/__tests__');
    expect(`${c.backlogDir}/index.md`).toBe('Docs/backlog/index.md');
    for (const withGraft of [true, false]) {
      const agent = { ...c.agent, codeSearch: withGraft ? 'graft' : 'none', codeIndexer: withGraft ? codeIndexers({}).graft : null };
      expect(allowedTools({ ...c, agent })).toEqual(shAllowed(withGraft));
    }
    expect(c.worktree.link).toEqual(['server/node_modules', 'node_modules', 'graft', '.env']);
    expect(worktreeBase(c)).toBe(path.join(path.dirname(root), `${path.basename(root)}-sdlc`));
    expect(c.git.branchPrefix).toBe('sdlc/');
    expect(c.integration).toEqual({ cmd: 'bash scripts/sdlc-integration.sh', ci: 'skip' });
    expect(c.ui.timezone).toBe('Asia/Dubai');
  });

  test('detection alone finds the server jest suite', () => {
    expect(detect(root).map(f => [f.dir, f.runner])).toEqual([['server', 'jest']]);
  });
});

describe('command line', () => {
  test('env prints shell assignments that bash can load, arrays included', () => {
    const dir = project({ "it's/package.json": { scripts: { test: 'jest' } }, 'sdlc.config.json': { lint: "echo 'x'" } });
    const r = cli('env', dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(shellEnv(ok(dir, {})));
    const sh = spawnSync('bash', ['-c', 'eval "$1"; printf "%s|" "$SDLC_TEST_CMD" "$SDLC_LINT_CMD" "${SDLC_TEST_DIRS[@]}" "${#SDLC_ALLOWED[@]}"', '_', r.stdout], { encoding: 'utf8' });
    expect(sh.stdout).toBe(`npm --prefix it's test|echo 'x'|it's|${allowedTools(ok(dir, {})).length}|`);
  });

  test('detect and show print results; bad settings exit 1 with the reasons; bad usage exits 2', () => {
    const dir = project({ 'package.json': { scripts: { test: 'vitest' } } });
    expect(cli('detect', dir).stdout).toContain('.: vitest · javascript · npm');
    expect(JSON.parse(cli('detect', dir, '--json').stdout)[0].runner).toBe('vitest');
    expect(JSON.parse(cli('show', dir).stdout).testDirs).toEqual(['.']);

    const tie = cli('detect', project({ 'package.json': { scripts: { test: 'jest; vitest' } } }));
    expect(tie.status).toBe(1);
    expect(tie.stdout).toContain('ambiguous');

    const bad = cli('show', project({ 'sdlc.config.json': { nope: 1 } }));
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('ERROR: sdlc.config.json: nope: unknown setting');

    expect(cli('frobnicate').status).toBe(2);
    expect(cli('show', '/no/such/dir').status).toBe(2);
  });
});

describe('suggestions for a project without tests', () => {
  const runners = s => s.suggestions.map(x => x.runner);

  test('ranks by what the project uses: Vite and React, NestJS, ES modules with a Node that runs TypeScript', () => {
    const vite = suggest(project({ 'package.json': { dependencies: { react: '^18' }, devDependencies: { vite: '^5', typescript: '^5' } }, 'src/a.ts': '' }));
    expect(vite.status).toBe('suggestions');
    expect(runners(vite)).toEqual(['vitest', 'jest', 'mocha', 'node-test']);
    expect(vite.suggestions[0]).toMatchObject({ recommended: true, install: 'npm install -D vitest jsdom' });
    expect(vite.suggestions[0].why).toContain('the project uses Vite: Vitest reuses vite.config');
    expect(vite.suggestions[3].caveats).toContain('no browser DOM for react components');
    expect(vite.suggestions[0].adds).toEqual({ script: 'vitest run', files: ['src/example.test.ts'] });

    expect(runners(suggest(project({ 'package.json': { dependencies: { '@nestjs/core': '^10' }, devDependencies: { typescript: '^5' } } })))[0]).toBe('jest');

    const esm = suggest(project({ 'package.json': { type: 'module', engines: { node: '>=22.18' }, devDependencies: { typescript: '^5' } } }));
    expect(runners(esm).slice(0, 2)).toEqual(['vitest', 'node-test']);
    const nodeTest = esm.suggestions.find(x => x.runner === 'node-test');
    expect(nodeTest).toMatchObject({ install: null, adds: { script: 'node --test "test/**/*.test.ts"' } });
    expect(esm.project).toMatchObject({ language: 'typescript', module: 'esm', node: '22.18 (engines.node)' });

    const old = suggest(project({ 'package.json': { engines: { node: '^20' } }, 'tsconfig.json': '{}', 'pnpm-lock.yaml': '' }));
    expect(old.suggestions.find(x => x.runner === 'node-test')).toMatchObject({ install: 'pnpm add -D tsx', adds: { script: 'tsx --test test/*.test.ts' } });
    expect(old.suggestions.find(x => x.runner === 'node-test').caveats).toContain('Node 20 cannot find .ts test files by pattern: only test/*.test.ts runs, not sub-folders');
    const js = p => setupPlan(suggest(project({ 'package.json': { engines: { node: p } } })).project, 'node-test').script;
    expect(js('>=18')).toBe('node --test test/');
    expect(js('>=22')).toBe('node --test "test/**/*.test.js"');
  });

  test('says why it picked the language, and takes a corrected language', () => {
    const dir = project({ 'package.json': { devDependencies: { express: '^4' } } });
    const s = suggest(dir);
    expect(s.project).toMatchObject({ language: 'javascript', languageSource: 'detected' });
    expect(s.project.languageEvidence).toEqual(['no tsconfig.json and no typescript dependency']);
    const ts = suggest(dir, dir, { language: 'typescript' });
    expect(ts.project).toMatchObject({ language: 'typescript', languageSource: 'confirmed' });
    expect(ts.suggestions.find(x => x.runner === 'jest').install).toBe('npm install -D jest ts-jest @types/jest');
    expect(suggest(project({ 'package.json': {}, 'tsconfig.json': '{}' })).project.languageEvidence).toEqual(['tsconfig.json']);
  });

  test('does not suggest when tests exist, or for a project that is not Node', () => {
    expect(suggest(project({ 'package.json': { scripts: { test: 'jest' } } }))).toMatchObject({ status: 'has-tests', existing: [{ dir: '.', runner: 'jest' }] });
    const py = suggest(project({ 'pyproject.toml': '' }));
    expect(py.status).toBe('unsupported');
    expect(py.reason).toContain('pyproject.toml: Python');
    expect(suggest(project({ 'a.txt': '' })).reason).toContain('no package.json here');
    expect(suggest(project({ 'web/package.json': {}, 'api/package.json': {} })).reason)
      .toContain('Packages below: api, web (run it there, or pass --test-dir <folder inside one of them>)');
  });
});

describe('choosing the test folder', () => {
  const { locateTestDir } = require(helper);

  test('a folder given from the project root belongs to the nearest package at or above it', () => {
    const dir = project({ 'package.json': {}, 'server/package.json': {}, 'client/package.json': {}, 'client/src/x.ts': '', 'docs/a.md': '' });
    expect(locateTestDir(dir, '__tests__')).toEqual({ pkgDir: dir, testDir: '__tests__' });
    expect(locateTestDir(dir, 'server/__tests__')).toEqual({ pkgDir: path.join(dir, 'server'), testDir: '__tests__' });
    expect(locateTestDir(dir, 'client/_test')).toEqual({ pkgDir: path.join(dir, 'client'), testDir: '_test' });
    expect(locateTestDir(dir, './client/src/unit/')).toEqual({ pkgDir: path.join(dir, 'client'), testDir: 'src/unit' });
    expect(locateTestDir(dir, 'docs/tests')).toEqual({ pkgDir: dir, testDir: 'docs/tests' });
  });

  test('refuses folders outside the project or outside any package, the project itself, files and odd names', () => {
    const dir = project({ 'server/package.json': {}, 'notes.txt': '', 'server/x.js': '' });
    expect(locateTestDir(dir, '../elsewhere').error).toContain('must be a folder inside');
    expect(locateTestDir(dir, '.').error).toContain('must be a folder inside');
    expect(locateTestDir(dir, 'docs/_test').error).toBe('no package.json in docs or above it; the test folder must be inside a Node package (packages here: server)');
    expect(locateTestDir(dir, '_test').error).toContain('no package.json in the project root');
    expect(locateTestDir(dir, 'server/x.js').error).toBe('server/x.js is a file, not a folder');
    expect(locateTestDir(dir, 'server/my tests').error).toContain('may only use letters, digits and . _ - @ /');
  });

  test('each runner puts the example test in the folder and looks there', () => {
    const js = suggest(project({ 'package.json': { engines: { node: '>=22' } } })).project;
    const ts = suggest(project({ 'package.json': { engines: { node: '>=18' } }, 'tsconfig.json': '{}' })).project;
    const at = (p, runner, testDir = '__tests__') => setupPlan(p, runner, { testDir });

    const vitest = at(ts, 'vitest', 'client/_test');
    expect(vitest.files.map(f => f.path)).toEqual(['vitest.config.ts', 'client/_test/example.test.ts']);
    expect(vitest.files[0].content).toContain("include: ['client/_test/**/*.{test,spec}.?(c|m)[jt]s?(x)'],");
    expect(setupPlan({ ...ts, vite: true }, 'vitest', { testDir: '_test' }).notes)
      .toEqual(["add test: { include: ['_test/**/*.{test,spec}.?(c|m)[jt]s?(x)'] } to your vite.config so Vitest looks in _test"]);

    const jest = at(js, 'jest');
    expect(jest.files.map(f => f.path)).toEqual(['jest.config.js', '__tests__/example.test.js']);
    expect(jest.files[0].content).toContain("  roots: ['<rootDir>/__tests__'],");

    expect(JSON.parse(at(js, 'mocha', 'spec/unit').files[0].content)).toEqual({ spec: 'spec/unit/**/*.test.js' });
    expect(at(js, 'node-test').script).toBe('node --test "__tests__/**/*.test.js"');
    expect(at(suggest(project({ 'package.json': { engines: { node: '>=18' } } })).project, 'node-test').script).toBe('node --test __tests__/');
    expect(at(ts, 'node-test', '_t').script).toBe('tsx --test _t/*.test.ts');
    expect(setupPlan(js, 'jest').files.map(f => f.path)).toEqual(['jest.config.js', 'test/example.test.js']);
  });

  test('jest with roots runs the example in the chosen folder and nothing outside it', () => {
    const dir = project({ 'package.json': { name: 'p' }, 'other/outside.test.js': "test('outside', () => { throw new Error('ran'); });\n" });
    expect(provision(dir, 'jest', { testDir: 'spec/__tests__', install: false })).toMatchObject({ ok: true, written: ['jest.config.js', 'spec/__tests__/example.test.js', 'package.json (scripts.test)'] });
    fs.symlinkSync(path.join(root, 'server/node_modules'), path.join(dir, 'node_modules'));
    const r = spawnSync('npx', ['jest', '--json'], { cwd: dir, encoding: 'utf8' });
    const report = JSON.parse(r.stdout);
    expect(report.testResults.map(f => path.relative(fs.realpathSync(dir), f.name))).toEqual(['spec/__tests__/example.test.js']);
    expect(report.success).toBe(true);
  });

  test('init-tests --test-dir sets up the package that holds the folder; suggest shows the same files', () => {
    const dir = project({ 'server/package.json': { name: 'server' }, 'client/package.json': { name: 'client' } });
    const plan = cli('suggest', dir, '--test-dir', 'client/_test', '--json');
    expect(JSON.parse(plan.stdout).suggestions.find(x => x.runner === 'jest').adds.files).toEqual(['jest.config.js', '_test/example.test.js']);

    const r = cli('init-tests', dir, '--test-dir', 'server/__tests__', '--language', 'javascript', '--runner', 'node-test', '--yes');
    expect(r.stdout).toContain('node-test is set up and the example test passes.');
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(dir, 'server/__tests__/example.test.js'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'client/__tests__'))).toBe(false);
    expect(detect(dir).map(f => [f.dir, f.runner])).toEqual([['server', 'node-test']]);

    const bad = cli('init-tests', dir, '--test-dir', 'docs/_test', '--runner', 'jest', '--yes');
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('packages here: client, server');
    expect(cli('init-tests', dir, '--test-dir').status).toBe(2);
  });
});

describe('setting up the chosen framework', () => {
  const plain = () => project({ 'package.json': '{\n    "name": "p",\n    "scripts": { "test": "echo \\"Error: no test specified\\" && exit 1" }\n}\n' });

  test('each framework writes its script and files, and detection then finds it', () => {
    for (const [runner, files] of [['jest', ['jest.config.js', 'test/example.test.js']], ['vitest', ['test/example.test.js']],
      ['node-test', ['test/example.test.js']], ['mocha', ['.mocharc.json', 'test/example.test.js']]]) {
      const dir = plain();
      const r = provision(dir, runner, { install: false });
      expect(r).toMatchObject({ ok: true, written: [...files, 'package.json (scripts.test)'], skipped: [] });
      const raw = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
      expect(raw).toMatch(/^\{\n {4}"name"/);
      expect(raw.endsWith('}\n')).toBe(true);
      expect(JSON.parse(raw).scripts.test).toBe(r.plan.script);
      expect(detect(dir).map(f => f.runner)).toEqual([runner]);
    }
  });

  test('Playwright and Cypress folders are left out of the unit test runner', () => {
    // Vitest's default pattern matches *.spec.ts, so it would run Playwright's specs (and fail) without the exclude.
    const pw = suggest(project({
      'package.json': { devDependencies: { '@playwright/test': '^1', typescript: '^5' } },
      'playwright.config.ts': "export default defineConfig({ testDir: './tests/e2e/', workers: 1 });\n",
    })).project;
    expect(pw.e2eDirs).toEqual(['tests/e2e']);
    const vitest = setupPlan(pw, 'vitest').files.find(f => f.path === 'vitest.config.ts');
    expect(vitest.content).toBe("import { configDefaults, defineConfig } from 'vitest/config';\n\nexport default defineConfig({\n  test: {\n"
      + "    exclude: [...configDefaults.exclude, 'tests/e2e/**'],\n  },\n});\n");
    expect(setupPlan(pw, 'jest').files[0].content).toContain("testPathIgnorePatterns: ['/node_modules/', '/dist/', '/tests/e2e/'],");

    const both = suggest(project({ 'package.json': { dependencies: { react: '^18' }, devDependencies: { '@playwright/test': '^1', cypress: '^13' } } })).project;
    expect(both.e2eDirs).toEqual(['e2e', 'cypress']);
    expect(setupPlan(both, 'vitest').files[0].content).toContain("environment: 'jsdom',\n    exclude: [...configDefaults.exclude, 'e2e/**', 'cypress/**'],");
    const vite = setupPlan({ ...both, vite: true }, 'vitest');
    expect(vite.files.map(f => f.path)).toEqual(['test/example.test.js']);
    expect(vite.notes[1]).toContain("exclude: [...configDefaults.exclude, 'e2e/**', 'cypress/**']");

    const plain = suggest(project({ 'package.json': {} })).project;
    expect(plain.e2eDirs).toEqual([]);
    expect(setupPlan(plain, 'vitest').files.map(f => f.path)).toEqual(['test/example.test.js']);
  });

  test('TypeScript and ES modules get their own setup', () => {
    const p = suggest(project({ 'package.json': { type: 'module' }, 'tsconfig.json': '{}' })).project;
    const jest = setupPlan(p, 'jest');
    expect(jest.script).toBe('node --experimental-vm-modules node_modules/jest/bin/jest.js');
    expect(jest.files[0].content).toContain("export default {\n  preset: 'ts-jest/presets/default-esm',");
    expect(JSON.parse(setupPlan(p, 'mocha').files[0].content)).toEqual({ spec: 'test/**/*.test.ts', 'node-option': ['import=tsx'] });
    expect(setupPlan(p, 'node-test').files[0].content).toContain("import { describe, it } from 'node:test';");
    expect(setupPlan({ ...p, frontend: ['react'] }, 'vitest').files[0]).toEqual(expect.objectContaining({ path: 'vitest.config.ts' }));
  });

  test('keeps existing files, refuses a real test script, existing tests and unknown frameworks; a dry run writes nothing', () => {
    const dir = plain();
    fs.mkdirSync(path.join(dir, 'test'));
    fs.writeFileSync(path.join(dir, 'test/example.test.js'), 'mine\n');
    expect(provision(dir, 'vitest', { install: false })).toMatchObject({ ok: true, skipped: ['test/example.test.js'] });
    expect(fs.readFileSync(path.join(dir, 'test/example.test.js'), 'utf8')).toBe('mine\n');

    expect(provision(dir, 'jest', { install: false }).error).toContain('tests are already set up');
    expect(provision(project({ 'package.json': { scripts: { test: 'node run-tests.js' } } }), 'jest', { install: false }).error)
      .toContain('package.json already has a test script ("node run-tests.js")');
    expect(provision(plain(), 'karma', { install: false }).error).toContain('unknown framework "karma"');

    const dry = plain();
    const before = fs.readFileSync(path.join(dry, 'package.json'), 'utf8');
    expect(provision(dry, 'jest', { dryRun: true })).toMatchObject({ ok: true, dryRun: true, written: [] });
    expect(fs.readFileSync(path.join(dry, 'package.json'), 'utf8')).toBe(before);
    expect(fs.readdirSync(dry)).toEqual(['package.json']);
  });

  test('installs first and changes nothing when the install fails; runs the example test after', () => {
    const dir = plain();
    const before = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
    const calls = [];
    const failing = (cmd, args) => { calls.push(args[1]); return { status: 1, stdout: '', stderr: 'E404' }; };
    const r = provision(dir, 'jest', { run: failing });
    expect(r).toMatchObject({ ok: false, error: 'installing failed: npm install -D jest', written: [] });
    expect(calls).toEqual(['npm install -D jest']);
    expect(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).toBe(before);
    expect(fs.readdirSync(dir)).toEqual(['package.json']);

    // node:test needs no packages: the example test really runs
    const real = provision(plain(), 'node-test');
    expect(real.ok).toBe(true);
    expect(real.steps.map(s => [s.cmd, s.status])).toEqual([['npm test', 0]]);
  });

  test('init-tests asks for a framework and the language when it cannot prompt, and applies with --runner, --language and --yes', () => {
    const dir = plain();
    const list = cli('init-tests', dir);
    expect(list.status).toBe(2);
    expect(list.stdout).toContain('Detected language: JavaScript (no tsconfig.json and no typescript dependency)');
    expect(list.stdout).not.toContain('1. jest');
    expect(list.stderr).toContain('confirm the language with --language javascript|typescript');

    const pick = cli('init-tests', dir, '--language', 'javascript');
    expect(pick.status).toBe(2);
    expect(pick.stderr).toContain('pick one with --runner <name>');
    expect(pick.stdout).toContain('Supported test frameworks for JavaScript, best first:\n\n1. jest (recommended)');

    const noYes = cli('init-tests', dir, '--language', 'javascript', '--runner', 'node-test');
    expect(noYes.status).toBe(2);
    expect(noYes.stderr).toContain('confirm with --yes');

    const dry = cli('init-tests', dir, '--language', 'typescript', '--runner', 'node-test', '--dry-run');
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain('test/example.test.ts');
    expect(dry.stdout).toContain('Dry run: nothing was changed.');
    expect(fs.readdirSync(dir)).toEqual(['package.json']);

    const done = cli('init-tests', dir, '--language', 'javascript', '--runner', 'node-test', '--yes');
    expect(done.stdout).toContain('node-test is set up and the example test passes.');
    expect(done.status).toBe(0);
    expect(cli('init-tests', dir, '--language', 'javascript', '--runner', 'jest', '--yes').stderr).toContain('tests are already set up');
    expect(cli('init-tests', dir, '--language', 'cobol').status).toBe(2);
  });
});
