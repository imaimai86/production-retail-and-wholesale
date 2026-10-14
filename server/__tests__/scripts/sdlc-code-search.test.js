const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const helper = path.join(root, 'scripts/sdlc-config.cjs');
const { codeIndexers, codeSearchErrors, codeSearchFor, codeSearchGuide, renderTemplate, renderSkill, resolve } = require(helper);
const sdlcSh = fs.readFileSync(path.join(root, 'scripts/sdlc.sh'), 'utf8');

const tmp = (prefix = 'sdlc-cs-') => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
// A PATH holding stand-ins for the given programs only (node is called by its full path: its folder may hold a real graft).
const pathWith = (...programs) => {
  const bin = tmp('sdlc-bin-');
  for (const p of programs) fs.writeFileSync(path.join(bin, p), '#!/bin/sh\n', { mode: 0o755 });
  return { PATH: `${bin}:/usr/bin:/bin` };
};
// A project with the given files (an index is a file or a folder: a trailing slash makes a folder).
const project = (...entries) => {
  const dir = tmp();
  for (const e of entries) {
    if (e.endsWith('/')) fs.mkdirSync(path.join(dir, e), { recursive: true });
    else { fs.mkdirSync(path.dirname(path.join(dir, e)), { recursive: true }); fs.writeFileSync(path.join(dir, e), '{}'); }
  }
  return dir;
};
const both = () => project('graft/', 'graphify-out/graph.json');
// Fixture part and skill files (written here, not the repo's own text).
const fixtures = () => {
  const dir = tmp('sdlc-parts-');
  fs.mkdirSync(path.join(dir, 'skills'));
  fs.mkdirSync(path.join(dir, 'parts'));
  fs.writeFileSync(path.join(dir, 'skills/demo.md'), 'Step 1. {{CODE_SEARCH}}\nStep 2: again {{CODE_SEARCH}}\n');
  fs.writeFileSync(path.join(dir, 'parts/code-search.graft.md'), 'USE-GRAFT & callers\n');
  fs.writeFileSync(path.join(dir, 'parts/code-search.graphify.md'), 'USE-GRAPHIFY\n');
  fs.writeFileSync(path.join(dir, 'parts/code-search.md'), 'USE-GREP\n');
  return { skillsDir: path.join(dir, 'skills'), partsDir: path.join(dir, 'parts') };
};
const CUSTOM = { codeIndexers: { sourcegraph: { command: 'src', tools: ['mcp__sourcegraph'], commands: ['src search'], guide: 'USE-SRC' } } };

describe('choosing a code indexer', () => {
  test('built in: graft and graphify, each needing its command on PATH and its index', () => {
    const all = codeIndexers({});
    expect(Object.keys(all)).toEqual(['graft', 'graphify']);
    expect(all.graft).toMatchObject({ command: 'graft', index: 'graft', tools: ['mcp__graft'], commands: ['graft'] });
    expect(all.graphify).toMatchObject({ command: 'graphify', index: 'graphify-out/graph.json', tools: [], commands: ['graphify'] });
  });

  test('auto takes the first available, in agent.codeSearchOrder when given; none means Grep and Glob', () => {
    const name = (dir, agent, env) => codeSearchFor(dir, { agent }, env).codeSearch;
    expect(name(both(), {}, pathWith('graft', 'graphify'))).toBe('graft');
    expect(name(both(), { codeSearchOrder: ['graphify', 'graft'] }, pathWith('graft', 'graphify'))).toBe('graphify');
    expect(name(both(), {}, pathWith('graphify'))).toBe('graphify');
    expect(name(project('graft/'), {}, pathWith('graft', 'graphify'))).toBe('graft');
    expect(name(project('graphify-out/'), {}, pathWith('graphify'))).toBe('none'); // the index is graph.json, not the folder
    expect(name(both(), { codeSearch: 'none' }, pathWith('graft', 'graphify'))).toBe('none');

    const nothing = codeSearchFor(project(), {}, pathWith());
    expect(nothing).toMatchObject({ codeSearch: 'none', indexer: null });
    expect(nothing.warning).toBe('no code indexer is available; code search uses Grep and Glob. A code indexer is recommended: '
      + 'graft (npm install -g @nanonets/graft, then graft build), or graphify (uv tool install graphifyy (or pipx install graphifyy), then build the graph with /graphify . in Claude Code)');
  });

  test('a named indexer is used when available, else Grep and Glob with how to set it up', () => {
    expect(codeSearchFor(both(), { agent: { codeSearch: 'graphify' } }, pathWith('graft', 'graphify'))).toMatchObject({ codeSearch: 'graphify', warning: null });
    expect(codeSearchFor(project(), { agent: { codeSearch: 'graphify' } }, pathWith('graphify')).warning)
      .toBe('agent.codeSearch is "graphify" but the project has no graphify index (graphify-out/graph.json); code search uses Grep and Glob. '
        + 'To set it up: uv tool install graphifyy (or pipx install graphifyy), then build the graph with /graphify . in Claude Code');
    expect(codeSearchFor(both(), { agent: { codeSearch: 'graft' } }, pathWith()).warning).toMatch(/^agent.codeSearch is "graft" but graft is not installed \(no graft command\)/);
  });

  test('a project declares its own indexer, or changes a built-in one field by field', () => {
    const custom = codeSearchFor(project(), { agent: { codeSearch: 'sourcegraph', ...CUSTOM } }, pathWith('src'));
    expect(custom).toMatchObject({ codeSearch: 'sourcegraph', indexer: { tools: ['mcp__sourcegraph'], commands: ['src search'], guide: 'USE-SRC' } });
    const moved = codeIndexers({ agent: { codeIndexers: { graft: { index: '.cache/graft' } } } }).graft;
    expect(moved).toMatchObject({ command: 'graft', index: '.cache/graft', tools: ['mcp__graft'] });
    expect(codeSearchFor(project('.cache/graft/'), { agent: { codeIndexers: { graft: { index: '.cache/graft' } } } }, pathWith('graft')).codeSearch).toBe('graft');
  });

  test('settings that name unknown indexers or declare incomplete ones are errors', () => {
    expect(codeSearchErrors({ agent: { codeSearch: 'nope' } })).toEqual(['agent.codeSearch: "nope" is not a code indexer (use auto, none, graft, graphify)']);
    expect(codeSearchErrors({ agent: { codeSearchOrder: ['graft', 'x'] } })).toEqual(['agent.codeSearchOrder: "x" is not a code indexer']);
    expect(codeSearchErrors({ agent: { codeIndexers: { mine: {}, Bad_Name: { command: 'a b', guide: 'g' }, auto: { command: 'x', guide: 'g' } } } })).toEqual([
      'agent.codeIndexers.mine: needs "command" (the program that must be on PATH)',
      'agent.codeIndexers.mine: needs "guide" or "guideFile" (how the agents should search with it)',
      'agent.codeIndexers.Bad_Name: names use lowercase letters, digits and dashes',
      'agent.codeIndexers.Bad_Name.command: a program name, not a command line',
      'agent.codeIndexers.auto: "auto" is reserved',
    ]);
    expect(codeSearchErrors({ agent: { codeSearch: 'sourcegraph', ...CUSTOM } })).toEqual([]);

    const dir = project();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
    fs.writeFileSync(path.join(dir, 'sdlc.config.json'), JSON.stringify({ agent: { codeIndexers: { x: { command: 'x', guide: 'g', extra: 1 } } } }));
    expect(resolve(dir).errors).toEqual(['sdlc.config.json: agent.codeIndexers.x.extra: unknown setting']);
  });

  test('the settings carry the indexer, its index as a worktree link, and the recommendation as a warning', () => {
    const dir = both();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
    const on = resolve(dir, { env: pathWith('graphify') });
    expect(on).toMatchObject({ errors: [], warnings: [], config: { agent: { codeSearch: 'graphify', codeIndexer: { commands: ['graphify'] } } } });
    expect(on.config.worktree.link).toEqual(['node_modules', 'graphify-out']);
    const off = resolve(dir, { env: pathWith() });
    expect(off.errors).toEqual([]);
    expect(off.config.agent).toMatchObject({ codeSearch: 'none', codeIndexer: null });
    expect(off.warnings).toEqual([expect.stringContaining('no code indexer is available')]);
  });
});

describe('skills and prompts in a version per indexer', () => {
  test('the guide: the indexer\'s own text or file, its part file, else the Grep/Glob part', () => {
    const { partsDir } = fixtures();
    const dir = both();
    const guide = (agent, env) => codeSearchGuide(codeSearchFor(dir, { agent }, env), dir, partsDir);
    expect(guide({}, pathWith('graft'))).toBe('USE-GRAFT & callers');
    expect(guide({}, pathWith('graphify'))).toBe('USE-GRAPHIFY');
    expect(guide({}, pathWith())).toBe('USE-GREP');
    expect(guide({ codeSearch: 'sourcegraph', ...CUSTOM }, pathWith('src'))).toBe('USE-SRC');
    fs.writeFileSync(path.join(dir, 'search.txt'), 'FROM-FILE\n');
    expect(guide({ codeSearch: 'g2', codeIndexers: { g2: { command: 'src', guideFile: 'search.txt' } } }, pathWith('src'))).toBe('FROM-FILE');
    expect(guide({ codeIndexers: { graft: { guide: 'MY-GRAFT' } } }, pathWith('graft'))).toBe('MY-GRAFT');
    expect(renderTemplate('a {{CODE_SEARCH}} b {{CODE_SEARCH}} c', 'X')).toBe('a X b X c');
  });

  test('a skill is rendered for the project; a broken settings file searches as auto; unknown names give null', () => {
    const f = fixtures();
    const dir = both();
    const skill = env => renderSkill('demo', dir, { ...f, env });
    expect(skill(pathWith('graft'))).toBe('Step 1. USE-GRAFT & callers\nStep 2: again USE-GRAFT & callers\n');
    expect(skill(pathWith('graphify'))).toBe('Step 1. USE-GRAPHIFY\nStep 2: again USE-GRAPHIFY\n');
    expect(skill(pathWith())).toBe('Step 1. USE-GREP\nStep 2: again USE-GREP\n');
    fs.writeFileSync(path.join(dir, 'sdlc.config.json'), JSON.stringify({ agent: { codeSearch: 'none' } }));
    expect(skill(pathWith('graft'))).toContain('USE-GREP');
    fs.writeFileSync(path.join(dir, 'sdlc.config.json'), JSON.stringify({ agent: { codeSearch: 'nope' } }));
    expect(skill(pathWith('graft'))).toContain('USE-GRAFT');
    fs.writeFileSync(path.join(dir, 'sdlc.config.json'), '{ broken');
    expect(skill(pathWith('graft'))).toContain('USE-GRAFT');
    expect(renderSkill('missing', dir, f)).toBeNull();
    expect(renderSkill('../demo', dir, f)).toBeNull();
  });
});

describe('sdlc.sh', () => {
  const slice = (from, to) => sdlcSh.slice(sdlcSh.indexOf(from), sdlcSh.indexOf(to));
  // A temp folder laid out like the repo: the real helper, fixture prompt and part files.
  const repo = (...entries) => {
    const cwd = project(...entries);
    fs.mkdirSync(path.join(cwd, 'scripts/prompts/parts'), { recursive: true });
    fs.mkdirSync(path.join(cwd, 'logs'));
    fs.writeFileSync(path.join(cwd, 'scripts/prompts/prompt-demo.md'), 'Read {{DOCS}}/spec. {{CODE_SEARCH}} Then plan.');
    fs.writeFileSync(path.join(cwd, 'scripts/prompts/prompt-plain.md'), 'No marker here.');
    for (const [n, t] of [['code-search.graft.md', 'GRAFT-PART & more'], ['code-search.graphify.md', 'GRAPHIFY-PART'], ['code-search.md', 'GREP-PART']]) {
      fs.writeFileSync(path.join(cwd, 'scripts/prompts/parts', n), `${t}\n`);
    }
    fs.copyFileSync(helper, path.join(cwd, 'scripts/sdlc-config.cjs'));
    return cwd;
  };
  // node from a folder of its own (its real folder may hold graft too).
  const nodeBin = tmp('sdlc-node-');
  fs.symlinkSync(process.execPath, path.join(nodeBin, 'node'));
  const bash = (cwd, body, env = pathWith()) => spawnSync('bash', ['-c', `set -euo pipefail\n${body}`],
    { cwd, encoding: 'utf8', env: { PATH: `${env.PATH}:${nodeBin}` } });
  const setup = slice('code_search_setup() {', '\ncode_search_setup\n');
  const show = 'code_search_setup\necho "CS=$CODE_SEARCH"\nprintf "%s|" "${ALLOWED[@]}"';
  const BASE_START = 'Read|Write|Edit|Glob|Grep|';
  const TESTS = 'Bash(npm test:*)|Bash(npm run lint:*)|Bash(npm run generate-spec:*)|';
  const GIT = 'Bash(ls:*)|Bash(git status:*)|Bash(git diff:*)|Bash(git log:*)|';

  test('code_search_setup gives the agents only the tools and commands of the indexer in use', () => {
    const cwd = repo('graft/', 'graphify-out/graph.json');
    expect(bash(cwd, `LOG=logs\n${setup}\n${show}`, pathWith('graft')).stdout).toBe(`CS=graft\n${BASE_START}mcp__graft|${TESTS}Bash(graft:*)|${GIT}`);
    expect(bash(cwd, `LOG=logs\n${setup}\n${show}`, pathWith('graphify')).stdout).toBe(`CS=graphify\n${BASE_START}${TESTS}Bash(graphify:*)|${GIT}`);
    fs.writeFileSync(path.join(cwd, 'sdlc.config.json'), JSON.stringify({ agent: { codeSearch: 'sourcegraph', ...CUSTOM } }));
    expect(bash(cwd, `LOG=logs\n${setup}\n${show}`, pathWith('src')).stdout).toBe(`CS=sourcegraph\n${BASE_START}mcp__sourcegraph|${TESTS}Bash(src search:*)|${GIT}`);

    const off = bash(repo(), `LOG=logs\n${setup}\n${show}`);
    expect(off.status).toBe(0);
    expect(off.stdout).toMatch(/^NOTE: no code indexer is available; code search uses Grep and Glob\. A code indexer is recommended: graft/);
    expect(off.stdout).toContain(`CS=none\n${BASE_START}${TESTS}${GIT}`);
  });

  test('render_prompt fills {{CODE_SEARCH}} with the indexer\'s guide, else the Grep/Glob part, keeping & as written', () => {
    const fn = slice('render_prompt() {', '\n# agent <log-name> <stage>');
    const vars = 'DOCS=Docs/backlog/s; LOG=logs; TEST_DIR=t; TEST_CMD=x; SLUG=s';
    const cwd = repo('graft/', 'graphify-out/graph.json');
    const render = (stage, env) => bash(cwd, `${vars}\n${setup}\n${fn}\ncode_search_setup >/dev/null\nrender_prompt ${stage}`, env);
    expect(render('demo', pathWith('graft')).stdout).toBe('Read Docs/backlog/s/spec. GRAFT-PART & more Then plan.');
    expect(render('demo', pathWith('graphify')).stdout).toBe('Read Docs/backlog/s/spec. GRAPHIFY-PART Then plan.');
    expect(render('demo', pathWith()).stdout).toBe('Read Docs/backlog/s/spec. GREP-PART Then plan.');
    expect(render('plain', pathWith('graft')).stdout).toBe('No marker here.');
    // without code_search_setup (no guide loaded) it falls back to the Grep/Glob part, which must exist
    expect(bash(cwd, `${vars}\n${fn}\nrender_prompt demo`).stdout).toBe('Read Docs/backlog/s/spec. GREP-PART Then plan.');
    fs.rmSync(path.join(cwd, 'scripts/prompts/parts/code-search.md'));
    const r = bash(cwd, `${vars}\n${fn}\nrender_prompt demo`);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('ERROR: missing prompt part scripts/prompts/parts/code-search.md');
  });
});

describe('command line', () => {
  const cli = (args, env) => spawnSync(process.execPath, [helper, ...args], { encoding: 'utf8', env });

  test('code-search prints the indexer in use and never fails; --sh prints it for sdlc.sh', () => {
    const dir = both();
    expect(cli(['code-search', dir], pathWith('graft')).stdout).toBe('graft\n');
    const off = cli(['code-search', dir], pathWith());
    expect(off).toMatchObject({ status: 0, stdout: 'none\n' });
    expect(off.stderr).toContain('NOTE: no code indexer is available');
    fs.writeFileSync(path.join(dir, 'sdlc.config.json'), JSON.stringify({ agent: { codeSearch: 'nope' } }));
    const bad = cli(['code-search', dir], pathWith('graphify'));
    expect(bad).toMatchObject({ status: 0, stdout: 'graphify\n' });
    expect(bad.stderr).toContain('NOTE: agent.codeSearch: "nope" is not a code indexer (use auto, none, graft, graphify); using "auto"');

    fs.writeFileSync(path.join(dir, 'sdlc.config.json'), JSON.stringify({ agent: { codeSearch: 'sourcegraph', ...CUSTOM, codeIndexers: { sourcegraph: { ...CUSTOM.codeIndexers.sourcegraph, guide: "it's & \"quoted\"" } } } }));
    const sh = cli(['code-search', dir, '--sh'], pathWith('src')).stdout;
    const loaded = spawnSync('bash', ['-c', `eval "$1"; printf '%s|' "$CODE_SEARCH" "\${CODE_SEARCH_MCP[@]}" "\${CODE_SEARCH_BASH[@]}" "$CODE_SEARCH_GUIDE"`, '_', sh], { encoding: 'utf8' });
    expect(loaded.stdout).toBe('sourcegraph|mcp__sourcegraph|src search|it\'s & "quoted"|');
  });

  test('--list shows every indexer and whether it is available; --use saves the choice in sdlc.config.json', () => {
    const dir = project('graphify-out/graph.json');
    fs.writeFileSync(path.join(dir, 'sdlc.config.json'), JSON.stringify({ backlogDir: 'Docs/backlog', agent: { allowCommands: ['make'] } }));
    const list = cli(['code-search', dir, '--list'], pathWith('graphify')).stdout;
    expect(list).toContain('agent.codeSearch: auto; in use: graphify');
    expect(list).toContain('graft     not available: graft is not installed (no graft command)\n');
    expect(list).toContain('set up: npm install -g @nanonets/graft, then graft build');
    expect(list).toContain('* graphify  available');
    expect(list).toContain('code-search --use <graft|graphify|auto|none>');

    const use = cli(['code-search', dir, '--use', 'graft'], pathWith('graphify'));
    expect(use.status).toBe(0);
    expect(use.stdout).toContain('agent.codeSearch = "graft" in sdlc.config.json; code search now uses Grep and Glob');
    expect(use.stdout).toContain('NOTE: agent.codeSearch is "graft" but graft is not installed');
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'sdlc.config.json'), 'utf8'))).toEqual({ backlogDir: 'Docs/backlog', agent: { allowCommands: ['make'], codeSearch: 'graft' } });
    expect(cli(['code-search', dir, '--use', 'none'], pathWith('graphify')).stdout).toContain('code search now uses Grep and Glob');
    expect(cli(['code-search', dir, '--use', 'auto'], pathWith('graphify')).stdout).toContain('code search now uses graphify');

    const fresh = project();
    cli(['code-search', fresh, '--use', 'graphify'], pathWith());
    expect(JSON.parse(fs.readFileSync(path.join(fresh, 'sdlc.config.json'), 'utf8'))).toEqual({ agent: { codeSearch: 'graphify' } });
    const bad = cli(['code-search', fresh, '--use', 'nope'], pathWith());
    expect(bad.status).toBe(2);
    expect(bad.stderr).toBe('ERROR: "nope" is not a code indexer (use auto, none, graft, graphify)\n');
  });

  test('skill prints a rendered skill or exits 2', () => {
    for (const env of [pathWith('graft'), pathWith('graphify'), pathWith()]) {
      const r = cli(['skill', 'plan', both()], env);
      expect(r.status).toBe(0);
      expect(r.stdout.length).toBeGreaterThan(0);
      expect(r.stdout).not.toContain('{{CODE_SEARCH}}');
    }
    const bad = cli(['skill', 'nope']);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toMatch(/^ERROR: no skill "nope" \(skills: .*plan.*triage/);
  });
});
