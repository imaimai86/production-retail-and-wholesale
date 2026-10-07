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
function makeRepo({ impl = true, claim = CLAIM } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-resume-'));
  git(dir, 'init', '-q');
  write(dir, 'README.md', 'x\n');
  commit(dir, 'init');
  write(dir, 'server/__tests__/a.test.js', "test('a works', () => {});\n");
  write(dir, `Docs/backlog/${SLUG}/brief.md`, 'brief\n');
  const red = commit(dir, `test(${SLUG}): add failing tests and spec/plan docs`);
  if (claim !== null) write(dir, `Docs/backlog/${SLUG}/test-issues.md`, claim);
  if (impl) { write(dir, 'server/src/feature.js', 'module.exports = 1;\n'); commit(dir, 'impl'); }
  return { dir, red, claimFile: path.join(dir, `Docs/backlog/${SLUG}/test-issues.md`) };
}
const resume = (dir, ...args) => spawnSync('node', [CHECK, 'resumecheck', ...args], { cwd: dir, encoding: 'utf8' });
const rejects = r => r.stderr.split('\n').filter(l => l.startsWith('REJECT:'));
const RESTORE = red => `git checkout ${red} -- server/__tests__ && git clean -fd server/__tests__`;

describe('sdlc-testcheck resumecheck', () => {
  test('passes silently when all conditions hold (AC3)', () => {
    const { dir, red, claimFile } = makeRepo();
    const r = resume(dir, red, claimFile, SLUG);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
  });

  test('passes when the implementation is an uncommitted change', () => {
    const { dir, red, claimFile } = makeRepo({ impl: false });
    write(dir, 'server/src/feature.js', 'x\n');
    expect(resume(dir, red, claimFile, SLUG).status).toBe(0);
  });

  test('passes when the implementation is an untracked non-ignored file', () => {
    const { dir, red, claimFile } = makeRepo({ impl: false });
    write(dir, 'scripts/new.sh', 'x\n');
    expect(resume(dir, red, claimFile, SLUG).status).toBe(0);
  });

  test('rejects when there is no red-tests commit, and still checks the claim file', () => {
    const { dir, claimFile } = makeRepo();
    const r = resume(dir, '', claimFile, SLUG);
    expect(r.status).toBe(1);
    const rj = rejects(r);
    expect(rj).toHaveLength(1);
    expect(rj[0]).toContain(`no red-tests commit found for ${SLUG}`);
    fs.unlinkSync(claimFile);
    expect(rejects(resume(dir, '', claimFile, SLUG))).toHaveLength(2);
  });

  test('rejects a missing claim file', () => {
    const { dir, red, claimFile } = makeRepo();
    fs.unlinkSync(claimFile);
    const r = resume(dir, red, claimFile, SLUG);
    expect(r.status).toBe(1);
    expect(rejects(r).join('\n')).toMatch(/missing|does not exist|not found/i);
  });

  test('rejects an empty claim file', () => {
    const { dir, red, claimFile } = makeRepo({ claim: '' });
    const r = resume(dir, red, claimFile, SLUG);
    expect(r.status).toBe(1);
    expect(rejects(r).join('\n')).toMatch(/empty/i);
  });

  test('rejects a claim file without valid claim lines', () => {
    const { dir, red, claimFile } = makeRepo({ claim: 'just some prose\nno separators here\n' });
    const r = resume(dir, red, claimFile, SLUG);
    expect(r.status).toBe(1);
    expect(rejects(r).join('\n')).toMatch(/no valid|valid claim/i);
  });

  test('rejects a modified test file and prints the exact restore command without running it', () => {
    const { dir, red, claimFile } = makeRepo();
    write(dir, 'server/__tests__/a.test.js', "test('a works', () => { expect(1).toBe(2); });\n");
    const r = resume(dir, red, claimFile, SLUG);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('server/__tests__/a.test.js');
    expect(r.stderr).toContain(RESTORE(red));
    expect(fs.readFileSync(path.join(dir, 'server/__tests__/a.test.js'), 'utf8')).toContain('expect(1).toBe(2)');
  });

  test('rejects an untracked test file with the restore command', () => {
    const { dir, red, claimFile } = makeRepo();
    write(dir, 'server/__tests__/extra.test.js', 'x\n');
    const r = resume(dir, red, claimFile, SLUG);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('server/__tests__/extra.test.js');
    expect(r.stderr).toContain(RESTORE(red));
    expect(fs.existsSync(path.join(dir, 'server/__tests__/extra.test.js'))).toBe(true);
  });

  test('ignores git-ignored untracked files under the test directory', () => {
    const { dir, red, claimFile } = makeRepo();
    write(dir, '.gitignore', 'server/__tests__/ignored.tmp\n');
    commit(dir, 'ignore');
    write(dir, 'server/__tests__/ignored.tmp', 'x\n');
    expect(resume(dir, red, claimFile, SLUG).status).toBe(0);
  });

  test('rejects when nothing changed since the red-tests commit', () => {
    const { dir, red, claimFile } = makeRepo({ impl: false });
    const r = resume(dir, red, claimFile, SLUG);
    expect(r.status).toBe(1);
    expect(rejects(r).join('\n')).toMatch(/no implementation change/);
  });

  test('changes only under Docs/ count as no implementation', () => {
    const { dir, red, claimFile } = makeRepo({ impl: false });
    write(dir, 'Docs/other.md', 'x\n');
    commit(dir, 'docs only');
    write(dir, 'Docs/more.md', 'y\n');
    const r = resume(dir, red, claimFile, SLUG);
    expect(r.status).toBe(1);
    expect(rejects(r).join('\n')).toMatch(/no implementation change/);
  });

  test('prints every reject when several conditions fail (AC5)', () => {
    const { dir, red, claimFile } = makeRepo({ impl: false, claim: '' });
    write(dir, 'server/__tests__/a.test.js', 'changed\n');
    const r = resume(dir, red, claimFile, SLUG);
    expect(r.status).toBe(1);
    const rj = rejects(r);
    expect(rj.length).toBeGreaterThanOrEqual(3);
    expect(rj.join('\n')).toMatch(/empty/i);
    expect(rj.join('\n')).toContain('server/__tests__/a.test.js');
    expect(rj.join('\n')).toMatch(/no implementation change/);
  });

  test('rejects when a repair commit already exists, naming it and pointing to FROM=review (AC6)', () => {
    const { dir, red, claimFile } = makeRepo();
    write(dir, 'server/__tests__/a.test.js', "test('a works', () => { expect(1).toBe(1); });\n");
    commit(dir, `test(${SLUG}): repair invalid tests (mechanically checked and audited)`);
    const sha = git(dir, 'log', '-1', '--format=%h');
    const r = resume(dir, red, claimFile, SLUG);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`REJECT: test repair was already accepted in commit ${sha}: use FROM=review`);
  });

  test('a repair commit for another slug does not trigger the already-accepted reject', () => {
    const { dir, red, claimFile } = makeRepo();
    write(dir, 'Docs/x.md', 'x\n');
    commit(dir, 'test(other): repair invalid tests (mechanically checked and audited)');
    expect(resume(dir, red, claimFile, SLUG).status).toBe(0);
  });

  test('does not modify the repository or the test directory', () => {
    const { dir, red, claimFile } = makeRepo({ impl: false });
    write(dir, 'server/__tests__/a.test.js', 'changed\n');
    write(dir, 'server/__tests__/new.test.js', 'new\n');
    const before = git(dir, 'status', '--porcelain') + git(dir, 'rev-parse', 'HEAD');
    resume(dir, red, claimFile, SLUG);
    expect(git(dir, 'status', '--porcelain') + git(dir, 'rev-parse', 'HEAD')).toBe(before);
  });

  test('an unknown SHA yields a reject, not a stack trace', () => {
    const { dir, claimFile } = makeRepo();
    const r = resume(dir, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', claimFile, SLUG);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('REJECT:');
    expect(r.stderr).not.toMatch(/at .*\.cjs:\d+/);
  });

  test('missing arguments is a usage error', () => {
    const { dir } = makeRepo();
    const r = resume(dir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/usage/i);
    expect(resume(dir, 'abc').status).not.toBe(0);
  });

  test('the usage text for an unknown command lists resumecheck', () => {
    const r = spawnSync('node', [CHECK, 'nope'], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('resumecheck');
  });
});

describe('scripts/sdlc.sh FROM validation (execution)', () => {
  const tmpCopy = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-from-'));
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.copyFileSync(path.join(root, 'scripts/sdlc.sh'), path.join(dir, 'scripts/sdlc.sh'));
    git(dir, 'init', '-q');
    return dir;
  };
  const run = (dir, from) => spawnSync('bash', ['scripts/sdlc.sh', SLUG], { cwd: dir, env: { ...process.env, FROM: from }, encoding: 'utf8' });

  test.each(['bogus', 'Implement', 'test_repair', 'TEST-REPAIR', 'Review'])('FROM=%s exits 1 with the exact message and creates nothing (AC1)', from => {
    const dir = tmpCopy();
    const r = run(dir, from);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`ERROR: unknown FROM=${from} (use spec, plan, red-tests, implement, review or test-repair)`);
    expect(fs.readdirSync(dir).sort()).toEqual(['.git', 'scripts']);
    expect(git(dir, 'status', '--porcelain')).toBe('?? scripts/');
    expect(git(dir, 'branch', '--list')).toBe('');
  });

  test.each(['spec', 'plan', 'red-tests', 'implement', 'test-repair', 'review'])('FROM=%s passes validation (AC2)', from => {
    const dir = tmpCopy();
    const r = run(dir, from);
    expect(r.stdout).not.toContain('unknown FROM');
    expect(r.stdout).toContain(`Missing Docs/backlog/${SLUG}/brief.md`);
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

  test('tests modified since the red commit: nothing is restored, no agent runs', () => {
    const dir = setup({ claim: CLAIM });
    write(dir, 'server/__tests__/a.test.js', 'edited\n');
    write(dir, 'server/__tests__/new.test.js', 'new\n');
    const r = go(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('git checkout');
    expect(fs.existsSync(path.join(dir, 'calls.txt'))).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'server/__tests__/a.test.js'), 'utf8')).toBe('edited\n');
    expect(fs.existsSync(path.join(dir, 'server/__tests__/new.test.js'))).toBe(true);
  });

  test('the claim file is not deleted on a rejected resume', () => {
    const dir = setup({ claim: CLAIM });
    const r = go(dir); // no implementation change since the red commit
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no implementation change/);
    expect(fs.readFileSync(path.join(dir, `Docs/backlog/${SLUG}/test-issues.md`), 'utf8')).toBe(CLAIM);
    expect(fs.existsSync(path.join(dir, 'calls.txt'))).toBe(false);
  });
});

describe('scripts/sdlc.sh structure (text of the source under test)', () => {
  const lines = sdlcSrc.split('\n');
  const idx = re => lines.findIndex(l => re.test(l));

  test('FROM validation precedes the first git call and the first mkdir (AC1)', () => {
    const val = idx(/unknown FROM=/);
    expect(val).toBeGreaterThan(-1);
    expect(val).toBeLessThan(idx(/\bgit (rev-parse|checkout)/));
    expect(val).toBeLessThan(idx(/mkdir -p/));
  });

  test('the unknown-value message lists all six values', () => {
    expect(sdlcSrc).toContain('ERROR: unknown FROM=$FROM (use spec, plan, red-tests, implement, review or test-repair)');
  });

  test('stage ordering puts test-repair between implement and review', () => {
    expect(sdlcSrc).toMatch(/implement\) FROM_N=4;; test-repair\) FROM_N=5;; review\) FROM_N=6/);
  });

  test('the header comment lists the six FROM values', () => {
    expect(lines.slice(0, 12).join('\n')).toContain('FROM=spec|plan|red-tests|implement|test-repair|review');
  });

  test('the red-tests commit for test-repair is looked up without the repair commit', () => {
    expect(sdlcSrc).toMatch(/FROM_N" -eq 5 \]; then(?:(?!REPAIR_PAT)[\s\S]){0,200}RED_SHA=\$\(git log --format=%H -1 --grep="\^test\(\$SLUG\): add failing tests"\)/);
  });

  test('the WARNING line precedes the rm -f of the claim file', () => {
    const warn = idx(/WARNING: test-issues\.md exists and will be deleted; use FROM=test-repair to resume at Test repair/);
    const rm = idx(/rm -f "\$DOCS\/test-issues\.md"/);
    expect(warn).toBeGreaterThan(-1);
    expect(rm).toBeGreaterThan(warn);
  });

  test('the Implement stage and rm -f sit inside a guard that excludes test-repair', () => {
    const rm = idx(/rm -f "\$DOCS\/test-issues\.md"/);
    const guard = lines.slice(0, rm).map((l, i) => [l, i]).filter(([l]) => /if \[ "\$FROM_N" -le 4 \]; then/.test(l)).pop();
    const outer = idx(/^if \[ "\$FROM_N" -le 5 \]; then/);
    expect(outer).toBeGreaterThan(-1);
    expect(guard).toBeDefined();
    expect(guard[1]).toBeGreaterThan(outer);
  });

  test('the Test repair block is entered for FROM_N up to 5', () => {
    expect(sdlcSrc).toMatch(/if \[ "\$FROM_N" -le 5 \]; then\s*\n\s*jest_json_at/);
  });

  test('review compares against the renumbered stage 6', () => {
    expect(sdlcSrc).toMatch(/\[ "\$FROM_N" -eq 6 \] && REPAIR_PAT/);
  });

  test('the resume hint text is used for non-verdict failures only', () => {
    expect(sdlcSrc).toContain('Resume at Test repair once fixed: FROM=test-repair ./scripts/sdlc.sh $SLUG');
    expect(sdlcSrc).toMatch(/reject "claims fail pre-check \(see above\)" hint/);
    expect(sdlcSrc).toMatch(/reject "auditor failed to run" hint/);
    for (const verdict of ['diff check failed', 'tests were removed or renamed', 'a repaired test no longer fails', 'independent auditor did not return', 'source files were modified', 'repair agent says the tests are right', 'checks still fail after an audited repair']) {
      const l = lines.find(x => x.includes(verdict)) || '';
      expect(l).toContain(verdict);
      expect(l).not.toMatch(/\bhint\b/);
    }
  });

  test('the up-front pre-check failure message', () => {
    expect(sdlcSrc).toContain('REJECT: claims would not pass the pre-check');
  });
});
