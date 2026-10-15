const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const { cleanEnv } = require('../../test-utils/sdlcSettings');
const GIT_ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } }).stdout.trim();
const write = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), typeof text === 'string' ? text : `${JSON.stringify(text, null, 2)}\n`);
};

// A stand-in for `claude -p`: it tells the stage from the prompt's first words, runs <fake>/<stage>.sh (which writes
// that stage's files), records the prompt and the allowed tools, and answers like claude --output-format json.
const FAKE_CLAUDE = `#!/bin/bash
prompt=""; tools=""
while [ $# -gt 0 ]; do
  case "$1" in
    -p) prompt="$2"; shift 2 ;;
    --allowedTools) shift; while [ $# -gt 0 ] && [[ "$1" != --* ]]; do tools="$tools|$1"; shift; done ;;
    *) shift ;;
  esac
done
stage=other
case "$prompt" in
  "You are a Requirements Agent"*) stage=spec ;; "You are an Architecture Planner"*) stage=plan ;;
  "You are a QA Engineer"*) stage=red-tests ;; "You are a Senior TDD Developer"*) stage=implement ;;
  "You are a code reviewer"*) stage=review ;;
esac
printf '== %s\\n%s\\n' "$stage" "$prompt" >> "$FAKE_DIR/prompts.txt"
echo "$stage:$tools|" >> "$FAKE_DIR/tools.txt"
[ ! -f "$FAKE_DIR/$stage.sh" ] || bash "$FAKE_DIR/$stage.sh"
echo '{"type":"result","subtype":"success","result":"done","permission_denials":[]}'
`;

// A project in a temp folder: <files>, committed on main, with scripts/ pointing at this repository's scripts.
function project(files, stages) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-layout-'));
  const dir = path.join(base, 'repo');
  const fake = path.join(base, 'fake');
  fs.mkdirSync(path.join(fake, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(fake, 'bin/claude'), FAKE_CLAUDE, { mode: 0o755 });
  for (const [stage, script] of Object.entries(stages)) fs.writeFileSync(path.join(fake, `${stage}.sh`), `set -e\n${script}\n`);
  for (const [f, v] of Object.entries(files)) write(dir, f, v);
  fs.symlinkSync(path.join(root, 'scripts'), path.join(dir, 'scripts'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return { dir, fake };
}

function runPipeline({ dir, fake }, slug, docs, extra = {}) {
  const env = { ...cleanEnv(extra), ...GIT_ENV, FAKE_DIR: fake, FAKE_DOCS: docs, PATH: `${path.join(fake, 'bin')}:${process.env.PATH}` };
  delete env.CI;
  const r = spawnSync('bash', ['scripts/sdlc.sh', slug], { cwd: dir, encoding: 'utf8', env, timeout: 240000 });
  const read = f => (fs.existsSync(path.join(fake, f)) ? fs.readFileSync(path.join(fake, f), 'utf8') : '');
  return { ...r, prompts: read('prompts.txt'), tools: read('tools.txt') };
}
const filesIn = (dir, ref) => git(dir, 'show', '--name-only', '--format=', ref).split('\n').filter(Boolean).sort();

// node:test, tests beside the source, another backlog folder and branch prefix: nothing like this repository.
const NODE_TEST_SCRIPT = Number(process.versions.node.split('.')[0]) >= 21 ? 'node --test "src/**/*.test.mjs"' : 'node --test src/';
const besideSource = () => project({
  'package.json': { name: 'demo', private: true, scripts: { test: NODE_TEST_SCRIPT } },
  'sdlc.config.json': {
    backlogDir: 'work/items', git: { branchPrefix: 'feature/' }, agent: { codeSearch: 'none' }, ui: { timezone: 'UTC' },
    suites: [{ name: 'app', dir: '.', runner: 'node-test', testCmd: 'npm test', testGlobs: ['src/**/*.test.mjs'] }],
  },
  '.gitignore': 'work/items/*/logs/\n',
  'src/existing.mjs': 'export const one = () => 1;\n',
  'src/existing.test.mjs': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { one } from './existing.mjs';\ntest('one is 1', () => assert.equal(one(), 1));\n",
  'work/items/index.md': '# Backlog\n\n- [ ] `add-sum` - Feature: add numbers\n',
  'work/items/add-sum/brief.md': '# add-sum\n\nAdd sum(a, b).\n',
}, {
  spec: 'echo "spec" > "$FAKE_DOCS/specs-1.md"',
  plan: 'echo "plan" > "$FAKE_DOCS/plan-1.md"',
  'red-tests': `echo "cases" > "$FAKE_DOCS/test-cases-1.md"
printf "import { test } from 'node:test';\\nimport assert from 'node:assert/strict';\\nimport { sum } from './sum.mjs';\\ntest('sum adds', () => assert.equal(sum(2, 3), 5));\\n" > src/sum.test.mjs`,
  implement: `env > "$FAKE_DIR/implement-env.txt"
printf 'export const sum = (a, b) => a + b;\\n' > src/sum.mjs
[ -z "\${FAKE_TOUCH_TEST:-}" ] || echo "// edited" >> src/sum.test.mjs`,
  review: 'echo "reviewed" > "$FAKE_DOCS/review-1.md"',
});

describe('the pipeline on a project unlike this one', () => {
  test('node:test with tests beside the source: Spec to Ship, with the settings\' backlog, branch, tests and prompts', () => {
    const p = besideSource();
    const r = runPipeline(p, 'add-sum', 'work/items/add-sum');
    expect(r.stdout).toContain('SDLC: add-sum on branch feature/add-sum');
    expect([r.status, r.stderr.slice(-400)]).toEqual([0, expect.any(String)]);
    expect(git(p.dir, 'branch', '--show-current')).toBe('feature/add-sum');
    expect(git(p.dir, 'log', '--format=%s', 'main..HEAD').split('\n')).toEqual([
      'chore(backlog): mark add-sum done', 'feat(add-sum): implement per work/items/add-sum/specs-1.md', 'test(add-sum): add failing tests and spec/plan docs',
    ]);
    // the red-tests commit holds the docs and the new test only; the implementation comes after
    const red = git(p.dir, 'log', '--format=%H', '-1', '--grep=^test(add-sum)');
    expect(filesIn(p.dir, red)).toEqual(['src/sum.test.mjs', 'work/items/add-sum/plan-1.md',
      'work/items/add-sum/specs-1.md', 'work/items/add-sum/test-cases-1.md'].sort());
    expect(filesIn(p.dir, 'HEAD~1')).toEqual(['src/sum.mjs', 'work/items/add-sum/review-1.md']);
    expect(fs.readFileSync(path.join(p.dir, 'work/items/index.md'), 'utf8')).toContain('- [x] `add-sum`');

    // the tests at the red commit came from the node:test adapter: the new file failed to load, the old test passed
    const redResult = JSON.parse(fs.readFileSync(path.join(p.dir, 'work/items/add-sum/logs/red.json'), 'utf8'));
    expect(redResult.runner).toBe('node-test');
    expect(redResult.tests).toEqual([expect.objectContaining({ file: 'src/existing.test.mjs', name: 'one is 1', status: 'passed' })]);
    expect(redResult.suiteErrors.map(e => e.file)).toEqual(['src/sum.test.mjs']);

    // the agents were told this project's framework and test files, and allowed its test command only
    expect(r.prompts).toContain("node:test tests (describe/it from 'node:test', assert from 'node:assert/strict'), in JavaScript, in files matching src/**/*.test.mjs");
    expect(r.prompts).toContain('NEVER edit a test file (files matching src/**/*.test.mjs).');
    expect(r.prompts).not.toMatch(/Jest|server\/__tests__/);
    expect(r.tools).toContain('|Bash(npm test:*)|');
    expect(r.tools).not.toMatch(/graft|npm run lint|generate-spec/);
  });

  test('a test beside the source changed during Implement stops the run', () => {
    const p = besideSource();
    const env = { FAKE_TOUCH_TEST: '1' };
    Object.assign(process.env, env);
    try {
      const r = runPipeline(p, 'add-sum', 'work/items/add-sum');
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('GUARD FAILED: tests were modified during implementation\nsrc/sum.test.mjs');
      expect(git(p.dir, 'log', '--format=%s', 'main..HEAD')).toBe('test(add-sum): add failing tests and spec/plan docs');
    } finally {
      delete process.env.FAKE_TOUCH_TEST;
    }
  });
});

describe('what a run passes on', () => {
  test('FROM steers this run only: the agents and the tests they run do not inherit it', () => {
    const p = besideSource();
    const r = runPipeline(p, 'add-sum', 'work/items/add-sum', { FROM: 'spec' });
    expect(r.status).toBe(0);
    const env = fs.readFileSync(path.join(p.fake, 'implement-env.txt'), 'utf8');
    expect(env).toContain('FAKE_DOCS=work/items/add-sum');
    expect(env).not.toMatch(/^FROM=/m);
  });
});

describe('the pipeline on a project laid out like this one', () => {
  test('Jest in server/__tests__, Docs/backlog and sdlc/ branches, as before the settings', () => {
    const p = project({
      'package.json': { name: 'app', private: true, scripts: { test: 'npm run test --prefix server' } },
      'server/package.json': { name: 'server', private: true, scripts: { test: 'jest' } },
      'sdlc.config.json': {
        suites: [{ name: 'server', dir: 'server', runner: 'jest', testCmd: 'npm test', testGlobs: ['__tests__/**'] }],
        worktree: { link: ['server/node_modules'] }, agent: { codeSearch: 'none' }, ui: { timezone: 'UTC' },
      },
      '.gitignore': 'node_modules\nDocs/backlog/*/logs/\n',
      'server/__tests__/existing.test.js': "test('one is 1', () => expect(1).toBe(1));\n",
      'Docs/backlog/index.md': '# Backlog\n\n- [ ] `add-sum` - Feature: add numbers\n',
      'Docs/backlog/add-sum/brief.md': '# add-sum\n',
    }, {
      spec: 'echo spec > "$FAKE_DOCS/specs-1.md"',
      plan: 'echo plan > "$FAKE_DOCS/plan-1.md"',
      'red-tests': `echo cases > "$FAKE_DOCS/test-cases-1.md"
printf "const { sum } = require('../sum');\\ntest('sum adds', () => expect(sum(2, 3)).toBe(5));\\n" > server/__tests__/sum.test.js`,
      implement: "printf 'exports.sum = (a, b) => a + b;\\n' > server/sum.js",
      review: 'echo reviewed > "$FAKE_DOCS/review-1.md"',
    });
    fs.symlinkSync(path.join(root, 'server/node_modules'), path.join(p.dir, 'server/node_modules'));
    const r = runPipeline(p, 'add-sum', 'Docs/backlog/add-sum');
    expect(r.stdout).toContain('SDLC: add-sum on branch sdlc/add-sum');
    expect([r.status, r.stderr.slice(-400)]).toEqual([0, expect.any(String)]);
    expect(git(p.dir, 'log', '--format=%s', 'main..HEAD').split('\n')).toEqual([
      'chore(backlog): mark add-sum done', 'feat(add-sum): implement per Docs/backlog/add-sum/specs-1.md', 'test(add-sum): add failing tests and spec/plan docs',
    ]);
    expect(filesIn(p.dir, 'HEAD~2')).toContain('server/__tests__/sum.test.js');
    expect(filesIn(p.dir, 'HEAD~1')).toEqual(['Docs/backlog/add-sum/review-1.md', 'server/sum.js']);
    const redResult = JSON.parse(fs.readFileSync(path.join(p.dir, 'Docs/backlog/add-sum/logs/red.json'), 'utf8'));
    expect(redResult.runner).toBe('jest');
    expect(redResult.tests).toEqual([expect.objectContaining({ file: 'server/__tests__/existing.test.js', status: 'passed' })]);
    expect(redResult.suiteErrors.map(e => e.file)).toEqual(['server/__tests__/sum.test.js']);
    expect(r.prompts).toContain('Jest tests (describe/test and expect; mock with jest.fn and jest.mock), in JavaScript, in server/__tests__/');
    expect(r.tools).toContain('|Bash(npm test:*)|');
  });
});
