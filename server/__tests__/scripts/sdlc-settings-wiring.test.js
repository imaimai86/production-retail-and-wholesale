const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const configPath = path.join(root, 'scripts/sdlc-config.cjs');
const { expandGlob, testSpec, testFiles, renderSkill } = require(configPath);
const GIT_ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

const tmp = (p = 'sdlc-wiring-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const write = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), typeof text === 'string' ? text : JSON.stringify(text));
};
const project = files => { const dir = tmp(); for (const [f, v] of Object.entries(files)) write(dir, f, v); return dir; };
const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const BESIDE = { suites: [{ name: 'app', dir: '.', runner: 'node-test', testCmd: 'npm test', testGlobs: ['src/**/*.test.ts'] }], agent: { codeSearch: 'none' }, ui: { timezone: 'UTC' } };

describe('test files from the settings', () => {
  test('globs with {a,b} and extglobs become globs git understands', () => {
    expect(expandGlob('src/**/*.{test,spec}.ts')).toEqual(['src/**/*.test.ts', 'src/**/*.spec.ts']);
    expect(expandGlob('**/?(*.)+(spec|test).[jt]s?(x)')).toEqual(['**/spec.[jt]s', '**/spec.[jt]sx', '**/test.[jt]s', '**/test.[jt]sx',
      '**/*.spec.[jt]s', '**/*.spec.[jt]sx', '**/*.test.[jt]s', '**/*.test.[jt]sx']);
    expect(expandGlob('plain/**')).toEqual(['plain/**']);
  });

  test('a folder that holds only tests is guarded as a folder; tests beside the source by their globs', () => {
    expect(testSpec({ dir: 'server', testGlobs: ['__tests__/**'] })).toEqual({ folder: 'server/__tests__', globs: ['server/__tests__/**'], pathspecs: ['server/__tests__'], patterns: ['^server/__tests__/'] });
    const beside = testSpec({ dir: '.', testGlobs: ['src/**/*.test.ts'] });
    expect(beside).toMatchObject({ folder: null, pathspecs: [':(glob)src/**/*.test.ts'] });
    expect(new RegExp(beside.patterns[0]).test('src/a/b.test.ts')).toBe(true);
    expect(new RegExp(beside.patterns[0]).test('src/a/b.ts')).toBe(false);
    expect(testSpec({ dir: 'web', testGlobs: ['test/**/*.js'] }).folder).toBeNull(); // test/ may hold helpers that are not tests
    expect(testFiles({ suites: [{ dir: 'server', testGlobs: ['__tests__/**'] }, { dir: 'web', testGlobs: ['**/*.spec.ts'] }] }))
      .toBe('server/__tests__/; files matching web/**/*.spec.ts');
  });

  test('git matches the pathspecs as the pipeline uses them', () => {
    const dir = project({ 'src/a.ts': 'a', 'src/a.test.ts': 'a', 'src/deep/b.test.ts': 'b', 'src/deep/b.ts': 'b' });
    git(dir, 'init', '-q');
    const specs = testSpec({ dir: '.', testGlobs: ['src/**/*.test.ts'] }).pathspecs;
    expect(git(dir, 'ls-files', '--others', '--', ...specs).split('\n').sort()).toEqual(['src/a.test.ts', 'src/deep/b.test.ts']);
    expect(git(dir, 'ls-files', '--others', '--', 'src', ':(exclude,glob)src/**/*.test.ts').split('\n').sort()).toEqual(['src/a.ts', 'src/deep/b.ts']);
  });

  test('layout prints the folders, patterns and test command, or exits 1 with the settings errors', () => {
    const dir = project({ 'sdlc.config.json': BESIDE, 'src/x.ts': '' });
    const r = spawnSync('node', [configPath, 'layout', dir], { encoding: 'utf8' });
    expect(JSON.parse(r.stdout)).toEqual({
      root: dir, backlogDir: 'Docs/backlog', testDirs: ['src'], sourceDirs: ['.'], testCmd: 'npm test', keyDir: '.',
      testFiles: 'files matching src/**/*.test.ts', testPathspecs: [':(glob)src/**/*.test.ts'], testPatterns: [expect.any(String)],
    });
    const bad = spawnSync('node', [configPath, 'layout', project({ 'a.txt': '' })], { encoding: 'utf8' });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('ERROR: no test suite found');
  });

  test('skills get the test files, test command, framework, backlog folder and branch prefix from the settings', () => {
    const skills = tmp('sdlc-skills-');
    fs.mkdirSync(path.join(skills, 'parts'));
    fs.writeFileSync(path.join(skills, 'parts/code-search.md'), 'GREP');
    fs.writeFileSync(path.join(skills, 'demo.md'), '{{TEST_FILES}}|{{TEST_PATHSPECS}}|{{TEST_CMD}}|{{TEST_FRAMEWORK}}|{{BACKLOG_DIR}}|{{BRANCH_PREFIX}}|{{CODE_SEARCH}}');
    const opts = { skillsDir: skills, partsDir: path.join(skills, 'parts'), env: { PATH: '/usr/bin:/bin' } };
    const dir = project({ 'sdlc.config.json': { ...BESIDE, backlogDir: 'work/items', git: { branchPrefix: 'feature/' } }, 'src/x.ts': '' });
    expect(renderSkill('demo', dir, opts)).toBe("files matching src/**/*.test.ts|':(glob)src/**/*.test.ts'|npm test|"
      + "node:test tests (describe/it from 'node:test', assert from 'node:assert/strict'), in JavaScript|work/items|feature/|GREP");
    // settings that cannot be resolved: wording that sends the agent to find out
    expect(renderSkill('demo', project({ 'sdlc.config.json': { backlogDir: 'items' } }), opts))
      .toBe("the project's test files|<the test files>|the project's test command|tests in the style the project already uses|items|sdlc/|GREP");
  });
});

describe('sdlc-testcheck with tests beside the source', () => {
  const CHECK = path.join(root, 'scripts/sdlc-testcheck.cjs');
  const env = { ...process.env, ...GIT_ENV, SDLC_TEST_DIRS: 'src', SDLC_KEY_DIR: '.', SDLC_TEST_PATHSPECS: ':(glob)src/**/*.test.ts' };
  const check = (dir, ...args) => spawnSync('node', [CHECK, ...args], { cwd: dir, encoding: 'utf8', env });
  const repo = () => {
    const dir = project({ 'src/a.ts': 'export const a = 1;\n', 'src/a.test.ts': "test('a works', () => {});\n", 'Docs/backlog/s/brief.md': 'b\n' });
    git(dir, 'init', '-q');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'test(s): add failing tests');
    return { dir, red: git(dir, 'rev-parse', 'HEAD') };
  };

  test('diffcheck counts only test files as tests; resumecheck sees a source change beside them as implementation', () => {
    const { dir, red } = repo();
    write(dir, 'claims.md', 'src/a.test.ts :: a works :: contradicts the spec decision\n');
    write(dir, 'src/a.test.ts', "test('a works', () => { expect(1).toBe(1); });\n");
    write(dir, 'src/a.ts', 'export const a = 2;\n');
    expect(check(dir, 'diffcheck', red, 'claims.md')).toMatchObject({ status: 0, stderr: '' });
    write(dir, 'src/b.test.ts', 'new\n');
    expect(check(dir, 'diffcheck', red, 'claims.md').stderr).toContain('REJECT: changed a test file that was not claimed: src/b.test.ts');

    const resume = check(dir, 'resumecheck', red, 'claims.md', 's');
    expect(resume.stderr).toContain("tests changed since the red-tests commit");
    expect(resume.stderr).toContain("restore with: git checkout " + red + " -- ':(glob)src/**/*.test.ts' && git clean -fd ':(glob)src/**/*.test.ts'");
    expect(resume.stderr).not.toContain('no implementation change');
  });

  test('keys are paths from the root; retry-args gives the runner each file with its failing tests', () => {
    const { dir } = repo();
    write(dir, 'claims.md', 'src/a.test.ts :: a works :: x\n');
    expect(check(dir, 'claimed', 'claims.md').stdout).toBe('src/a.test.ts::a works\n');
    const r = spawnSync('node', [CHECK, 'retry-args'], { input: 'src/a.test.ts::a works\nsrc/a.test.ts::b\nsrc/c.test.ts::<suite failed to run>\n', encoding: 'utf8', env });
    expect(r.stdout).toBe('src/a.test.ts\ta works\tb\nsrc/c.test.ts\n');
    const legacy = spawnSync('node', [CHECK, 'retry-args'], { input: '__tests__/x.test.js::t\n', encoding: 'utf8', env: { ...process.env, SDLC_KEY_DIR: '' } });
    expect(legacy.stdout).toBe('server/__tests__/x.test.js\tt\n');
  });
});

describe('runner command with several suites', () => {
  test('every suite runs and the results merge; --file runs only the suites holding the files', () => {
    const t = name => `const { test } = require('node:test');\ntest('${name}', () => {});\n`;
    const dir = project({
      'sdlc.config.json': { suites: [
        { name: 'a', dir: 'a', runner: 'node-test', testCmd: 'node --test a/x.test.js', testGlobs: ['**/*.test.js'] },
        { name: 'b', dir: 'b', runner: 'node-test', testCmd: 'node --test b/y.test.js', testGlobs: ['**/*.test.js'] },
      ], agent: { codeSearch: 'none' }, ui: { timezone: 'UTC' } },
      'a/x.test.js': t('in a'), 'b/y.test.js': t('in b'),
    });
    const out = path.join(dir, 'r.json');
    const run = (...args) => spawnSync('node', [path.join(root, 'scripts/sdlc-runners.cjs'), 'run', dir, '--out', out, ...args], { encoding: 'utf8' });
    const all = run();
    expect(all.stdout).toBe('a (node-test): 1 passed, 0 failed, 0 skipped, 0 file errors\nb (node-test): 1 passed, 0 failed, 0 skipped, 0 file errors\n');
    expect(JSON.parse(fs.readFileSync(out, 'utf8'))).toMatchObject({ suite: 'a+b', ok: true, tests: [{ file: 'a/x.test.js' }, { file: 'b/y.test.js' }] });
    expect(run('--file', 'b/y.test.js').stdout).toBe('b (node-test): 1 passed, 0 failed, 0 skipped, 0 file errors\n');
    expect(run('--file', 'c/z.test.js').status).toBe(2);
  });
});

describe('sdlc-mod.sh with settings', () => {
  test('the worktree uses the settings\' branch prefix, backlog folder and links', () => {
    const base = tmp('sdlc-mod-settings-');
    const repo = path.join(base, 'repo');
    write(repo, 'scripts/sdlc.sh', '#!/usr/bin/env bash\necho "ran $1 on $(git branch --show-current)" > ran.txt\n');
    fs.chmodSync(path.join(repo, 'scripts/sdlc.sh'), 0o755);
    fs.copyFileSync(path.join(root, 'scripts/sdlc-mod.sh'), path.join(repo, 'scripts/sdlc-mod.sh'));
    fs.copyFileSync(configPath, path.join(repo, 'scripts/sdlc-config.cjs'));
    write(repo, 'sdlc.config.json', { ...BESIDE, backlogDir: 'work/items', git: { branchPrefix: 'feature/' }, worktree: { link: ['vendor/lib', 'missing'] } });
    write(repo, 'work/items/alpha/brief.md', '# alpha\n');
    write(repo, 'src/a.ts', '');
    write(repo, '.gitignore', 'vendor/\n');
    write(repo, 'vendor/lib/x.js', '');
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    const wts = path.join(base, 'wts');
    const r = spawnSync('bash', [path.join(repo, 'scripts/sdlc-mod.sh'), 'run', 'alpha'], { cwd: repo, encoding: 'utf8', env: { ...process.env, ...GIT_ENV, SDLC_WT_BASE: wts, SDLC_PLUGIN_DIRS: '' } });
    expect(r.status).toBe(0);
    const wt = path.join(wts, 'alpha');
    expect(fs.readFileSync(path.join(wt, 'ran.txt'), 'utf8')).toBe('ran alpha on feature/alpha\n');
    expect(fs.lstatSync(path.join(wt, 'vendor/lib')).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(wt, 'missing'))).toBe(false);
    expect(fs.existsSync(path.join(wt, 'work/items/alpha/logs'))).toBe(true);
  });
});

describe('guard hook with settings', () => {
  const GUARD = path.join(root, '.claude/helpers/sdlc-guard.cjs');
  const repo = () => {
    const dir = project({ 'sdlc.config.json': BESIDE, 'src/a.ts': '', '.claude/sdlc-state.json': { phase: 'implement', slug: 's' } });
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.copyFileSync(configPath, path.join(dir, 'scripts/sdlc-config.cjs'));
    return dir;
  };
  const hook = (dir, mode, input) => spawnSync('node', [GUARD, mode], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });

  test('blocks writes to the settings\' test files, by tool or shell, and allows the source beside them', () => {
    const dir = repo();
    const blocked = hook(dir, 'pre-tool', { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src/deep/a.test.ts') } });
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toContain('BLOCKED: the tests (files matching src/**/*.test.ts) are read-only during the \'implement\' phase of s');
    expect(hook(dir, 'pre-tool', { tool_name: 'Edit', tool_input: { file_path: 'src/a.ts' } }).status).toBe(0);
    expect(hook(dir, 'pre-tool', { tool_name: 'Bash', tool_input: { command: 'sed -i s/a/b/ src/a.test.ts' } }).status).toBe(2);
    expect(hook(dir, 'pre-tool', { tool_name: 'Bash', tool_input: { command: 'cat src/a.test.ts' } }).status).toBe(0);
    expect(hook(dir, 'pre-tool', { tool_name: 'Bash', tool_input: { command: 'rm src/a.ts' } }).status).toBe(0);
  });

  test('the green gate runs the settings\' test command', () => {
    const dir = repo();
    write(dir, 'sdlc.config.json', { ...BESIDE, suites: [{ ...BESIDE.suites[0], testCmd: 'echo boom; exit 1' }] });
    const r = hook(dir, 'stop', {});
    const out = JSON.parse(r.stdout);
    expect(out.decision).toBe('block');
    expect(out.reason).toContain('echo boom; exit 1 is failing (attempt 1/4). Fix the source, not the tests (files matching src/**/*.test.ts).');
    expect(out.reason).toContain('boom');
    write(dir, 'sdlc.config.json', { ...BESIDE, suites: [{ ...BESIDE.suites[0], testCmd: 'true' }] });
    expect(hook(dir, 'stop', {})).toMatchObject({ status: 0, stdout: '' });
  });
});

describe('command lines a shell did not split', () => {
  const { argsProblem } = require(configPath);
  const CONFIG_CLI = { commands: ['detect', 'code-search', 'init-tests'], valued: ['--runner', '--test-dir'], flags: ['--json', '--list'] };

  test('a command or option arriving with what follows it as one argument is named, with the words to pass instead', () => {
    expect(argsProblem(['code-search --list', '.'], CONFIG_CLI)).toBe('"code-search --list" arrived as one argument, so the shell did not split it '
      + '(zsh does this with an unquoted $var). Pass each word separately: code-search --list');
    expect(argsProblem(['init-tests', '--runner vitest'], CONFIG_CLI)).toMatch(/^"--runner vitest" arrived as one argument/);
  });

  test('unknown commands and options and a missing command are errors; spaces in values and paths are fine', () => {
    expect(argsProblem(['frob'], CONFIG_CLI)).toBe('unknown command "frob" (commands: detect, code-search, init-tests)');
    expect(argsProblem(['detect', '--jsno'], CONFIG_CLI)).toBe('unknown option "--jsno"');
    expect(argsProblem([], CONFIG_CLI)).toBe('no command given');
    expect(argsProblem(['detect', './my project'], CONFIG_CLI)).toBeNull();
    expect(argsProblem(['init-tests', '--test-dir', 'detect --json'], CONFIG_CLI)).toBeNull();
    expect(argsProblem(['init-tests', '.', '--runner', 'vitest', '--json'], CONFIG_CLI)).toBeNull();
  });

  test('both tools stop with exit 2, the reason and their usage', () => {
    for (const [tool, args, reason, usage] of [
      ['sdlc-config.cjs', ['code-search --list', '.'], '"code-search --list" arrived as one argument', 'code-search [dir] [--list'],
      ['sdlc-runners.cjs', ['run --out x'], '"run --out x" arrived as one argument', 'Usage: sdlc-runners.cjs run'],
      ['sdlc-runners.cjs', ['run', '--outt', 'x'], 'unknown option "--outt"', 'Usage: sdlc-runners.cjs run'],
    ]) {
      const r = spawnSync('node', [path.join(root, 'scripts', tool), ...args], { encoding: 'utf8' });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(`ERROR: ${reason}`);
      expect(r.stderr).toContain(usage);
    }
  });
});
