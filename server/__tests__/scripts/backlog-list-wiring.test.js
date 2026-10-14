const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

describe('criterion 8: wiring', () => {
  test('the script, its slash command and the root backlog script exist; sdlc.sh and the triage command are unchanged', () => {
    expect(fs.existsSync(path.join(root, 'scripts/backlog-list.cjs'))).toBe(true);

    // the slash command runs the script with $ARGUMENTS
    const p = path.join(root, '.claude/commands/backlog-list.md');
    expect(fs.existsSync(p)).toBe(true);
    const text = fs.readFileSync(p, 'utf8');
    expect(text).toContain('scripts/backlog-list.cjs');
    expect(text).toContain('$ARGUMENTS');

    expect(JSON.parse(read('package.json')).scripts.backlog).toBe('node scripts/backlog-list.cjs');

    // sdlc.sh still picks pending items with grep -m1
    expect(read('scripts/sdlc.sh')).toContain("grep -m1 '^- \\[ \\]'");
    // scope: the triage command does not reference backlog-list
    expect(read('.claude/commands/triage.md')).not.toContain('backlog-list');
  });

  test('the sdlc.sh grep and tick sed ignore the [!] and [~] lines', () => {
    const sample = [
      '# Backlog',
      '',
      '- [!] `blocked-one` - Feature: stuck (blocked: waiting)',
      '- [~] `parked-one` - Feature: later (parked: not now)',
      '- [x] `done-one` - Bug: done',
      '- [ ] `next-one` - Feature: next',
      '',
    ].join('\n');
    const file = path.join(require('os').tmpdir(), `backlog-wiring-${process.pid}.md`);
    const only = `${file}.only`;
    fs.writeFileSync(file, sample);
    fs.writeFileSync(only, '- [!] `blocked-one` - Feature: stuck\n');
    try {
      // grep -m1 selects the first [ ] line
      const grep = f => spawnSync('grep', ['-m1', '^- \\[ \\]', f], { encoding: 'utf8' }).stdout;
      expect(grep(file).trim()).toBe('- [ ] `next-one` - Feature: next');
      // and finds nothing when only a [!] line is left
      expect(grep(only)).toBe('');

      // the tick sed leaves the [!] line unchanged and ticks only the target
      const tick = slug => spawnSync('sed', ['-E', `s/^- \\[ \\] (\`${slug}\`)/- [x] \\1/`, file], { encoding: 'utf8' }).stdout;
      expect(tick('blocked-one')).toBe(sample);
      const ticked = tick('next-one');
      expect(ticked).toContain('- [x] `next-one` - Feature: next');
      expect(ticked).toContain('- [!] `blocked-one` - Feature: stuck (blocked: waiting)');
    } finally {
      fs.rmSync(file, { force: true });
      fs.rmSync(only, { force: true });
    }
  });
});

describe('criterion 10: docs', () => {
  test('README has a Backlog section, CLAUDE.md a /backlog-list row, and index.md a legend and item lines sdlc.sh can read', () => {
    // README: the markers, statuses and examples
    const readme = read('README.md');
    expect(readme).toMatch(/^#{1,6} Backlog\s*$/m);
    const section = readme.split(/^#{1,6} Backlog\s*$/m)[1].split(/^#{1,2} /m)[0];
    for (const s of ['pending', 'in-progress', 'blocked', 'completed']) expect(section).toContain(s);
    expect(section).toContain('[!]');
    expect(section).toContain('npm run backlog');
    expect(section).toContain('npm run backlog -- pending,in-progress');
    expect(section).toContain('/backlog-list blocked');

    const row = read('CLAUDE.md').split('\n').find(l => l.startsWith('|') && l.includes('/backlog-list'));
    expect(row).toBeDefined();
    expect(row).toContain('npm run backlog');

    // the index.md legend cannot be picked as an item
    const lines = read('Docs/backlog/index.md').split('\n');
    const legend = lines.filter(l => /in-progress/.test(l) && /sdlc\//.test(l));
    expect(legend.length).toBeGreaterThanOrEqual(1);
    for (const l of legend) {
      expect(l).not.toMatch(/^- \[[ xX!]\] `/);
      expect(l).not.toMatch(/^- \[ \]/);
    }
    const legendText = legend.join(' ');
    expect(legendText).toContain('[!]');
    expect(legendText).toContain('[x]');

    // item lines keep the format sdlc.sh expects
    const items = lines.filter(l => /^- \[[ xX!]\] /.test(l));
    expect(items.length).toBeGreaterThan(0);
    for (const l of items) expect(l).toMatch(/^- \[[ xX!]\] `[^`]+`/);
  });
});
