const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const sdlcSrc = fs.readFileSync(path.join(root, 'scripts/sdlc.sh'), 'utf8');
const CHECK = path.join(root, 'scripts/sdlc-testcheck.cjs');
const SLUG = 'alpha';
const CLAIM = 'server/__tests__/a.test.js :: a works :: contradicts the spec decision\n';

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const write = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const commit = (dir, msg) => { git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', msg); return git(dir, 'rev-parse', 'HEAD'); };

// Temporary repo: initial commit, red-tests commit (test file), a claim file, then an implementation commit.
// Building one costs a dozen git launches, so each shape is built once and every test works on a copy.
const templates = {};
function makeRepo({ impl = true, claim = CLAIM } = {}) {
  if (!templates[impl]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-resume-tpl-'));
    git(dir, 'init', '-q');
    write(dir, 'README.md', 'x\n');
    commit(dir, 'init');
    write(dir, 'server/__tests__/a.test.js', "test('a works', () => {});\n");
    write(dir, `Docs/backlog/${SLUG}/brief.md`, 'brief\n');
    const red = commit(dir, `test(${SLUG}): add failing tests and spec/plan docs`);
    write(dir, `Docs/backlog/${SLUG}/test-issues.md`, CLAIM);
    if (impl) { write(dir, 'server/src/feature.js', 'module.exports = 1;\n'); commit(dir, 'impl'); }
    templates[impl] = { dir, red };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-resume-'));
  fs.cpSync(templates[impl].dir, dir, { recursive: true });
  const claimFile = path.join(dir, `Docs/backlog/${SLUG}/test-issues.md`);
  if (claim === null) fs.rmSync(claimFile);
  else if (claim !== CLAIM) fs.writeFileSync(claimFile, claim);
  return { dir, red: templates[impl].red, claimFile };
}
const resume = (dir, ...args) => spawnSync('node', [CHECK, 'resumecheck', ...args], { cwd: dir, encoding: 'utf8' });
const rejects = r => r.stderr.split('\n').filter(l => l.startsWith('REJECT:'));
const RESTORE = red => `git checkout ${red} -- server/__tests__ && git clean -fd server/__tests__`;

describe('sdlc-testcheck resumecheck', () => {
  test('passes silently when all conditions hold (AC3), also for an uncommitted or untracked implementation and an ignored test-folder file', () => {
    let { dir, red, claimFile } = makeRepo();
    const r = resume(dir, red, claimFile, SLUG);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');

    // git-ignored untracked files under the test directory are ignored
    write(dir, '.gitignore', 'server/__tests__/ignored.tmp\n');
    commit(dir, 'ignore');
    write(dir, 'server/__tests__/ignored.tmp', 'x\n');
    expect(resume(dir, red, claimFile, SLUG).status).toBe(0);

    // the implementation is an uncommitted change
    ({ dir, red, claimFile } = makeRepo({ impl: false }));
    write(dir, 'server/src/feature.js', 'x\n');
    expect(resume(dir, red, claimFile, SLUG).status).toBe(0);

    // the implementation is an untracked non-ignored file
    ({ dir, red, claimFile } = makeRepo({ impl: false }));
    write(dir, 'scripts/new.sh', 'x\n');
    expect(resume(dir, red, claimFile, SLUG).status).toBe(0);
  });

  test('rejects a missing or unknown red-tests commit, and a missing, empty or claim-less claim file', () => {
    const { dir, red, claimFile } = makeRepo();
    // no red-tests commit: the claim file is still checked
    let r = resume(dir, '', claimFile, SLUG);
    expect(r.status).toBe(1);
    expect(rejects(r)).toHaveLength(1);
    expect(rejects(r)[0]).toContain(`no red-tests commit found for ${SLUG}`);

    // an unknown SHA yields a reject, not a stack trace
    r = resume(dir, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', claimFile, SLUG);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('REJECT:');
    expect(r.stderr).not.toMatch(/at .*\.cjs:\d+/);

    fs.unlinkSync(claimFile);
    expect(rejects(resume(dir, '', claimFile, SLUG))).toHaveLength(2);
    r = resume(dir, red, claimFile, SLUG);
    expect(r.status).toBe(1);
    expect(rejects(r).join('\n')).toMatch(/missing|does not exist|not found/i);

    fs.writeFileSync(claimFile, '');
    r = resume(dir, red, claimFile, SLUG);
    expect(r.status).toBe(1);
    expect(rejects(r).join('\n')).toMatch(/empty/i);

    fs.writeFileSync(claimFile, 'just some prose\nno separators here\n');
    r = resume(dir, red, claimFile, SLUG);
    expect(r.status).toBe(1);
    expect(rejects(r).join('\n')).toMatch(/no valid|valid claim/i);
  });

  test('rejects a modified or untracked test file, prints the exact restore command, and changes nothing itself', () => {
    let { dir, red, claimFile } = makeRepo();
    write(dir, 'server/__tests__/a.test.js', "test('a works', () => { expect(1).toBe(2); });\n");
    let r = resume(dir, red, claimFile, SLUG);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('server/__tests__/a.test.js');
    expect(r.stderr).toContain(RESTORE(red));
    expect(fs.readFileSync(path.join(dir, 'server/__tests__/a.test.js'), 'utf8')).toContain('expect(1).toBe(2)');

    ({ dir, red, claimFile } = makeRepo());
    write(dir, 'server/__tests__/extra.test.js', 'x\n');
    r = resume(dir, red, claimFile, SLUG);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('server/__tests__/extra.test.js');
    expect(r.stderr).toContain(RESTORE(red));
    expect(fs.existsSync(path.join(dir, 'server/__tests__/extra.test.js'))).toBe(true);

    // neither the repository nor the test directory is modified
    ({ dir, red, claimFile } = makeRepo({ impl: false }));
    write(dir, 'server/__tests__/a.test.js', 'changed\n');
    write(dir, 'server/__tests__/new.test.js', 'new\n');
    const before = git(dir, 'status', '--porcelain') + git(dir, 'rev-parse', 'HEAD');
    resume(dir, red, claimFile, SLUG);
    expect(git(dir, 'status', '--porcelain') + git(dir, 'rev-parse', 'HEAD')).toBe(before);
  });

  test('rejects when nothing but Docs/ changed since the red-tests commit, and prints every reject when several conditions fail (AC5)', () => {
    let { dir, red, claimFile } = makeRepo({ impl: false });
    let r = resume(dir, red, claimFile, SLUG);
    expect(r.status).toBe(1);
    expect(rejects(r).join('\n')).toMatch(/no implementation change/);

    // changes only under Docs/ count as no implementation
    write(dir, 'Docs/other.md', 'x\n');
    commit(dir, 'docs only');
    write(dir, 'Docs/more.md', 'y\n');
    r = resume(dir, red, claimFile, SLUG);
    expect(r.status).toBe(1);
    expect(rejects(r).join('\n')).toMatch(/no implementation change/);

    ({ dir, red, claimFile } = makeRepo({ impl: false, claim: '' }));
    write(dir, 'server/__tests__/a.test.js', 'changed\n');
    r = resume(dir, red, claimFile, SLUG);
    expect(r.status).toBe(1);
    const rj = rejects(r);
    expect(rj.length).toBeGreaterThanOrEqual(3);
    expect(rj.join('\n')).toMatch(/empty/i);
    expect(rj.join('\n')).toContain('server/__tests__/a.test.js');
    expect(rj.join('\n')).toMatch(/no implementation change/);
  });

  test('rejects when a repair commit for this slug already exists, naming it and pointing to FROM=review (AC6)', () => {
    const { dir, red, claimFile } = makeRepo();
    // a repair commit for another slug does not count
    write(dir, 'Docs/x.md', 'x\n');
    commit(dir, 'test(other): repair invalid tests (mechanically checked and audited)');
    expect(resume(dir, red, claimFile, SLUG).status).toBe(0);

    write(dir, 'server/__tests__/a.test.js', "test('a works', () => { expect(1).toBe(1); });\n");
    commit(dir, `test(${SLUG}): repair invalid tests (mechanically checked and audited)`);
    const sha = git(dir, 'log', '-1', '--format=%h');
    const r = resume(dir, red, claimFile, SLUG);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`REJECT: test repair was already accepted in commit ${sha}: use FROM=review`);
  });

  test('missing arguments is a usage error, and the usage text for an unknown command lists resumecheck', () => {
    const { dir } = makeRepo();
    let r = resume(dir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/usage/i);
    expect(resume(dir, 'abc').status).not.toBe(0);

    r = spawnSync('node', [CHECK, 'nope'], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('resumecheck');
  });
});

describe('scripts/sdlc.sh FROM validation (execution)', () => {
  test('an unknown FROM exits 1 with the exact message and creates nothing (AC1); every valid FROM passes validation (AC2)', () => {
    // one directory for every value: a rejected value must leave it as it was, and an accepted one stops at the missing brief
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-from-'));
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.copyFileSync(path.join(root, 'scripts/sdlc.sh'), path.join(dir, 'scripts/sdlc.sh'));
    git(dir, 'init', '-q');
    const run = from => spawnSync('bash', ['scripts/sdlc.sh', SLUG], { cwd: dir, env: { ...process.env, FROM: from }, encoding: 'utf8' });

    for (const from of ['bogus', 'Implement', 'test_repair', 'TEST-REPAIR', 'Review']) {
      const r = run(from);
      expect([from, r.status]).toEqual([from, 1]);
      expect(r.stdout).toContain(`ERROR: unknown FROM=${from} (use spec, plan, red-tests, implement, review or test-repair)`);
      expect(fs.readdirSync(dir).sort()).toEqual(['.git', 'scripts']);
      expect(git(dir, 'status', '--porcelain')).toBe('?? scripts/');
      expect(git(dir, 'branch', '--list')).toBe('');
    }

    for (const from of ['spec', 'plan', 'red-tests', 'implement', 'test-repair', 'review']) {
      const r = run(from);
      expect(r.stdout).not.toContain('unknown FROM');
      expect(r.stdout).toContain(`Missing Docs/backlog/${SLUG}/brief.md`);
    }
  });

  test('bash -n passes on sdlc.sh and sdlc-mod.sh (AC11)', () => {
    expect(spawnSync('bash', ['-n', path.join(root, 'scripts/sdlc.sh')]).status).toBe(0);
    expect(spawnSync('bash', ['-n', path.join(root, 'scripts/sdlc-mod.sh')]).status).toBe(0);
  });
});

describe('scripts/sdlc.sh FROM=test-repair with failing preconditions (execution, AC7)', () => {
  // A temporary repository laid out like the real one, with a fake `claude` that records every call.
  function setup({ claim = null, redCommit = true }) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-tr-'));
    git(dir, 'init', '-q');
    fs.mkdirSync(path.join(dir, 'scripts'));
    for (const f of ['sdlc.sh', 'sdlc-testcheck.cjs', 'sdlc-changes.cjs']) fs.copyFileSync(path.join(root, 'scripts', f), path.join(dir, 'scripts', f));
    write(dir, `Docs/backlog/${SLUG}/brief.md`, 'brief\n');
    write(dir, 'server/__tests__/a.test.js', "test('a works', () => {});\n");
    write(dir, '.gitignore', 'bin/\ncalls.txt\n');
    commit(dir, 'init');
    if (redCommit) {
      write(dir, 'Docs/x.md', 'x\n');
      commit(dir, `test(${SLUG}): add failing tests and spec/plan docs`);
    }
    if (claim !== null) write(dir, `Docs/backlog/${SLUG}/test-issues.md`, claim);
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.writeFileSync(path.join(dir, 'bin/claude'), '#!/bin/sh\necho called >> "$(dirname "$0")/../calls.txt"\nexit 1\n', { mode: 0o755 });
    return dir;
  }
  const go = dir => spawnSync('bash', ['scripts/sdlc.sh', SLUG], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, FROM: 'test-repair', PATH: `${path.join(dir, 'bin')}:${process.env.PATH}` },
  });

  test('no red-tests commit and no claim file: exit 1, REJECT lines, no agent, no git change', () => {
    const dir = setup({ redCommit: false });
    const headBefore = git(dir, 'rev-parse', 'HEAD');
    const r = go(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('REJECT:');
    expect(r.stderr).toMatch(/no red-tests commit/);
    expect(fs.existsSync(path.join(dir, 'calls.txt'))).toBe(false);
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(headBefore);
  });

  test('a rejected resume keeps the claim file, restores no modified test and runs no agent', () => {
    const dir = setup({ claim: CLAIM });
    let r = go(dir); // no implementation change since the red commit
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no implementation change/);
    expect(fs.readFileSync(path.join(dir, `Docs/backlog/${SLUG}/test-issues.md`), 'utf8')).toBe(CLAIM);
    expect(fs.existsSync(path.join(dir, 'calls.txt'))).toBe(false);

    // tests modified since the red commit
    write(dir, 'server/__tests__/a.test.js', 'edited\n');
    write(dir, 'server/__tests__/new.test.js', 'new\n');
    r = go(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('git checkout');
    expect(fs.existsSync(path.join(dir, 'calls.txt'))).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'server/__tests__/a.test.js'), 'utf8')).toBe('edited\n');
    expect(fs.existsSync(path.join(dir, 'server/__tests__/new.test.js'))).toBe(true);
  });
});
