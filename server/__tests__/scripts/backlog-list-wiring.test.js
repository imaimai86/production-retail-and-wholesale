const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

describe('criterion 8: wiring', () => {
  test('slash command exists and runs the script with $ARGUMENTS', () => {
    const p = path.join(root, '.claude/commands/backlog-list.md');
    expect(fs.existsSync(p)).toBe(true);
    const text = fs.readFileSync(p, 'utf8');
    expect(text).toContain('scripts/backlog-list.cjs');
    expect(text).toContain('$ARGUMENTS');
  });

  test('root package.json has a backlog script that runs the script', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts.backlog).toBe('node scripts/backlog-list.cjs');
  });

  test('the script file exists', () => {
    expect(fs.existsSync(path.join(root, 'scripts/backlog-list.cjs'))).toBe(true);
  });

  test('scripts/sdlc.sh still picks pending items with grep -m1', () => {
    expect(read('scripts/sdlc.sh')).toContain("grep -m1 '^- \\[ \\]'");
  });

  describe('sdlc.sh grep and tick sed ignore a [!] line', () => {
    const sample = [
      '# Backlog',
      '',
      '- [!] `blocked-one` - Feature: stuck (blocked: waiting)',
      '- [x] `done-one` - Bug: done',
      '- [ ] `next-one` - Feature: next',
      '',
    ].join('\n');
    const file = path.join(require('os').tmpdir(), `backlog-wiring-${process.pid}.md`);

    beforeAll(() => fs.writeFileSync(file, sample));
    afterAll(() => fs.rmSync(file, { force: true }));

    test('grep -m1 selects the first [ ] line, not the [!] line', () => {
      const r = spawnSync('grep', ['-m1', '^- \\[ \\]', file], { encoding: 'utf8' });
      expect(r.stdout.trim()).toBe('- [ ] `next-one` - Feature: next');
    });

    test('grep finds nothing when only a [!] line is left', () => {
      const only = `${file}.only`;
      fs.writeFileSync(only, '- [!] `blocked-one` - Feature: stuck\n');
      try {
        const r = spawnSync('grep', ['-m1', '^- \\[ \\]', only], { encoding: 'utf8' });
        expect(r.stdout).toBe('');
      } finally {
        fs.rmSync(only, { force: true });
      }
    });

    test('tick sed leaves the [!] line unchanged and ticks only the target', () => {
      const tick = slug => spawnSync('sed', ['-E', `s/^- \\[ \\] (\`${slug}\`)/- [x] \\1/`, file], { encoding: 'utf8' }).stdout;
      expect(tick('blocked-one')).toBe(sample);
      const ticked = tick('next-one');
      expect(ticked).toContain('- [x] `next-one` - Feature: next');
      expect(ticked).toContain('- [!] `blocked-one` - Feature: stuck (blocked: waiting)');
    });
  });
});

describe('criterion 10: docs', () => {
  test('README has a Backlog section with the markers, statuses and examples', () => {
    const readme = read('README.md');
    expect(readme).toMatch(/^#{1,6} Backlog\s*$/m);
    const section = readme.split(/^#{1,6} Backlog\s*$/m)[1].split(/^#{1,2} /m)[0];
    for (const s of ['pending', 'in-progress', 'blocked', 'completed']) expect(section).toContain(s);
    expect(section).toContain('[!]');
    expect(section).toContain('npm run backlog');
    expect(section).toContain('npm run backlog -- pending,in-progress');
    expect(section).toContain('/backlog-list blocked');
  });

  test('CLAUDE.md commands table has a /backlog-list row', () => {
    const row = read('CLAUDE.md').split('\n').find(l => l.startsWith('|') && l.includes('/backlog-list'));
    expect(row).toBeDefined();
    expect(row).toContain('npm run backlog');
  });

  test('index.md header has a legend that cannot be picked as an item', () => {
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
  });

  test('index.md item lines keep the format sdlc.sh expects', () => {
    const items = read('Docs/backlog/index.md').split('\n').filter(l => /^- \[[ xX!]\] /.test(l));
    expect(items.length).toBeGreaterThan(0);
    for (const l of items) expect(l).toMatch(/^- \[[ xX!]\] `[^`]+`/);
  });
});

describe('scope: unchanged files', () => {
  test('triage command does not reference backlog-list', () => {
    expect(read('.claude/commands/triage.md')).not.toContain('backlog-list');
  });
});
