const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const gate = path.resolve(__dirname, '../../../scripts/sdlc-integration-gate.cjs');
const INT = 'server/__tests__/integration';
const SOURCES = {
  migrations: 'server/migrations/001_init.sql',
  schema: 'server/schema.sql',
  models: 'server/models/sales.js',
  index: 'server/index.js',
  middleware: 'server/middleware/auth.js',
  validation: 'server/validation.js',
};
const SRC_BODY = 'line one\nline two\nline three\n';

const repos = [];
const sh = (cwd, cmd, args) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
};
const write = (repo, rel, text) => {
  const f = path.join(repo, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};
const commit = (repo, msg) => {
  sh(repo, 'git', ['add', '-A']);
  sh(repo, 'git', ['commit', '-q', '-m', msg]);
  return sh(repo, 'git', ['rev-parse', 'HEAD']);
};

function makeRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'int-gate-'));
  repos.push(repo);
  sh(repo, 'git', ['init', '-q']);
  sh(repo, 'git', ['config', 'user.name', 'T']);
  sh(repo, 'git', ['config', 'user.email', 't@example.com']);
  write(repo, `${INT}/existing.integration.test.js`, "describe('GET /existing', () => {});\n");
  write(repo, 'server/__tests__/foo.test.js', "test('unit', () => {});\n");
  for (const f of Object.values(SOURCES)) write(repo, f, SRC_BODY);
  write(repo, 'Docs/notes.md', 'notes\n');
  write(repo, 'server/test-utils/helper.js', SRC_BODY);
  write(repo, 'server/scripts/tool.js', SRC_BODY);
  write(repo, 'package.json', '{"name":"x"}\n');
  write(repo, 'server/package.json', '{"name":"y"}\n');
  commit(repo, 'base');
  return repo;
}

const run = (repo, ...args) => spawnSync('node', [gate, ...args], { cwd: repo, encoding: 'utf8' });

afterAll(() => repos.forEach(r => fs.rmSync(r, { recursive: true, force: true })));

const plan = bullets => `# Plan\n\n## Other\n\ntext\n\n## DB and API changes\n\n${bullets}\n\n## Later\n\n- API: \`GET /ignored\`\n`;

describe('sdlc-integration-gate plan', () => {
  const planRun = (repo, text) => {
    write(repo, 'Docs/plan-1.md', text);
    return run(repo, 'plan', 'Docs/plan-1.md', 'server/__tests__');
  };

  test('AC1 "- none" passes', () => {
    const repo = makeRepo();
    const r = planRun(repo, plan('- none'));
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain('REJECT');
  });

  test('AC1 "- none" passes with blank lines around the bullet', () => {
    const repo = makeRepo();
    expect(planRun(repo, plan('\n\n- none\n\n')).status).toBe(0);
  });

  test('AC2 missing section rejects with message', () => {
    const repo = makeRepo();
    const r = planRun(repo, '# Plan\n\n## Steps\n\n- none\n');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("REJECT: Plan has no '## DB and API changes' section");
  });

  test('AC2 a near-miss heading does not count', () => {
    const repo = makeRepo();
    const r = planRun(repo, '# Plan\n\n## DB and API change\n\n- none\n');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Plan has no');
  });

  const KINDS = [
    ['API', '- API: `POST /sales/:id/refund`', 'POST /sales/:id/refund'],
    ['migration', '- DB: migration `003_add_refunds`', '003_add_refunds'],
    ['table', '- DB: table `refunds`', 'refunds'],
    ['column', '- DB: column `refunds.reason`', 'refunds.reason'],
    ['model', '- DB: model `sales`', 'sales'],
  ];

  describe.each(KINDS)('AC3 %s bullet', (_kind, bullet, token) => {
    test('token in a modified integration file passes', () => {
      const repo = makeRepo();
      write(repo, `${INT}/existing.integration.test.js`, `describe('${token}', () => {});\n`);
      const r = planRun(repo, plan(bullet));
      expect(r.status).toBe(0);
    });

    test('token in a new staged integration file passes', () => {
      const repo = makeRepo();
      write(repo, `${INT}/new.integration.test.js`, `test('${token}', () => {});\n`);
      sh(repo, 'git', ['add', `${INT}/new.integration.test.js`]);
      expect(planRun(repo, plan(bullet)).status).toBe(0);
    });

    test('token absent rejects and names the bullet', () => {
      const repo = makeRepo();
      write(repo, `${INT}/existing.integration.test.js`, "describe('something else entirely', () => {});\n");
      const r = planRun(repo, plan(bullet));
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('REJECT:');
      expect(r.stderr).toContain(token);
    });

    test('token only in a unit test file rejects', () => {
      const repo = makeRepo();
      write(repo, 'server/__tests__/foo.test.js', `test('${token}', () => {});\n`);
      expect(planRun(repo, plan(bullet)).status).toBe(1);
    });

    test('token only in an unmodified integration file rejects', () => {
      const repo = makeRepo();
      write(repo, `${INT}/existing.integration.test.js`, `describe('${token}', () => {});\n`);
      commit(repo, 'token committed, nothing changed afterwards');
      expect(planRun(repo, plan(bullet)).status).toBe(1);
    });

    test('token only in an untracked integration file rejects', () => {
      const repo = makeRepo();
      write(repo, `${INT}/untracked.integration.test.js`, `test('${token}', () => {});\n`);
      expect(planRun(repo, plan(bullet)).status).toBe(1);
    });
  });

  test('AC3 every missing bullet is listed in one run', () => {
    const repo = makeRepo();
    write(repo, `${INT}/existing.integration.test.js`, "describe('003_add_refunds', () => {});\n");
    const r = planRun(repo, plan('- DB: migration `003_add_refunds`\n- DB: table `refunds_xyz`\n- API: `DELETE /gone_xyz`'));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('refunds_xyz');
    expect(r.stderr).toContain('DELETE /gone_xyz');
    expect(r.stderr).not.toContain('REJECT: bullet `003_add_refunds`');
  });

  test('AC3 several bullets all present pass', () => {
    const repo = makeRepo();
    write(repo, `${INT}/existing.integration.test.js`, "describe('POST /a and refunds.reason', () => {});\n");
    const r = planRun(repo, plan('- API: `POST /a`\n- DB: column `refunds.reason`'));
    expect(r.status).toBe(0);
  });

  test('AC4 a bullet in a later section is not part of the plan section', () => {
    const repo = makeRepo();
    // the "Later" section of plan() has an API bullet; it must not be required
    const r = planRun(repo, plan('- none'));
    expect(r.status).toBe(0);
  });

  describe('AC5 malformed sections', () => {
    test.each([
      ['unknown bullet text', '- something else'],
      ['missing backticks', '- API: POST /x'],
      ['lower-case method', '- API: `post /x`'],
      ['migration with .sql', '- DB: migration `003_x.sql`'],
      ['column without a dot', '- DB: column `refunds`'],
      ['model with .js', '- DB: model `sales.js`'],
      ['star bullet', '* none'],
      ['plain prose', 'This plan changes nothing.'],
    ])('%s rejects', (_n, body) => {
      const repo = makeRepo();
      const r = planRun(repo, plan(body));
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('REJECT:');
    });

    test('malformed line is named in the output', () => {
      const repo = makeRepo();
      const r = planRun(repo, plan('- API: POST /named_line'));
      expect(r.stderr).toContain('- API: POST /named_line');
    });

    test('empty section rejects', () => {
      const repo = makeRepo();
      const r = planRun(repo, plan('\n'));
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('REJECT:');
    });

    test('section at end of file with no bullets rejects', () => {
      const repo = makeRepo();
      expect(planRun(repo, '# Plan\n\n## DB and API changes\n').status).toBe(1);
    });

    test('"- none" plus another bullet rejects', () => {
      const repo = makeRepo();
      write(repo, `${INT}/existing.integration.test.js`, "describe('refunds', () => {});\n");
      const r = planRun(repo, plan('- none\n- DB: table `refunds`'));
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('REJECT:');
    });

    test('two "- none" lines with another bullet in either order rejects', () => {
      const repo = makeRepo();
      write(repo, `${INT}/existing.integration.test.js`, "describe('refunds', () => {});\n");
      expect(planRun(repo, plan('- DB: table `refunds`\n- none')).status).toBe(1);
    });
  });

  test('section at end of file (no following heading) is parsed', () => {
    const repo = makeRepo();
    expect(planRun(repo, '# Plan\n\n## DB and API changes\n\n- none\n').status).toBe(0);
  });
});

describe('sdlc-integration-gate usage', () => {
  test('unknown subcommand exits 1 with usage on stderr', () => {
    const repo = makeRepo();
    const r = run(repo, 'bogus');
    expect(r.status).toBe(1);
    expect(r.stderr.length).toBeGreaterThan(0);
  });

  test('no subcommand exits 1', () => {
    expect(run(makeRepo()).status).toBe(1);
  });

  test.each([
    [['plan']],
    [['plan', 'Docs/plan-1.md']],
    [['diff']],
    [['diff', 'HEAD']],
  ])('missing arguments %j exit 1 with usage', args => {
    const r = run(makeRepo(), ...args);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/usage/i);
  });
});

describe('sdlc-integration-gate diff', () => {
  // Builds: base -> red commit (with or without integration tests), then edits `file` in the working tree.
  function setup({ withIntegration, file, edit }) {
    const repo = makeRepo();
    write(repo, 'server/__tests__/foo.test.js', "test('unit changed', () => {});\n");
    if (withIntegration) write(repo, `${INT}/new.integration.test.js`, "test('POST /x', () => {});\n");
    const red = commit(repo, 'test(slug): add failing tests');
    if (file) write(repo, file, edit);
    return { repo, red };
  }
  const changed = SRC_BODY + 'new executable line\n';
  const diffRun = ({ repo, red }, orig = red) => run(repo, 'diff', red, orig);

  describe.each(Object.entries(SOURCES))('AC6 source path %s', (_k, file) => {
    test('change without integration tests in the red commit rejects', () => {
      const s = setup({ withIntegration: false, file, edit: changed });
      const r = diffRun(s);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('REJECT:');
      expect(r.stderr).toContain(file);
      expect(r.stderr).toMatch(/plan/i);
    });

    test('change with integration tests in the red commit passes', () => {
      const s = setup({ withIntegration: true, file, edit: changed });
      expect(diffRun(s).status).toBe(0);
    });

    test('a removed line counts as a change', () => {
      const s = setup({ withIntegration: false, file, edit: 'line one\nline three\n' });
      expect(diffRun(s).status).toBe(1);
    });
  });

  test('AC6 change inside a source directory subfile (nested) is detected', () => {
    const s = setup({ withIntegration: false, file: 'server/models/purchases.js', edit: 'module.exports = 1;\n' });
    // new untracked file: not seen (AC10); modify a tracked one nested instead
    expect(diffRun(s).status).toBe(0);
    write(s.repo, 'server/models/sales.js', changed);
    expect(diffRun(s).status).toBe(1);
  });

  test('AC6 no change at all passes', () => {
    const s = setup({ withIntegration: false });
    expect(diffRun(s).status).toBe(0);
  });

  describe('AC7 comment-only and whitespace-only edits', () => {
    test.each([
      ['// line comment', '// added comment\n'],
      ['* block continuation', ' * added doc line\n'],
      ['/* block start', '/* added block */\n'],
      ['-- sql comment', '-- added sql comment\n'],
      ['indented comment', '    // indented comment\n'],
    ])('%s passes without integration tests', (_n, added) => {
      const s = setup({ withIntegration: false, file: SOURCES.models, edit: SRC_BODY + added });
      expect(diffRun(s).status).toBe(0);
    });

    test('removing a comment line passes', () => {
      const repo = makeRepo();
      write(repo, SOURCES.models, '// a comment\nline one\n');
      commit(repo, 'with comment');
      write(repo, 'server/__tests__/foo.test.js', 'test("u2", () => {});\n');
      const red = commit(repo, 'test(slug): add failing tests');
      write(repo, SOURCES.models, 'line one\n');
      expect(run(repo, 'diff', red, red).status).toBe(0);
    });

    test('whitespace-only edit passes', () => {
      const s = setup({ withIntegration: false, file: SOURCES.models, edit: 'line one\n\n    line two\n\t\nline three\n' });
      expect(diffRun(s).status).toBe(0);
    });

    test('blank-line-only edit passes', () => {
      const s = setup({ withIntegration: false, file: SOURCES.validation, edit: '\n\n' + SRC_BODY + '\n\n' });
      expect(diffRun(s).status).toBe(0);
    });

    test('a comment plus a real line still rejects', () => {
      const s = setup({ withIntegration: false, file: SOURCES.models, edit: SRC_BODY + '// note\nconst x = 1;\n' });
      expect(diffRun(s).status).toBe(1);
    });

    test('comment-only edit in one file plus real change in another rejects and lists only the real one', () => {
      const s = setup({ withIntegration: false, file: SOURCES.models, edit: SRC_BODY + '// note\n' });
      write(s.repo, SOURCES.index, changed);
      const r = diffRun(s);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(SOURCES.index);
      expect(r.stderr).not.toContain(SOURCES.models);
    });
  });

  describe('AC8 non-source changes', () => {
    test.each([
      ['docs', 'Docs/notes.md'],
      ['server/test-utils', 'server/test-utils/helper.js'],
      ['server/scripts', 'server/scripts/tool.js'],
      ['root package.json', 'package.json'],
      ['server package.json', 'server/package.json'],
    ])('%s passes without integration tests', (_n, file) => {
      const s = setup({ withIntegration: false, file, edit: 'completely different content\nmore\n' });
      expect(diffRun(s).status).toBe(0);
    });

    test('changed unit test files pass', () => {
      const s = setup({ withIntegration: false, file: 'server/__tests__/foo.test.js', edit: "test('again', () => {});\n" });
      expect(diffRun(s).status).toBe(0);
    });
  });

  describe('AC9 after a Test repair commit', () => {
    test('integration tests in the original red commit satisfy the gate', () => {
      const s = setup({ withIntegration: true });
      write(s.repo, 'server/__tests__/foo.test.js', "test('repaired', () => {});\n");
      const repair = commit(s.repo, 'test(slug): repair');
      write(s.repo, SOURCES.models, changed);
      const r = run(s.repo, 'diff', repair, s.red);
      expect(r.status).toBe(0);
    });

    test('using the repair commit as the original would reject (proves orig is used)', () => {
      const s = setup({ withIntegration: true });
      write(s.repo, 'server/__tests__/foo.test.js', "test('repaired', () => {});\n");
      const repair = commit(s.repo, 'test(slug): repair');
      write(s.repo, SOURCES.models, changed);
      expect(run(s.repo, 'diff', repair, repair).status).toBe(1);
    });

    test('original red commit without integration tests rejects even if the repair has them', () => {
      const s = setup({ withIntegration: false });
      write(s.repo, `${INT}/repair.integration.test.js`, "test('late', () => {});\n");
      const repair = commit(s.repo, 'test(slug): repair');
      write(s.repo, SOURCES.models, changed);
      expect(run(s.repo, 'diff', repair, s.red).status).toBe(1);
    });

    test('source change made before the red commit is not counted against it', () => {
      const s = setup({ withIntegration: false });
      write(s.repo, SOURCES.models, changed);
      const repair = commit(s.repo, 'implementation committed');
      expect(run(s.repo, 'diff', repair, s.red).status).toBe(0);
    });
  });

  describe('AC10 documented limitation: untracked files are not seen', () => {
    test('new untracked migration alone passes', () => {
      const s = setup({ withIntegration: false, file: 'server/migrations/003_add_refunds.sql', edit: 'CREATE TABLE refunds (id int);\n' });
      expect(diffRun(s).status).toBe(0);
    });

    test('once staged, the same file is seen and rejects', () => {
      const s = setup({ withIntegration: false, file: 'server/migrations/003_add_refunds.sql', edit: 'CREATE TABLE refunds (id int);\n' });
      sh(s.repo, 'git', ['add', 'server/migrations/003_add_refunds.sql']);
      expect(diffRun(s).status).toBe(1);
    });
  });
});
