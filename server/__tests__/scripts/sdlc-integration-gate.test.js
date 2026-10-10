const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const gate = path.join(__dirname, '..', '..', '..', 'scripts', 'sdlc-integration-gate.cjs');

let repo;
const git = (...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const write = (rel, body) => {
  const f = path.join(repo, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
};
const run = (...args) => spawnSync('node', [gate, ...args], { cwd: repo, encoding: 'utf8' });
const commitAll = msg => { git('add', '-A'); git('commit', '-q', '-m', msg); return git('rev-parse', 'HEAD'); };

const INTEGRATION = 'server/__tests__/integration';
const plan = section => `# Plan\n\n## Files\n- server/models/x.js\n\n${section}\n\n## Order\n1. do it\n`;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'int-gate-'));
  git('init', '-q');
  write('server/models/x.js', 'module.exports = {};\n');
  write('server/index.js', "const app = {};\nmodule.exports = app;\n");
  write('server/middleware/auth.js', 'module.exports = {};\n');
  write('server/validation.js', 'module.exports = {};\n');
  write('server/schema.sql', 'CREATE TABLE t (id INT);\n');
  write('server/migrations/001_initial.sql', 'CREATE TABLE t (id INT);\n');
  write(`${INTEGRATION}/api.integration.test.js`, "describe('existing', () => { test('works', () => {}); });\n");
  write('README.md', '# readme\n');
  commitAll('base');
});
afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

describe('sdlc-integration-gate section', () => {
  test('a plan without the section is rejected with the exact message', () => {
    write('plan.md', '# Plan\n- nothing\n');
    const r = run('section', 'plan.md');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Plan has no '## DB and API changes' section");
  });

  test('the single bullet none prints none', () => {
    write('plan.md', plan('## DB and API changes\n- none'));
    const r = run('section', 'plan.md');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('none');
  });

  test.each([
    ['API', '- API: `POST /sales/:id/refund`'],
    ['migration', '- DB: migration `003_add_refunds`'],
    ['table', '- DB: table `refunds`'],
    ['column', '- DB: column `refunds.reason`'],
    ['model', '- DB: model `refunds`'],
  ])('a %s bullet is accepted and prints required', (_kind, bullet) => {
    write('plan.md', plan(`## DB and API changes\n${bullet}`));
    const r = run('section', 'plan.md');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('required');
  });

  test('prose lines are ignored and the section ends at the next heading', () => {
    write('plan.md', plan('## DB and API changes\nSome prose.\n- DB: table `refunds`\n\n## Notes\n- not a bullet of the section'));
    expect(run('section', 'plan.md').status).toBe(0);
  });

  test.each([
    ['a bullet in the wrong form', '- API: POST /x'],
    ['an unknown HTTP method', '- API: `FETCH /x`'],
    ['a column without a table', '- DB: column `reason`'],
    ['none mixed with another bullet', '- none\n- DB: table `refunds`'],
    ['an empty section', ''],
  ])('rejects %s', (_what, body) => {
    write('plan.md', plan(`## DB and API changes\n${body}`));
    const r = run('section', 'plan.md');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('REJECT:');
  });

  test('a missing plan file is rejected', () => {
    expect(run('section', 'missing.md').status).toBe(1);
  });
});

describe('sdlc-integration-gate plan', () => {
  const sectionFor = bullets => plan(`## DB and API changes\n${bullets.join('\n')}`);

  test('none passes without any integration test', () => {
    write('plan.md', plan('## DB and API changes\n- none'));
    const r = run('plan', 'plan.md', 'server/__tests__');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('none');
  });

  test('every bullet kind is satisfied by a title in a new integration test', () => {
    write('plan.md', sectionFor(['- API: `POST /sales/:id/refund`', '- DB: migration `003_add_refunds`', '- DB: table `refunds`', '- DB: column `refunds.reason`', '- DB: model `refunds`']));
    write(`${INTEGRATION}/refunds.integration.test.js`, [
      "describe('POST /sales/:id/refund', () => {",
      "  test('migration 003_add_refunds creates refunds with refunds.reason', () => {});",
      '});',
      ''].join('\n'));
    const r = run('plan', 'plan.md', 'server/__tests__');
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('required');
  });

  test('a token that no title mentions is rejected and named', () => {
    write('plan.md', sectionFor(['- API: `POST /sales/:id/refund`', '- DB: table `refunds`']));
    write(`${INTEGRATION}/refunds.integration.test.js`, "test('POST /sales/:id/refund works', () => {});\n");
    const r = run('plan', 'plan.md', 'server/__tests__');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('"refunds"');
    expect(r.stderr).not.toContain('"POST /sales/:id/refund"');
  });

  test('only unit tests were written: rejected', () => {
    write('plan.md', sectionFor(['- DB: table `refunds`']));
    write('server/__tests__/models/refunds.test.js', "test('refunds table', () => {});\n");
    const r = run('plan', 'plan.md', 'server/__tests__');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no new or modified integration test');
  });

  test('a token that appears only in a comment or a body is not enough', () => {
    write('plan.md', sectionFor(['- DB: table `refunds`']));
    write(`${INTEGRATION}/refunds.integration.test.js`, "// refunds\ntest('something else', () => { const t = 'refunds'; });\n");
    expect(run('plan', 'plan.md', 'server/__tests__').status).toBe(1);
  });

  test('a modified existing integration file counts', () => {
    write('plan.md', sectionFor(['- DB: table `sales`']));
    write(`${INTEGRATION}/api.integration.test.js`, "describe('existing', () => { test('works', () => {}); });\ndescribe('sales refunds', () => {});\n");
    expect(run('plan', 'plan.md', 'server/__tests__').status).toBe(0);
  });

  test('an unchanged integration file that already mentions the token does not count', () => {
    write(`${INTEGRATION}/api.integration.test.js`, "describe('sales', () => {});\n");
    commitAll('add sales test');
    write('plan.md', sectionFor(['- DB: table `sales`']));
    const r = run('plan', 'plan.md', 'server/__tests__');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no new or modified integration test');
  });

  test('a plan without the section is rejected before looking at tests', () => {
    write('plan.md', '# Plan\n');
    const r = run('plan', 'plan.md', 'server/__tests__');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Plan has no '## DB and API changes' section");
  });
});

describe('sdlc-integration-gate diff', () => {
  // Original red commit: adds the (optional) integration tests; red_sha defaults to it.
  const redCommit = withIntegration => {
    write('Docs/backlog/x/specs-1.md', '# spec\n');
    if (withIntegration) write(`${INTEGRATION}/new.integration.test.js`, "test('x', () => {});\n");
    else write('server/__tests__/models/new.test.js', "test('x', () => {});\n");
    return commitAll('red');
  };

  test('no source change passes', () => {
    const red = redCommit(false);
    expect(run('diff', red, red).status).toBe(0);
  });

  test.each([
    ['README.md', '# changed\n'],
    ['server/test-utils/scratchDb.js', 'module.exports = {};\n'],
    ['server/scripts/gen.js', 'module.exports = {};\n'],
    ['server/package.json', '{"name":"s"}\n'],
    ['Docs/backlog/x/review-1.md', '# review\n'],
  ])('a change to %s is not a source change', (file, body) => {
    const red = redCommit(false);
    write(file, body);
    expect(run('diff', red, red).status).toBe(0);
  });

  test('comment-only and whitespace-only edits are ignored', () => {
    const red = redCommit(false);
    write('server/models/x.js', '// a new comment\n/* block */\n/**\n * jsdoc\n */\nmodule.exports   =   {};\n\n\n');
    write('server/schema.sql', '-- a sql comment\nCREATE TABLE t (id INT);\n');
    const r = run('diff', red, red);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  test.each([
    ['server/models/x.js', 'module.exports = { changed: true };\n'],
    ['server/index.js', "const app = {};\napp.x = 1;\nmodule.exports = app;\n"],
    ['server/middleware/auth.js', 'module.exports = { y: 1 };\n'],
    ['server/validation.js', 'module.exports = { z: 1 };\n'],
    ['server/schema.sql', 'CREATE TABLE t (id INT, name TEXT);\n'],
  ])('a code change in %s without integration tests is rejected', (file, body) => {
    const red = redCommit(false);
    write(file, body);
    const r = run('diff', red, red);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(file);
    expect(r.stderr).toContain('rerun from Plan');
  });

  test('a new migration file without integration tests is rejected, with them it passes', () => {
    let red = redCommit(false);
    write('server/migrations/002_x.sql', 'ALTER TABLE t ADD COLUMN name TEXT;\n');
    const bad = run('diff', red, red);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('server/migrations/002_x.sql');
    fs.rmSync(path.join(repo, 'server/migrations/002_x.sql'));
    git('reset', '-q', '--hard', 'HEAD~1');
    red = redCommit(true);
    write('server/migrations/002_x.sql', 'ALTER TABLE t ADD COLUMN name TEXT;\n');
    expect(run('diff', red, red).status).toBe(0);
  });

  test('a source change passes when the red commit added integration tests', () => {
    const red = redCommit(true);
    write('server/models/x.js', 'module.exports = { changed: true };\n');
    expect(run('diff', red, red).status).toBe(0);
  });

  test('after a repair commit the original red commit is the one that is checked', () => {
    const orig = redCommit(true);
    write('server/__tests__/models/new.test.js', "test('x', () => { expect(1).toBe(1); });\n");
    const repair = commitAll('repair');
    write('server/models/x.js', 'module.exports = { changed: true };\n');
    expect(run('diff', repair, orig).status).toBe(0);
  });

  test('after a repair commit a red commit without integration tests is still rejected', () => {
    const orig = redCommit(false);
    write('server/__tests__/models/new.test.js', "test('x', () => { expect(1).toBe(1); });\n");
    const repair = commitAll('repair');
    write('server/models/x.js', 'module.exports = { changed: true };\n');
    const r = run('diff', repair, orig);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('server/models/x.js');
  });

  test('missing arguments are rejected', () => {
    expect(run('diff').status).toBe(1);
  });
});
