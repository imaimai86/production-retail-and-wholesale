const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const helper = path.join(root, 'scripts/sdlc-config.cjs');
const { detect, resolve, testDir, allowedTools, worktreeBase, shellEnv } = require(helper);

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
    expect(r.warnings).toEqual([expect.stringContaining('e2e: skipped, its test script uses a runner that is not recognised (scripts.test: playwright test)')]);
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
    expect(c.suites).toEqual([expect.objectContaining({ dir: '.', runner: 'jest', testCmd: 'npm test', sourceGlobs: ['**'], setup: null })]);
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

  test('a file suite is completed from detection; an explicit runner gets that runner\'s defaults; code search auto follows PATH', () => {
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
    expect(ok(dir, { env: { PATH: `${bin}:/usr/bin:/bin` } }).agent.codeSearch).toBe('graft');
  });

  test('rejects bad files with the setting at fault', () => {
    expect(errorsOf(project({ 'sdlc.config.json': '{ nope' }))).toMatch(/sdlc\.config\.json: not valid JSON/);
    const bad = errorsOf(project({
      'sdlc.config.json': { backlogDir: '', suits: [], git: { conflictSuffixStart: 'x' }, agent: { codeSearch: 'grep' }, suites: [{ runner: 'karma' }] },
    }));
    for (const e of ['backlogDir: must be a non-empty string', 'suits: unknown setting', 'git.conflictSuffixStart: must be a whole number',
      'agent.codeSearch: must be one of graft, none, auto', 'suites[0].runner: must be one of']) expect(bad).toContain(e);

    expect(errorsOf(project({ 'sdlc.config.json': { suites: [{ dir: 'missing' }] } }))).toContain('suites[0].dir: folder missing does not exist');
    expect(errorsOf(project({ 'x/a.txt': '', 'sdlc.config.json': { suites: [{ dir: 'x' }] } }))).toContain('suites[0]: no test runner found in x; set "runner"');
    expect(errorsOf(project({ 'x/package.json': { scripts: { test: 'jest; mocha' } }, 'sdlc.config.json': { suites: [{ dir: 'x' }] } })))
      .toMatch(/suites\[0\]: x matches (jest and mocha|mocha and jest) equally; set "runner"/);
    expect(errorsOf(project({ 'sdlc.config.json': { suites: [{ runner: 'generic-junit' }] } }))).toContain('needs "testCmd"');
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
  const modSh = fs.readFileSync(path.join(root, 'scripts/sdlc-mod.sh'), 'utf8');
  const shVar = name => sdlcSh.match(new RegExp(`^${name}="([^"]*)"`, 'm'))[1];
  const shWords = text => [...text.matchAll(/"([^"]*)"|(\S+)/g)].map(m => m[1] ?? m[2]);

  test('sdlc.config.json resolves to the constants in sdlc.sh and sdlc-mod.sh', () => {
    const c = ok(root);
    expect(c.suites).toHaveLength(1);
    expect(c.suites[0].testCmd).toBe(shVar('TEST_CMD'));
    expect(testDir(c.suites[0])).toBe(shVar('TEST_DIR'));
    expect(`${c.backlogDir}/index.md`).toBe(shVar('BACKLOG'));
    expect(allowedTools(c)).toEqual(shWords(sdlcSh.match(/^ALLOWED=\(([\s\S]*?)\)\n/m)[1]));
    expect(c.worktree.link).toEqual(modSh.match(/for p in (server\/node_modules[^;]*);/)[1].split(' '));
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
