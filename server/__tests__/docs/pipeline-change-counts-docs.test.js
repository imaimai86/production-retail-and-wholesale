const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../../..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

describe('pipeline change counts: documentation', () => {
  test('README.md lists the changes subcommand in the wrapper command list', () => {
    expect(read('README.md')).toContain('bash scripts/sdlc-mod.sh changes <slug> [--json]');
  });

  test('README.md control pane section describes the counts', () => {
    const readme = read('README.md');
    expect(readme).toMatch(/files changed/);
    expect(readme).toMatch(/uncommitted/);
  });

  test('CLAUDE.md lists changes in the scripts/sdlc-mod.sh command row', () => {
    const row = read('CLAUDE.md').split('\n').find(l => l.includes('scripts/sdlc-mod.sh run'));
    expect(row).toBeDefined();
    expect(row).toMatch(/\bchanges\b/);
  });

  test('the wrapper header comment documents the subcommand', () => {
    expect(read('scripts/sdlc-mod.sh')).toContain('scripts/sdlc-mod.sh changes <slug> [--json]');
  });
});
