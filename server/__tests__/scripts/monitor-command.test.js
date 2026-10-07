const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

describe('the monitor command printed in replies', () => {
  test.each(['CLAUDE.md', '.claude/commands/sdlc.md'])('%s uses the worktree-aware watch command', file => {
    const text = read(file);
    expect(text).toContain('bash scripts/sdlc-mod.sh watch <slug>');
    expect(text).not.toContain('git status --short | head -15');
    expect(text).not.toContain("watch -n3 'cat Docs/backlog");
  });

  test('README lists the watch subcommand', () => {
    expect(read('README.md')).toContain('bash scripts/sdlc-mod.sh watch <slug>');
  });
});
