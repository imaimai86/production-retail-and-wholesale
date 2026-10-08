const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../../..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

describe('AC18 documentation of the integration-test requirement', () => {
  test.each(['AGENTS.md', 'CLAUDE.md'])('%s requires integration tests for DB or API changes', f => {
    const t = read(f);
    expect(t).toMatch(/DB or API change/);
    expect(t).toContain('server/__tests__/integration/');
  });

  test('plan.md describes the section and its "- none" form', () => {
    const t = read('.claude/commands/plan.md');
    expect(t).toContain('## DB and API changes');
    expect(t).toContain('- none');
  });

  test('red-tests.md describes the integration directory and the section', () => {
    const t = read('.claude/commands/red-tests.md');
    expect(t).toContain('server/__tests__/integration/');
    expect(t).toContain('## DB and API changes');
  });

  test('tdd-loop.md describes the diff gate', () => {
    expect(read('.claude/commands/tdd-loop.md')).toMatch(/diff gate/i);
  });

  test('README documents format, gates, exit codes, CI skip, limitation and no opt-out', () => {
    const t = read('README.md');
    expect(t).toContain('## DB and API changes');
    expect(t).toMatch(/exit[^\n]*\b3\b/i);
    expect(t).toContain('SDLC_INTEGRATION_CI');
    expect(t).toMatch(/untracked/i);
    expect(t).toMatch(/no opt-out/i);
  });
});
