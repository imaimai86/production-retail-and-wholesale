const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const helper = path.join(root, 'scripts/sdlc-config.cjs');
const { codeSearchFor, renderTemplate, renderSkill, resolve } = require(helper);
const sdlcSh = fs.readFileSync(path.join(root, 'scripts/sdlc.sh'), 'utf8');

const tmp = (prefix = 'sdlc-cs-') => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
// A PATH with a stand-in graft, and one without (node's own folder may hold a real graft, so node is called by full path).
const fakeGraftBin = () => { const bin = tmp('sdlc-bin-'); fs.writeFileSync(path.join(bin, 'graft'), '#!/bin/sh\n', { mode: 0o755 }); return bin; };
const withGraft = () => ({ PATH: `${fakeGraftBin()}:/usr/bin:/bin` });
const noGraft = { PATH: '/usr/bin:/bin' };
const indexed = () => { const dir = tmp(); fs.mkdirSync(path.join(dir, 'graft')); return dir; };
// Fixture skill and part files (written here, not the repo's own text).
const fixtures = () => {
  const dir = tmp('sdlc-skills-');
  fs.mkdirSync(path.join(dir, 'skills'));
  fs.mkdirSync(path.join(dir, 'parts'));
  fs.writeFileSync(path.join(dir, 'skills/demo.md'), 'Step 1. {{CODE_SEARCH}}\nStep 2: again {{CODE_SEARCH}}\n');
  fs.writeFileSync(path.join(dir, 'parts/code-search.graft.md'), 'USE-GRAFT & callers\n');
  fs.writeFileSync(path.join(dir, 'parts/code-search.md'), 'USE-GREP\n');
  return { skillsDir: path.join(dir, 'skills'), partsDir: path.join(dir, 'parts') };
};

describe('choosing graft or Grep/Glob', () => {
  test('graft only when it is on PATH and the project has a graft/ index; "none" turns it off', () => {
    expect(codeSearchFor(indexed(), 'auto', withGraft())).toEqual({ codeSearch: 'graft', warning: null });
    expect(codeSearchFor(indexed(), 'graft', withGraft())).toEqual({ codeSearch: 'graft', warning: null });
    expect(codeSearchFor(indexed(), 'none', withGraft())).toEqual({ codeSearch: 'none', warning: null });

    const noIndex = codeSearchFor(tmp(), 'auto', withGraft());
    expect(noIndex.codeSearch).toBe('none');
    expect(noIndex.warning).toMatch(/^the project has no graft\/ index \(run graft build\); code search uses Grep and Glob\. graft .* is recommended/);
    const missing = codeSearchFor(indexed(), 'auto', noGraft);
    expect(missing).toEqual({ codeSearch: 'none', warning: expect.stringMatching(/^graft is not installed; code search uses Grep and Glob\. .*npm install -g @nanonets\/graft, then graft build$/) });
    expect(codeSearchFor(indexed(), 'graft', noGraft).warning).toMatch(/^agent.codeSearch is "graft" but graft is not installed/);
  });

  test('the settings carry the choice and the recommendation as a warning, never as an error', () => {
    const dir = indexed();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
    expect(resolve(dir, { env: withGraft() })).toMatchObject({ errors: [], warnings: [], config: { agent: { codeSearch: 'graft' } } });
    const without = resolve(dir, { env: noGraft });
    expect(without.errors).toEqual([]);
    expect(without.config.agent.codeSearch).toBe('none');
    expect(without.warnings).toEqual([expect.stringContaining('graft is not installed')]);
  });
});

describe('skills in two versions', () => {
  test('{{CODE_SEARCH}} is filled with the graft part or the Grep/Glob part, everywhere it appears', () => {
    const { partsDir } = fixtures();
    expect(renderTemplate('a {{CODE_SEARCH}} b {{CODE_SEARCH}}', 'graft', partsDir)).toBe('a USE-GRAFT & callers b USE-GRAFT & callers');
    expect(renderTemplate('a {{CODE_SEARCH}}', 'none', partsDir)).toBe('a USE-GREP');
    expect(renderTemplate('no marker', 'graft', partsDir)).toBe('no marker');
  });

  test('a skill is rendered for the project: graft when available, the setting can turn it off, unknown names give null', () => {
    const f = fixtures();
    const dir = indexed();
    expect(renderSkill('demo', dir, { ...f, env: withGraft() })).toBe('Step 1. USE-GRAFT & callers\nStep 2: again USE-GRAFT & callers\n');
    expect(renderSkill('demo', dir, { ...f, env: noGraft })).toBe('Step 1. USE-GREP\nStep 2: again USE-GREP\n');
    fs.writeFileSync(path.join(dir, 'sdlc.config.json'), JSON.stringify({ agent: { codeSearch: 'none' } }));
    expect(renderSkill('demo', dir, { ...f, env: withGraft() })).toBe('Step 1. USE-GREP\nStep 2: again USE-GREP\n');
    fs.writeFileSync(path.join(dir, 'sdlc.config.json'), '{ broken');
    expect(renderSkill('demo', dir, { ...f, env: withGraft() })).toContain('USE-GRAFT');
    expect(renderSkill('missing', dir, f)).toBeNull();
    expect(renderSkill('../demo', dir, f)).toBeNull();
  });
});

describe('sdlc.sh', () => {
  const slice = (from, to) => sdlcSh.slice(sdlcSh.indexOf(from), sdlcSh.indexOf(to));
  // A temp folder laid out like the repo for the pieces of sdlc.sh under test: fixture prompt and part files.
  const repo = () => {
    const cwd = tmp('sdlc-sh-');
    fs.mkdirSync(path.join(cwd, 'scripts/prompts/parts'), { recursive: true });
    fs.mkdirSync(path.join(cwd, 'logs'));
    fs.writeFileSync(path.join(cwd, 'scripts/prompts/prompt-demo.md'), 'Read {{DOCS}}/spec. {{CODE_SEARCH}} Then plan.');
    fs.writeFileSync(path.join(cwd, 'scripts/prompts/prompt-plain.md'), 'No marker here.');
    fs.writeFileSync(path.join(cwd, 'scripts/prompts/parts/code-search.graft.md'), 'GRAFT-PART & more\n');
    fs.writeFileSync(path.join(cwd, 'scripts/prompts/parts/code-search.md'), 'GREP-PART\n');
    fs.copyFileSync(helper, path.join(cwd, 'scripts/sdlc-config.cjs'));
    return cwd;
  };
  const bash = (cwd, body, env = {}) => spawnSync('bash', ['-c', `set -euo pipefail\n${body}`],
    { cwd, encoding: 'utf8', env: { PATH: `/usr/bin:/bin:${path.dirname(process.execPath)}`, ...env } });

  test('render_prompt fills {{CODE_SEARCH}} with the graft part or the Grep/Glob part, keeping & as written', () => {
    const fn = slice('render_prompt() {', '\n# agent <log-name> <stage>');
    const cwd = repo();
    const vars = 'DOCS=Docs/backlog/s; LOG=logs; TEST_DIR=t; TEST_CMD=x; SLUG=s';
    expect(bash(cwd, `${vars}; CODE_SEARCH=graft\n${fn}\nrender_prompt demo`).stdout).toBe('Read Docs/backlog/s/spec. GRAFT-PART & more Then plan.');
    expect(bash(cwd, `${vars}; CODE_SEARCH=none\n${fn}\nrender_prompt demo`).stdout).toBe('Read Docs/backlog/s/spec. GREP-PART Then plan.');
    expect(bash(cwd, `${vars}\n${fn}\nrender_prompt plain`).stdout).toBe('No marker here.');
    fs.rmSync(path.join(cwd, 'scripts/prompts/parts/code-search.md'));
    const r = bash(cwd, `${vars}; CODE_SEARCH=none\n${fn}\nrender_prompt demo`);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('ERROR: missing prompt part scripts/prompts/parts/code-search.md');
  });

  test('code_search_setup gives the agents the graft tools only with graft, and prints the recommendation without it', () => {
    const fn = slice('code_search_setup() {', '\ncode_search_setup\n');
    const show = 'code_search_setup\necho "CS=$CODE_SEARCH"\nprintf "%s|" "${ALLOWED[@]}"';
    const cwd = repo();
    fs.mkdirSync(path.join(cwd, 'graft'));
    const on = bash(cwd, `LOG=logs\n${fn}\n${show}`, { PATH: `${fakeGraftBin()}:/usr/bin:/bin:${path.dirname(process.execPath)}` });
    expect(on.stdout).toBe('CS=graft\nRead|Write|Edit|Glob|Grep|mcp__graft|Bash(npm test:*)|Bash(npm run lint:*)|Bash(npm run generate-spec:*)|Bash(graft:*)|'
      + 'Bash(ls:*)|Bash(git status:*)|Bash(git diff:*)|Bash(git log:*)|');

    fs.rmdirSync(path.join(cwd, 'graft'));
    const off = bash(cwd, `LOG=logs\n${fn}\n${show}`);
    expect(off.status).toBe(0);
    expect(off.stdout).toMatch(/^NOTE: (graft is not installed|the project has no graft\/ index \(run graft build\)); code search uses Grep and Glob\. graft .* is recommended/);
    expect(off.stdout).toContain('CS=none\nRead|Write|Edit|Glob|Grep|Bash(npm test:*)|Bash(npm run lint:*)|Bash(npm run generate-spec:*)|Bash(ls:*)|');
    expect(off.stdout).not.toContain('graft:*');
  });
});

describe('command line', () => {
  test('code-search prints graft or none and never fails; skill prints a rendered skill or exits 2', () => {
    const cs = (dir, env) => spawnSync(process.execPath, [helper, 'code-search', dir], { encoding: 'utf8', env });
    expect(cs(indexed(), withGraft()).stdout).toBe('graft\n');
    const off = cs(indexed(), noGraft);
    expect(off).toMatchObject({ status: 0, stdout: 'none\n' });
    expect(off.stderr).toContain('NOTE: graft is not installed');
    const broken = indexed();
    fs.writeFileSync(path.join(broken, 'sdlc.config.json'), '{ nope');
    expect(cs(broken, withGraft()).stdout).toBe('graft\n');

    for (const env of [withGraft(), noGraft]) {
      const r = spawnSync(process.execPath, [helper, 'skill', 'plan', indexed()], { encoding: 'utf8', env });
      expect(r.status).toBe(0);
      expect(r.stdout.length).toBeGreaterThan(0);
      expect(r.stdout).not.toContain('{{CODE_SEARCH}}');
    }
    const bad = spawnSync(process.execPath, [helper, 'skill', 'nope'], { encoding: 'utf8' });
    expect(bad.status).toBe(2);
    expect(bad.stderr).toMatch(/^ERROR: no skill "nope" \(skills: .*plan.*triage/);
  });
});
