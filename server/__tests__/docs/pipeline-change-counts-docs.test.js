const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../../..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

describe('pipeline change counts: documentation', () => {
  test('README.md, CLAUDE.md and the wrapper header document the changes subcommand and its counts', () => {
    const readme = read('README.md');
    // the wrapper command list
    expect(readme).toContain('bash scripts/sdlc-mod.sh changes <slug> [--json]');
    // the control pane section describes the counts
    expect(readme).toMatch(/files changed/);
    expect(readme).toMatch(/uncommitted/);

    const row = read('CLAUDE.md').split('\n').find(l => l.includes('scripts/sdlc-mod.sh run'));
    expect(row).toBeDefined();
    expect(row).toMatch(/\bchanges\b/);

    expect(read('scripts/sdlc-mod.sh')).toContain('scripts/sdlc-mod.sh changes <slug> [--json]');
  });
});
