const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

describe('add-config-pane documentation', () => {
  test('README describes the CONFIG button, the command and the form wording', () => {
    const text = read('README.md');
    expect(text).toContain('CONFIG');
    expect(text).toContain('/sdlc-config');
    expect(text).toContain('API key variable NAME (not the key)');
  });

  test('README says the third field takes a variable name, never a key', () => {
    expect(read('README.md')).toMatch(/never a key/i);
  });

  test('CLAUDE.md names the CONFIG pane in the monitor control pane row', () => {
    const lines = read('CLAUDE.md')
      .split('\n')
      .filter(l => l.includes('/sdlc-monitor'));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some(l => l.includes('/sdlc-config') && l.includes('CONFIG'))).toBe(true);
  });
});
