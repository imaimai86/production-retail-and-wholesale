#!/usr/bin/env node
// Project settings for the SDLC pipeline: sdlc.config.json at the project root, completed by detection and defaults.
//   node scripts/sdlc-config.cjs detect [dir] [--json]   the test suites detection finds; writes nothing
//   node scripts/sdlc-config.cjs show   [dir]            the resolved settings as JSON (file, then detection, then defaults)
//   node scripts/sdlc-config.cjs env    [dir]            the resolved settings as shell assignments (SDLC_*), for the scripts
//   node scripts/sdlc-config.cjs suggest [dir] [--json]  for a project without tests: supported test frameworks, best first; writes nothing
//   node scripts/sdlc-config.cjs init-tests [dir] [--language javascript|typescript] [--runner <name>] [--yes] [--dry-run] [--no-install]
//        set one up: shows the detected language and asks to confirm it (or --language), asks which framework (or --runner), shows the changes, asks to confirm (or --yes), then writes scripts.test,
//        a config file and an example test, installs the packages first and runs the tests once. Existing files are kept.
// Exit codes: 0 ok, 1 invalid or ambiguous settings (reasons on stderr), 2 usage.
// Node/TypeScript runners only for now: jest, vitest, mocha, node-test (node:test); generic-junit takes any command.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CONFIG_FILE = 'sdlc.config.json';
const RUNNERS = ['jest', 'vitest', 'mocha', 'node-test', 'generic-junit'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor', 'target', 'out', 'tmp', 'graft']);
const SCAN_DEPTH = 2;

// --- Detection -------------------------------------------------------------------------------------------------------

// Evidence weights: a runner's own config file beats the test script naming it, which beats a dependency entry.
const WEIGHT = { config: 3, script: 2, dependency: 1 };
const CONFIG_FILES = {
  jest: /^jest\.config\.(js|cjs|mjs|ts|cts|mts|json)$/,
  vitest: /^vitest\.(config|workspace)\.(js|cjs|mjs|ts|cts|mts)$/,
  mocha: /^\.mocharc\.(js|cjs|json|jsonc|yml|yaml)$/,
};
// A runner named as a command or by path (node_modules/mocha/bin/_mocha, node_modules/.bin/jest).
const SCRIPT_PATTERNS = {
  jest: /(^|[\s/;&|(=])jest([\s/;&|)]|$)|(^|[\s;&|(])(react-scripts|craco)\s+test\b/,
  vitest: /(^|[\s/;&|(=])vitest([\s/;&|)]|$)/,
  mocha: /(^|[\s/;&|(=])_?mocha([\s/;&|)]|$)/,
  'node-test': /(^|[\s;&|(])(node|tsx|ts-node)\s[^;&|]*--test(\s|$|=)/,
};
const PLACEHOLDER_TEST = /no test specified/;
// A test script that runs other packages' tests (found there on their own): --prefix, cd, workspaces, lerna, nx, turbo.
const DELEGATES = /--prefix\b|--dir\b|--cwd\b|(^|[\s;&|(])cd\s|--workspaces?\b|(^|\s)-w\s|(^|\s)(lerna|nx|turbo)\s/;
// Other package scripts a script runs: npm run x, npm test, pnpm x, yarn x, bun run x.
const SCRIPT_REF = /(?:^|[\s;&|(])(?:npm|pnpm|bun)\s+(?:run(?:-script)?\s+)?([\w:.-]+)|(?:^|[\s;&|(])yarn\s+(?:run\s+)?([\w:.-]+)/g;
const DEPENDENCIES = { jest: ['jest', 'ts-jest', '@jest/core'], vitest: ['vitest'], mocha: ['mocha'] };
const DEFAULT_GLOBS = {
  jest: ['**/__tests__/**/*.[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)'],
  vitest: ['**/*.{test,spec}.?(c|m)[jt]s?(x)'],
  mocha: ['test/**/*.{js,cjs,mjs,ts}'],
  'node-test': ['**/*.test.?(c|m)[jt]s', '**/*-test.?(c|m)[jt]s', '**/*_test.?(c|m)[jt]s', '**/test/**/*.?(c|m)[jt]s'],
  'generic-junit': [],
};

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const exists = file => fs.existsSync(file);
const rel = (root, dir) => path.relative(root, dir).split(path.sep).join('/') || '.';

// The package manager that owns <dir>: its lock file, looked for from <dir> up to <root>.
function packageManager(dir, root) {
  for (let d = dir; ; d = path.dirname(d)) {
    try {
      const field = readJson(path.join(d, 'package.json')).packageManager;
      if (typeof field === 'string' && /^(npm|pnpm|yarn|bun)@/.test(field)) return field.split('@')[0];
    } catch { /* no package.json here */ }
    if (exists(path.join(d, 'pnpm-lock.yaml')) || exists(path.join(d, 'pnpm-workspace.yaml'))) return 'pnpm';
    if (exists(path.join(d, 'yarn.lock'))) return 'yarn';
    if (exists(path.join(d, 'bun.lockb')) || exists(path.join(d, 'bun.lock'))) return 'bun';
    if (exists(path.join(d, 'package-lock.json'))) return 'npm';
    if (d === root || path.dirname(d) === d) return 'npm';
  }
}

// The package's own test script, run from the project root.
function scriptCommand(pm, dir) {
  if (dir === '.') return pm === 'bun' ? 'bun run test' : `${pm} test`;
  return { npm: `npm --prefix ${dir} test`, pnpm: `pnpm --dir ${dir} test`, yarn: `yarn --cwd ${dir} test`, bun: `bun run --cwd ${dir} test` }[pm];
}
// The runner itself, run from the project root, when the package has no test script for it.
function runnerCommand(runner, pm, dir) {
  const exec = { npm: 'npx', pnpm: 'pnpm exec', yarn: 'yarn', bun: 'bunx' }[pm];
  const cd = dir === '.' ? '' : `cd ${dir} && `;
  return cd + { jest: `${exec} jest`, vitest: `${exec} vitest run`, mocha: `${exec} mocha`, 'node-test': 'node --test' }[runner];
}

// What one folder with a package.json says about its tests, or null when it says nothing.
function detectPackage(dir, root) {
  let pkg;
  try { pkg = readJson(path.join(dir, 'package.json')); } catch { return null; }
  const evidence = [];
  const add = (runner, kind, reason) => evidence.push({ runner, kind, weight: WEIGHT[kind], reason });
  let files = [];
  try { files = fs.readdirSync(dir); } catch { /* unreadable */ }
  for (const [runner, re] of Object.entries(CONFIG_FILES)) {
    for (const f of files) if (re.test(f)) add(runner, 'config', `config file ${f}`);
  }
  if (pkg.jest && typeof pkg.jest === 'object') add('jest', 'config', 'package.json "jest" key');
  if (pkg.mocha && typeof pkg.mocha === 'object') add('mocha', 'config', 'package.json "mocha" key');
  const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  const hasTestScript = typeof scripts.test === 'string' && scripts.test.trim() !== '' && !PLACEHOLDER_TEST.test(scripts.test);
  const testScripts = hasTestScript ? expandScript(scripts, 'test') : [];
  for (const [runner, re] of Object.entries(SCRIPT_PATTERNS)) {
    const via = testScripts.find(n => re.test(scripts[n]));
    if (via) add(runner, 'script', `scripts.${via} runs ${runner === 'node-test' ? 'node --test' : runner}`);
  }
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  for (const [runner, names] of Object.entries(DEPENDENCIES)) {
    const hit = names.find(n => Object.prototype.hasOwnProperty.call(deps, n));
    if (hit) add(runner, 'dependency', `dependency ${hit}`);
  }
  const dirRel = rel(root, dir);
  // A test script whose runner is not recognised: reported, so the user can set the runner.
  if (!evidence.length) return hasTestScript && !testScripts.some(n => DELEGATES.test(scripts[n])) ? { dir: dirRel, name: dirRel, runner: null, candidates: [], unknown: true, evidence: [`scripts.test: ${scripts.test}`] } : null;
  // A dependency alone, with no test script, is a tool installed for others (a monorepo root), not a suite.
  if (!hasTestScript && evidence.every(e => e.kind === 'dependency')) return null;

  const scores = {};
  for (const e of evidence) scores[e.runner] = (scores[e.runner] || 0) + e.weight;
  // A runner is a candidate only with more than a bare dependency (a dependency alone can belong to a tool).
  const strong = Object.keys(scores).filter(r => evidence.some(e => e.runner === r && e.kind !== 'dependency'));
  const ranked = (strong.length ? strong : Object.keys(scores)).sort((a, b) => scores[b] - scores[a]);
  const top = ranked.filter(r => scores[r] === scores[ranked[0]]);
  const pm = packageManager(dir, root);
  const language = isTypeScript(dir, root, deps) ? 'typescript' : 'javascript';
  const result = {
    dir: dirRel, name: dirRel === '.' ? (pkg.name || path.basename(root)) : dirRel,
    runner: top.length === 1 ? top[0] : null, candidates: ranked, language, packageManager: pm,
    evidence: evidence.map(e => `${e.runner}: ${e.reason}`),
  };
  if (result.runner) {
    result.aggregates = aggregates(result.runner, pkg, dir, files);
    result.testCmd = hasTestScript ? scriptCommand(pm, dirRel) : runnerCommand(result.runner, pm, dirRel);
    result.testGlobs = packageGlobs(result.runner, pkg, dir) || DEFAULT_GLOBS[result.runner];
  }
  return result;
}

// Does this package's runner config run other packages too (jest "projects", a vitest workspace)?
function aggregates(runner, pkg, dir, files) {
  const text = re => files.filter(f => re.test(f)).some(f => {
    try { return /\bprojects\s*:|\bworkspace\s*:/.test(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return false; }
  });
  if (runner === 'jest') return Boolean(pkg.jest && pkg.jest.projects) || text(CONFIG_FILES.jest);
  if (runner === 'vitest') return files.some(f => /^vitest\.workspace\./.test(f)) || text(CONFIG_FILES.vitest);
  return false;
}

// <name> and every package script it runs, at most four levels deep.
function expandScript(scripts, name, depth = 0, seen = new Set()) {
  if (seen.has(name) || typeof scripts[name] !== 'string' || depth > 3) return [];
  seen.add(name);
  const names = [name];
  for (const m of scripts[name].matchAll(SCRIPT_REF)) names.push(...expandScript(scripts, m[1] || m[2], depth + 1, seen));
  return names;
}

// Why the package counts as TypeScript: its nearest tsconfig.json and a typescript dependency; empty for JavaScript.
function typeScriptEvidence(dir, root, deps) {
  const found = [];
  for (let d = dir; ; d = path.dirname(d)) {
    if (exists(path.join(d, 'tsconfig.json'))) { found.push(rel(root, path.join(d, 'tsconfig.json'))); break; }
    if (d === root || path.dirname(d) === d) break;
  }
  if (Object.prototype.hasOwnProperty.call(deps, 'typescript')) found.push('dependency typescript');
  return found;
}
const isTypeScript = (dir, root, deps) => typeScriptEvidence(dir, root, deps).length > 0;

// Test file patterns the package states itself (jest testMatch, mocha spec), else null.
function packageGlobs(runner, pkg, dir) {
  const strip = g => g.replace(/^<rootDir>\//, '').replace(/^\.\//, '');
  if (runner === 'jest' && pkg.jest && Array.isArray(pkg.jest.testMatch)) return pkg.jest.testMatch.map(strip);
  let spec = runner === 'mocha' && pkg.mocha ? pkg.mocha.spec : undefined;
  if (runner === 'mocha' && spec === undefined) {
    try { spec = readJson(path.join(dir, '.mocharc.json')).spec; } catch { /* none */ }
  }
  if (spec !== undefined) return (Array.isArray(spec) ? spec : [spec]).map(String).map(strip);
  return null;
}

const subdirs = dir => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name)).map(e => path.join(dir, e.name));
  } catch { return []; }
};

// The folders the root's workspaces name (package.json "workspaces", pnpm-workspace.yaml), at any depth.
function workspaceDirs(root) {
  let patterns = [];
  try {
    const ws = readJson(path.join(root, 'package.json')).workspaces;
    patterns = Array.isArray(ws) ? ws : (ws && Array.isArray(ws.packages) ? ws.packages : []);
  } catch { /* none */ }
  try {
    const yaml = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
    for (const m of yaml.matchAll(/^\s*-\s*['"]?([^'"#\n]+?)['"]?\s*$/gm)) patterns.push(m[1]);
  } catch { /* none */ }
  const out = new Set();
  const expand = (dir, parts, depth) => {
    if (!parts.length) { out.add(dir); return; }
    const [p, ...rest] = parts;
    if (p === '**') {
      expand(dir, rest, depth);
      if (depth < 6) for (const d of subdirs(dir)) expand(d, parts, depth + 1);
    } else if (/[*?]/.test(p)) {
      const re = new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
      for (const d of subdirs(dir)) if (re.test(path.basename(d))) expand(d, rest, depth + 1);
    } else if (exists(path.join(dir, p))) expand(path.join(dir, p), rest, depth + 1);
  };
  for (const p of patterns) if (typeof p === 'string' && !p.startsWith('!')) expand(root, p.replace(/^\.\//, '').split('/').filter(Boolean), 0);
  return [...out];
}

// Every folder whose package.json shows its tests: the root, up to SCAN_DEPTH levels down, and every workspace.
function detect(root) {
  root = path.resolve(root);
  const dirs = new Set();
  const walk = (dir, depth) => { dirs.add(dir); if (depth < SCAN_DEPTH) for (const d of subdirs(dir)) walk(d, depth + 1); };
  walk(root, 0);
  for (const d of workspaceDirs(root)) dirs.add(d);
  const found = [...dirs].map(d => detectPackage(d, root)).filter(Boolean)
    .sort((a, b) => (a.dir === '.' ? -1 : b.dir === '.' ? 1 : a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
  // A suite whose runner config runs its sub-packages (jest projects, vitest workspace) covers their suites of that runner.
  const inside = (outer, inner) => outer === '.' || inner.startsWith(`${outer}/`);
  for (const a of found.filter(f => f.aggregates)) {
    a.covers = found.filter(b => b !== a && b.runner === a.runner && inside(a.dir, b.dir)).map(b => b.dir);
  }
  const covered = new Set(found.flatMap(f => f.covers || []));
  return found.filter(f => !covered.has(f.dir));
}

// --- Suggestions for a project without tests -------------------------------------------------------------------------

// Files that show a project in a language not supported yet.
const OTHER_ECOSYSTEMS = [
  ['pyproject.toml', 'Python'], ['requirements.txt', 'Python'], ['setup.py', 'Python'], ['go.mod', 'Go'],
  ['Cargo.toml', 'Rust'], ['pom.xml', 'Java'], ['build.gradle', 'Java/Kotlin'], ['build.gradle.kts', 'Kotlin'],
  ['Gemfile', 'Ruby'], ['composer.json', 'PHP'],
];
const FRONTEND = ['react', 'vue', 'svelte', '@angular/core', 'solid-js', 'preact', 'lit'];
const VITE_BASED = ['vite', '@sveltejs/kit', 'nuxt', 'astro', 'vitepress'];
const BACKEND = ['express', 'fastify', 'koa', '@hapi/hapi', 'hono'];

// The lowest Node major version the project allows: engines.node, .nvmrc / .node-version, else the Node running this.
function nodeMajor(dir, pkg) {
  const first = s => { const m = String(s || '').match(/(\d+)(?:\.(\d+))?/); return m ? [Number(m[1]), Number(m[2] || 0)] : null; };
  const fromEngines = pkg.engines && first(pkg.engines.node);
  if (fromEngines) return { version: fromEngines, source: 'engines.node' };
  for (const f of ['.nvmrc', '.node-version']) {
    try { const v = first(fs.readFileSync(path.join(dir, f), 'utf8')); if (v) return { version: v, source: f }; } catch { /* none */ }
  }
  return { version: first(process.versions.node), source: 'the Node running this' };
}

// What the project is, as far as choosing a test framework goes.
function describeProject(dir, root, pkg) {
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const has = n => Object.prototype.hasOwnProperty.call(deps, n);
  let files = [];
  try { files = fs.readdirSync(dir); } catch { /* unreadable */ }
  const node = nodeMajor(dir, pkg);
  const tsEvidence = typeScriptEvidence(dir, root, deps);
  return {
    dir: rel(root, dir),
    language: tsEvidence.length ? 'typescript' : 'javascript',
    languageEvidence: tsEvidence.length ? tsEvidence : ['no tsconfig.json and no typescript dependency'],
    languageSource: 'detected',
    module: pkg.type === 'module' ? 'esm' : 'commonjs',
    packageManager: packageManager(dir, root),
    node: `${node.version[0]}.${node.version[1]} (${node.source})`,
    nodeVersion: node.version,
    vite: VITE_BASED.some(has) || files.some(f => /^vite\.config\./.test(f)),
    next: has('next'),
    nest: has('@nestjs/core'),
    frontend: FRONTEND.filter(has),
    backend: BACKEND.filter(has),
    chai: has('chai') || has('sinon'),
    srcDir: exists(path.join(dir, 'src')),
  };
}

const installCmd = (pm, deps) => !deps.length ? null
  : `${{ npm: 'npm install -D', pnpm: 'pnpm add -D', yarn: 'yarn add -D', bun: 'bun add -d' }[pm]} ${deps.join(' ')}`;

// Each supported runner, scored for this project: { runner, score, why, caveats, install, devDependencies, adds }.
function rankRunners(p) {
  const ts = p.language === 'typescript';
  const esm = p.module === 'esm';
  const stripTypes = p.nodeVersion[0] > 22 || (p.nodeVersion[0] === 22 && p.nodeVersion[1] >= 18);
  const dom = p.frontend.length > 0;
  const ext = ts ? 'ts' : 'js';
  const where = p.srcDir ? 'src' : 'test';
  const r = {
    vitest: { score: 3, why: [], caveats: [], devDependencies: ['vitest'], script: 'vitest run', configFile: null, sample: `${where}/example.test.${ext}` },
    jest: { score: 3, why: [], caveats: [], devDependencies: ['jest'], script: 'jest', configFile: 'jest.config.js', sample: `${where}/example.test.${ext}` },
    'node-test': { score: 2, why: ['built into Node: nothing to install'], caveats: [], devDependencies: [], script: 'node --test', configFile: null, sample: `test/example.test.${ext}` },
    mocha: { score: 1, why: [], caveats: [], devDependencies: ['mocha'], script: 'mocha', configFile: '.mocharc.json', sample: `test/example.test.${ext}` },
  };
  if (p.vite) { r.vitest.score += 4; r.vitest.why.push('the project uses Vite: Vitest reuses vite.config'); }
  if (p.next) { r.jest.score += 3; r.jest.why.push('Next.js ships a Jest setup (next/jest)'); r.vitest.score += 1; r.vitest.why.push('works with Next.js through @vitejs/plugin-react'); }
  if (p.nest) { r.jest.score += 4; r.jest.why.push('NestJS projects use Jest by default'); }
  if (ts) {
    r.vitest.score += 2; r.vitest.why.push('runs TypeScript with no extra setup');
    r.jest.devDependencies.push('ts-jest', '@types/jest'); r.jest.caveats.push('TypeScript needs ts-jest (added) and a jest.config.js preset');
    r.mocha.devDependencies.push('tsx'); r.mocha.caveats.push('TypeScript needs tsx (added) loaded from .mocharc.json');
    if (stripTypes) { r['node-test'].score += 1; r['node-test'].why.push(`Node ${p.nodeVersion[0]}.${p.nodeVersion[1]} runs TypeScript files directly`); }
    else { r['node-test'].score -= 1; r['node-test'].devDependencies.push('tsx'); r['node-test'].script = 'tsx --test'; r['node-test'].caveats.push(`Node ${p.nodeVersion[0]}.${p.nodeVersion[1]} cannot run TypeScript directly: needs tsx (added)`); }
  }
  if (esm) {
    r.vitest.score += 2; r.vitest.why.push('native ES modules');
    r['node-test'].score += 1; r['node-test'].why.push('native ES modules');
    r.jest.score -= 1; r.jest.caveats.push('ES modules need NODE_OPTIONS=--experimental-vm-modules');
  }
  if (dom) {
    r['node-test'].score -= 3; r['node-test'].caveats.push(`no browser DOM for ${p.frontend.join(', ')} components`);
    r.mocha.score -= 1; r.mocha.caveats.push('a DOM needs jsdom set up by hand');
    for (const k of ['vitest', 'jest']) { r[k].why.push(`component tests with jsdom and Testing Library (${p.frontend.join(', ')})`); }
    r.vitest.devDependencies.push('jsdom'); r.jest.devDependencies.push('jest-environment-jsdom');
  }
  if (p.backend.length && !dom) {
    r.jest.score += 1; r.jest.why.push(`common for ${p.backend.join(', ')} APIs, with supertest`);
    r['node-test'].score += 1; r['node-test'].why.push('enough for a server API, with no dependencies');
  }
  if (p.chai) { r.mocha.score += 2; r.mocha.why.push('the project already has chai/sinon'); }
  if (!r.mocha.why.length) r.mocha.why.push('flexible and long-established; you pick the assertion library');

  if (!r.jest.why.length) r.jest.why.push('the most widely used; mocks, snapshots and coverage built in');
  if (!r.vitest.why.length) r.vitest.why.push('fast, with the same test API as Jest');
  return Object.entries(r).map(([runner, v]) => ({
    runner, score: v.score, why: v.why, caveats: v.caveats, devDependencies: v.devDependencies,
    install: installCmd(p.packageManager, v.devDependencies),
  })).sort((a, b) => b.score - a.score || RUNNERS.indexOf(a.runner) - RUNNERS.indexOf(b.runner));
}

// Test framework suggestions for the project at <dir> (the root or one package). Writes nothing.
// status: 'has-tests' (detection already finds a suite), 'unsupported' (not a Node project), 'suggestions'.
// language: the language the user confirmed ('javascript' or 'typescript'), used instead of the detected one.
const LANGUAGES = ['javascript', 'typescript'];
function suggest(dir, root = dir, { language } = {}) {
  dir = path.resolve(dir); root = path.resolve(root);
  let pkg = null;
  try { pkg = readJson(path.join(dir, 'package.json')); } catch { /* none */ }
  if (!pkg) {
    const other = OTHER_ECOSYSTEMS.filter(([f]) => exists(path.join(dir, f)));
    return { status: 'unsupported', dir: rel(root, dir), reason: other.length
      ? `only Node/TypeScript projects are supported for now (found ${other.map(([f, l]) => `${f}: ${l}`).join(', ')})`
      : 'no package.json here; only Node/TypeScript projects are supported for now' };
  }
  const existing = (dir === root ? detect(root) : [detectPackage(dir, root)].filter(Boolean)).filter(f => f.runner);
  if (existing.length) return { status: 'has-tests', dir: rel(root, dir), existing: existing.map(f => ({ dir: f.dir, runner: f.runner })) };
  const project = describeProject(dir, root, pkg);
  if (language) Object.assign(project, { language, languageSource: 'confirmed' });
  const ranked = rankRunners(project);
  ranked[0].recommended = true;
  for (const x of ranked) { const plan = setupPlan(project, x.runner); x.adds = { script: plan.script, files: plan.files.map(f => f.path) }; }
  return { status: 'suggestions', dir: project.dir, project, suggestions: ranked };
}

// --- Setting up a test framework -------------------------------------------------------------------------------------

const SAMPLE_NOTE = 'Example test added by sdlc-config init-tests: replace it with tests for your code.';

// The files, script and packages that set up <runner> in this project. Nothing is written here.
function setupPlan(p, runner) {
  const ts = p.language === 'typescript';
  const esm = p.module === 'esm';
  const dom = p.frontend.length > 0;
  const ext = ts ? 'ts' : 'js';
  const stripTypes = p.nodeVersion[0] > 22 || (p.nodeVersion[0] === 22 && p.nodeVersion[1] >= 18);
  const ranked = rankRunners(p).find(r => r.runner === runner);
  const files = [];
  const notes = [];
  let script;
  let sample;
  const imports = (names, from) => esm || ts ? `import { ${names} } from '${from}';` : `const { ${names} } = require('${from}');`;

  if (runner === 'vitest') {
    sample = `${p.srcDir ? 'src' : 'test'}/example.test.${ext}`;
    script = 'vitest run';
    if (dom && p.vite) notes.push("add test: { environment: 'jsdom' } to your vite.config to test components");
    else if (dom) files.push({ path: `vitest.config.${ts ? 'ts' : 'mjs'}`, content: "import { defineConfig } from 'vitest/config';\n\nexport default defineConfig({\n  test: { environment: 'jsdom' },\n});\n" });
    files.push({ path: sample, content: `// ${SAMPLE_NOTE}\nimport { describe, it, expect } from 'vitest';\n\ndescribe('example', () => {\n  it('adds numbers', () => {\n    expect(1 + 1).toBe(2);\n  });\n});\n` });
  } else if (runner === 'jest') {
    sample = `${p.srcDir ? 'src' : 'test'}/example.test.${ext}`;
    script = esm ? 'node --experimental-vm-modules node_modules/jest/bin/jest.js' : 'jest';
    const conf = [
      ts ? `  preset: '${esm ? 'ts-jest/presets/default-esm' : 'ts-jest'}',` : null,
      `  testEnvironment: '${dom ? 'jsdom' : 'node'}',`,
      "  testPathIgnorePatterns: ['/node_modules/', '/dist/'],",
    ].filter(Boolean).join('\n');
    files.push({ path: 'jest.config.js', content: `/** @type {import('jest').Config} */\n${esm ? 'export default' : 'module.exports ='} {\n${conf}\n};\n` });
    files.push({ path: sample, content: `// ${SAMPLE_NOTE}\ndescribe('example', () => {\n  test('adds numbers', () => {\n    expect(1 + 1).toBe(2);\n  });\n});\n` });
  } else if (runner === 'node-test') {
    sample = `test/example.test.${ext}`;
    script = ts && !stripTypes ? 'tsx --test "test/**/*.test.ts"' : `node --test "test/**/*.test.${ext}"`;
    files.push({ path: sample, content: `// ${SAMPLE_NOTE}\n${imports('describe, it', 'node:test')}\n${esm || ts ? "import assert from 'node:assert/strict';" : "const assert = require('node:assert/strict');"}\n\ndescribe('example', () => {\n  it('adds numbers', () => {\n    assert.equal(1 + 1, 2);\n  });\n});\n` });
  } else if (runner === 'mocha') {
    sample = `test/example.test.${ext}`;
    script = 'mocha';
    files.push({ path: '.mocharc.json', content: JSON.stringify(ts ? { spec: 'test/**/*.test.ts', 'node-option': ['import=tsx'] } : { spec: `test/**/*.test.${ext}` }, null, 2) + '\n' });
    files.push({ path: sample, content: `// ${SAMPLE_NOTE}\n${esm || ts ? "import assert from 'node:assert/strict';" : "const assert = require('node:assert/strict');"}\n\ndescribe('example', () => {\n  it('adds numbers', () => {\n    assert.equal(1 + 1, 2);\n  });\n});\n` });
  }
  return { runner, script, devDependencies: ranked.devDependencies, install: ranked.install, files, notes };
}

// Set up <runner> in the Node project at <dir>: writes the files and scripts.test, installs the packages (unless
// install is false) and runs the tests once. Files that already exist are kept. Returns { ok, plan, written, skipped, steps, error }.
function provision(dir, runner, { root = dir, language, install = true, dryRun = false, run = spawnSync } = {}) {
  dir = path.resolve(dir); root = path.resolve(root);
  const s = suggest(dir, root, { language });
  if (s.status === 'unsupported') return { ok: false, error: s.reason };
  if (s.status === 'has-tests') return { ok: false, error: `tests are already set up (${s.existing.map(e => `${e.dir}: ${e.runner}`).join(', ')})` };
  if (!s.suggestions.some(x => x.runner === runner)) return { ok: false, error: `unknown framework "${runner}" (use ${s.suggestions.map(x => x.runner).join(', ')})` };
  const pkgFile = path.join(dir, 'package.json');
  const current = (JSON.parse(fs.readFileSync(pkgFile, 'utf8')).scripts || {}).test;
  if (typeof current === 'string' && current.trim() && !PLACEHOLDER_TEST.test(current)) {
    return { ok: false, error: `package.json already has a test script ("${current}"); remove it first, or add the suite to ${CONFIG_FILE} by hand` };
  }
  const plan = setupPlan(s.project, runner);
  const written = [];
  const skipped = [];
  const steps = [];
  if (dryRun) return { ok: true, plan, written, skipped, steps, dryRun: true };
  const sh = cmd => {
    const r = run('sh', ['-c', cmd], { cwd: dir, encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
    steps.push({ cmd, status: r.status, output: `${r.stdout || ''}${r.stderr || ''}`.slice(-4000) });
    return r.status === 0;
  };
  // Install first: when it fails, nothing of ours has been written.
  if (install && plan.install && !sh(plan.install)) return { ok: false, plan, written, skipped, steps, error: `installing failed: ${plan.install}` };

  for (const f of plan.files) {
    const target = path.join(dir, f.path);
    if (exists(target)) { skipped.push(f.path); continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.content);
    written.push(f.path);
  }
  const raw = fs.readFileSync(pkgFile, 'utf8');
  const pkg = JSON.parse(raw);
  const indent = (raw.match(/^[ \t]+(?=")/m) || ['  '])[0];
  pkg.scripts = { ...(pkg.scripts || {}), test: plan.script };
  fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, indent) + (raw.endsWith('\n') ? '\n' : ''));
  written.push('package.json (scripts.test)');

  if (!install) return { ok: true, plan, written, skipped, steps };
  const testCmd = s.project.packageManager === 'bun' ? 'bun run test' : `${s.project.packageManager} test`;
  if (!sh(testCmd)) return { ok: false, plan, written, skipped, steps, error: `the example test did not pass: ${testCmd}` };
  return { ok: true, plan, written, skipped, steps };
}

// --- Settings --------------------------------------------------------------------------------------------------------

const SUITE_SCHEMA = {
  name: 'string', dir: 'string', runner: [...RUNNERS, 'auto'], testCmd: 'string',
  testGlobs: 'string[]', sourceGlobs: 'string[]', setup: 'string',
};
const SCHEMA = {
  $schema: 'string',
  backlogDir: 'string',
  suites: [SUITE_SCHEMA],
  integration: { cmd: 'string', ci: ['run', 'skip'] },
  lint: 'string',
  worktree: { base: 'string', link: 'string[]' },
  git: { branchPrefix: 'string', base: 'string', conflictSuffixStart: 'integer' },
  agent: { allowCommands: 'string[]', codeSearch: ['graft', 'none', 'auto'] },
  ship: { envExample: 'boolean', maxFileBytes: 'integer' },
  ui: { timezone: 'string' },
};

// Every way <value> breaks <schema>, as "path: problem" lines.
function validate(value, schema, where, errors) {
  const at = where || '(top level)';
  if (Array.isArray(schema) && typeof schema[0] === 'object') {
    if (!Array.isArray(value)) return errors.push(`${at}: must be a list`);
    value.forEach((v, i) => validate(v, schema[0], `${where}[${i}]`, errors));
  } else if (Array.isArray(schema)) {
    if (!schema.includes(value)) errors.push(`${at}: must be one of ${schema.join(', ')} (got ${JSON.stringify(value)})`);
  } else if (schema === 'string[]') {
    if (!Array.isArray(value) || value.some(v => typeof v !== 'string' || !v)) errors.push(`${at}: must be a list of non-empty strings`);
  } else if (schema === 'integer') {
    if (!Number.isInteger(value) || value < 0) errors.push(`${at}: must be a whole number`);
  } else if (schema === 'string') {
    if (typeof value !== 'string' || !value) errors.push(`${at}: must be a non-empty string`);
  } else if (schema === 'boolean') {
    if (typeof value !== 'boolean') errors.push(`${at}: must be true or false`);
  } else {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return errors.push(`${at}: must be an object`);
    for (const k of Object.keys(value)) {
      const p = where ? `${where}.${k}` : k;
      if (!Object.prototype.hasOwnProperty.call(schema, k)) errors.push(`${p}: unknown setting`);
      else validate(value[k], schema[k], p, errors);
    }
  }
  return errors;
}

const graftOnPath = env => spawnSync('sh', ['-c', 'command -v graft'], { encoding: 'utf8', env }).status === 0;
const systemTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const validTimezone = tz => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };

// A suite from the file, completed from detection in its folder and the runner's defaults.
function completeSuite(s, i, root, errors) {
  const where = `suites[${i}]`;
  const dir = (s.dir || '.').replace(/\/+$/, '') || '.';
  const abs = path.resolve(root, dir);
  if (!exists(abs) || !fs.statSync(abs).isDirectory()) { errors.push(`${where}.dir: folder ${dir} does not exist`); return null; }
  const found = detectPackage(abs, root);
  let runner = s.runner || 'auto';
  if (runner === 'auto') {
    if (!found) { errors.push(`${where}: no test runner found in ${dir}; set "runner"`); return null; }
    if (found.unknown) { errors.push(`${where}: the test script in ${dir} uses a runner that is not recognised; set "runner"`); return null; }
    if (!found.runner) { errors.push(`${where}: ${dir} matches ${found.candidates.join(' and ')} equally; set "runner"`); return null; }
    runner = found.runner;
  }
  if (runner === 'generic-junit' && !s.testCmd) { errors.push(`${where}: runner generic-junit needs "testCmd"`); return null; }
  const pm = found ? found.packageManager : packageManager(abs, root);
  const sameRunner = found && found.runner === runner;
  let pkg = {};
  try { pkg = readJson(path.join(abs, 'package.json')); } catch { /* none */ }
  return {
    name: s.name || (dir === '.' ? path.basename(root) : dir),
    dir, runner,
    language: found ? found.language : (isTypeScript(abs, root, {}) ? 'typescript' : 'javascript'),
    packageManager: pm,
    testCmd: s.testCmd || (sameRunner ? found.testCmd : runnerCommand(runner, pm, dir)),
    testGlobs: s.testGlobs || (sameRunner ? found.testGlobs : (packageGlobs(runner, pkg, abs) || DEFAULT_GLOBS[runner])),
    sourceGlobs: s.sourceGlobs || ['**'],
    setup: s.setup || null,
  };
}

// The resolved settings for the project at <root>: { config, errors, warnings, file }. errors is empty when the settings are usable.
function resolve(root, { env = process.env } = {}) {
  root = path.resolve(root);
  const errors = [];
  const warnings = [];
  const fileName = path.join(root, CONFIG_FILE);
  let file = {};
  const hasFile = exists(fileName);
  if (hasFile) {
    try { file = readJson(fileName); } catch (e) { return { config: null, errors: [`${CONFIG_FILE}: not valid JSON (${e.message})`], warnings, file: fileName }; }
    validate(file, SCHEMA, '', errors);
    if (errors.length) return { config: null, errors: errors.map(e => `${CONFIG_FILE}: ${e}`), warnings, file: fileName };
  }

  let suites;
  if (file.suites && file.suites.length) {
    suites = file.suites.map((s, i) => completeSuite(s, i, root, errors));
  } else {
    const found = detect(root);
    const known = found.filter(f => !f.unknown);
    for (const f of found.filter(f => f.unknown)) {
      warnings.push(`${f.dir}: skipped, its test script uses a runner that is not recognised (${f.evidence[0]}); add it to "suites" with a "runner"`);
    }
    if (!known.length) errors.push(`no test suite found; add "suites" to ${CONFIG_FILE}, or see suggestions with: node scripts/sdlc-config.cjs suggest`);
    for (const f of known) {
      if (!f.runner) errors.push(`${f.dir} matches ${f.candidates.join(' and ')} equally; set its "runner" in ${CONFIG_FILE}`);
    }
    suites = known.filter(f => f.runner).map((f, i) => completeSuite({ dir: f.dir, runner: f.runner, name: f.name }, i, root, errors));
  }
  suites = suites.filter(Boolean);
  const names = suites.map(s => s.name);
  for (const n of names.filter((n, i) => names.indexOf(n) !== i)) errors.push(`suite name "${n}" is used twice`);

  const ui = { timezone: (file.ui && file.ui.timezone) || systemTimezone() };
  if (!validTimezone(ui.timezone)) errors.push(`ui.timezone: unknown time zone "${ui.timezone}"`);
  const codeSearch = (file.agent && file.agent.codeSearch) || 'auto';
  const defaultLinks = [...new Set([...suites.map(s => s.dir === '.' ? 'node_modules' : `${s.dir}/node_modules`), 'node_modules'])];

  const config = {
    root,
    backlogDir: (file.backlogDir || 'Docs/backlog').replace(/\/+$/, ''),
    suites,
    integration: file.integration ? { cmd: file.integration.cmd || null, ci: file.integration.ci || 'skip' } : null,
    lint: file.lint || null,
    worktree: {
      base: (file.worktree && file.worktree.base) || '../{repo}-sdlc',
      link: (file.worktree && file.worktree.link) || defaultLinks,
    },
    git: {
      branchPrefix: (file.git && file.git.branchPrefix) || 'sdlc/',
      base: (file.git && file.git.base) || null,
      conflictSuffixStart: (file.git && file.git.conflictSuffixStart) || 10001,
    },
    agent: {
      allowCommands: (file.agent && file.agent.allowCommands) || [],
      codeSearch: codeSearch === 'auto' ? (graftOnPath(env) ? 'graft' : 'none') : codeSearch,
    },
    ship: {
      envExample: file.ship && typeof file.ship.envExample === 'boolean' ? file.ship.envExample : true,
      maxFileBytes: (file.ship && file.ship.maxFileBytes) || 1024 * 1024,
    },
    ui,
  };
  if (config.integration && !config.integration.cmd) errors.push('integration.cmd: must be set when "integration" is present');
  return { config: errors.length ? null : config, errors, warnings, file: hasFile ? fileName : null };
}

// --- Derived values --------------------------------------------------------------------------------------------------

// The fixed folder in front of a suite's test globs (server/__tests__ for "__tests__/**" in server), or the suite folder.
function testDir(suite) {
  const prefixes = suite.testGlobs.map(g => {
    const parts = g.split('/');
    const fixed = [];
    for (const p of parts.slice(0, -1)) { if (/[*?[\]{}()!+@]/.test(p)) break; fixed.push(p); }
    return fixed;
  });
  let common = prefixes[0] || [];
  for (const p of prefixes) { let i = 0; while (i < common.length && common[i] === p[i]) i++; common = common.slice(0, i); }
  const parts = [suite.dir === '.' ? '' : suite.dir, ...common].filter(Boolean);
  return parts.join('/') || '.';
}

// The tools every stage agent may use: file tools, code search, the test and lint commands, extra commands, read-only git.
function allowedTools(config) {
  const graft = config.agent.codeSearch === 'graft';
  const bash = cmd => `Bash(${cmd}:*)`;
  return [...new Set([
    'Read', 'Write', 'Edit', 'Glob', 'Grep',
    ...(graft ? ['mcp__graft'] : []),
    ...config.suites.map(s => bash(s.testCmd)),
    ...(config.lint ? [bash(config.lint)] : []),
    ...config.agent.allowCommands.map(bash),
    ...(graft ? [bash('graft')] : []),
    bash('ls'), bash('git status'), bash('git diff'), bash('git log'),
  ])];
}

const worktreeBase = config =>
  path.resolve(config.root, config.worktree.base.replace(/\{repo\}/g, path.basename(config.root)));

const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
const arr = list => `(${list.map(q).join(' ')})`;

// Shell assignments for the scripts: eval "$(node scripts/sdlc-config.cjs env)".
function shellEnv(config) {
  const lines = {
    SDLC_ROOT: q(config.root),
    SDLC_BACKLOG_DIR: q(config.backlogDir),
    SDLC_BACKLOG: q(`${config.backlogDir}/index.md`),
    SDLC_TEST_CMD: q(config.suites.map(s => s.testCmd).join(' && ')),
    SDLC_TEST_DIR: q(testDir(config.suites[0])),
    SDLC_TEST_DIRS: arr(config.suites.map(testDir)),
    SDLC_SUITE_DIRS: arr(config.suites.map(s => s.dir)),
    SDLC_RUNNERS: arr(config.suites.map(s => s.runner)),
    SDLC_INTEGRATION_CMD: q(config.integration ? config.integration.cmd : ''),
    SDLC_INTEGRATION_CI: q(config.integration ? config.integration.ci : 'skip'),
    SDLC_LINT_CMD: q(config.lint || ''),
    SDLC_BRANCH_PREFIX: q(config.git.branchPrefix),
    SDLC_GIT_BASE: q(config.git.base || ''),
    SDLC_CONFLICT_SUFFIX_START: q(config.git.conflictSuffixStart),
    SDLC_WT_BASE_DEFAULT: q(worktreeBase(config)),
    SDLC_WT_LINKS: arr(config.worktree.link),
    SDLC_ALLOWED: arr(allowedTools(config)),
    SDLC_CODE_SEARCH: q(config.agent.codeSearch),
    SDLC_SHIP_ENV_EXAMPLE: q(config.ship.envExample ? 1 : 0),
    SDLC_SHIP_MAX_BYTES: q(config.ship.maxFileBytes),
    SDLC_TIMEZONE: q(config.ui.timezone),
  };
  return Object.entries(lines).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
}

module.exports = { CONFIG_FILE, RUNNERS, detect, detectPackage, suggest, setupPlan, provision, resolve, validate, testDir, allowedTools, worktreeBase, shellEnv };

// The project root for <dir>: the top of its git work tree, else <dir> itself.
function findRoot(dir) {
  const r = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : dir;
}

// --- CLI -------------------------------------------------------------------------------------------------------------

const where = d => (d === '.' ? 'the project root' : d);
const LANGUAGE_NAMES = { javascript: 'JavaScript', typescript: 'TypeScript' };
const languageLine = p => p.languageSource === 'confirmed'
  ? `Language: ${LANGUAGE_NAMES[p.language]} (confirmed)`
  : `Detected language: ${LANGUAGE_NAMES[p.language]} (${p.languageEvidence.join(', ')})`;

function printSuggestions(s) {
  const p = s.project;
  const uses = [p.vite && 'Vite', p.next && 'Next.js', p.nest && 'NestJS', ...p.frontend, ...p.backend].filter(Boolean);
  console.log(`Project (${where(p.dir)}): ${p.module === 'esm' ? 'ES modules' : 'CommonJS'}, Node ${p.node}, ${p.packageManager}${uses.length ? `; uses ${uses.join(', ')}` : ''}.`);
  console.log(`Supported test frameworks for ${LANGUAGE_NAMES[p.language]}, best first:`);
  s.suggestions.forEach((x, i) => {
    console.log(`\n${i + 1}. ${x.runner}${x.recommended ? ' (recommended)' : ''}`);
    for (const w of x.why) console.log(`   + ${w}`);
    for (const c of x.caveats) console.log(`   - ${c}`);
    console.log(`   install: ${x.install || 'nothing'}`);
    console.log(`   adds:    scripts.test ${JSON.stringify(x.adds.script)}, ${x.adds.files.join(', ')}`);
  });
}

function printPlan(plan, dir) {
  console.log(`\nSetting up ${plan.runner} in ${dir}:`);
  console.log(`  package.json  scripts.test = ${JSON.stringify(plan.script)}`);
  for (const f of plan.files) console.log(`  ${f.path}${exists(path.join(dir, f.path)) ? '  (exists, kept as it is)' : ''}`);
  console.log(`  install       ${plan.install || 'nothing'}`);
  for (const n of plan.notes) console.log(`  note: ${n}`);
}

function ask(question) {
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(question, a => { rl.close(); res(a.trim()); }));
}

async function initTests(dir, opts) {
  const root = findRoot(dir);
  let s = suggest(dir, root, { language: opts.language });
  if (s.status !== 'suggestions') {
    console.error(`ERROR: ${s.status === 'unsupported' ? s.reason : `tests are already set up (${s.existing.map(e => `${e.dir}: ${e.runner}`).join(', ')})`}`);
    return 1;
  }
  // 1. The language: confirmed with --language, at the prompt, or (with --yes) taken as detected.
  console.log(`No tests found in ${where(s.project.dir)}.\n${languageLine(s.project)}`);
  let language = opts.language;
  if (!language) {
    if (opts.yes) language = s.project.language;
    else if (!process.stdin.isTTY) { console.error('\nERROR: confirm the language with --language javascript|typescript'); return 2; }
    else {
      const a = (await ask('Is this right? [Enter = yes, or type javascript / typescript]: ')).toLowerCase();
      language = a === '' || /^y(es)?$/.test(a) ? s.project.language : LANGUAGES.find(l => l === a || l.slice(0, 2) === a.slice(0, 2) && a.length <= 2);
      if (!language) { console.error(`ERROR: unknown language "${a}"`); return 2; }
    }
    s = suggest(dir, root, { language });
  }
  console.log('');
  // 2. The framework, from the suggestions for that language.
  let runner = opts.runner;
  if (!runner) {
    printSuggestions(s);
    if (!process.stdin.isTTY) { console.error('\nERROR: pick one with --runner <name>'); return 2; }
    const a = await ask(`\nPick a framework [1-${s.suggestions.length}, Enter = 1]: `);
    const pick = s.suggestions[(a === '' ? 1 : Number(a)) - 1] || s.suggestions.find(x => x.runner === a);
    if (!pick) { console.error(`ERROR: no framework "${a}"`); return 2; }
    runner = pick.runner;
  }
  const pre = provision(dir, runner, { root, language, dryRun: true });
  if (!pre.ok) { console.error(`ERROR: ${pre.error}`); return 1; }
  printPlan(pre.plan, dir);
  if (opts.dryRun) { console.log('\nDry run: nothing was changed.'); return 0; }
  if (!opts.yes) {
    if (!process.stdin.isTTY) { console.error('\nERROR: confirm with --yes'); return 2; }
    if (!/^y(es)?$/i.test(await ask('\nApply these changes? [y/N]: '))) { console.log('Nothing was changed.'); return 0; }
  }
  const r = provision(dir, runner, { root, language, install: opts.install });
  for (const st of r.steps || []) console.log(`\n$ ${st.cmd}  (exit ${st.status})${st.status ? `\n${st.output}` : ''}`);
  if (r.written && r.written.length) console.log(`\nWritten: ${r.written.join(', ')}`);
  if (r.skipped && r.skipped.length) console.log(`Kept (already there): ${r.skipped.join(', ')}`);
  if (!r.ok) { console.error(`ERROR: ${r.error}`); return 1; }
  console.log(opts.install ? `\n${runner} is set up and the example test passes.` : `\n${runner} is set up. Install the packages with: ${r.plan.install || 'nothing to install'}`);
  return 0;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const flag = f => args.includes(f);
  const valueOf = name => { const i = args.indexOf(name); return i >= 0 ? (args[i + 1] || '') : undefined; };
  const valueAt = new Set(['--runner', '--language'].map(n => args.indexOf(n)).filter(i => i >= 0).map(i => i + 1));
  const runnerArg = valueOf('--runner');
  const languageArg = valueOf('--language');
  const [cmd, dirArg] = args.filter((a, i) => !a.startsWith('--') && !valueAt.has(i));
  const json = flag('--json');
  const dir = path.resolve(dirArg || '.');
  const usage = () => {
    console.error('Usage: sdlc-config.cjs detect [dir] [--json] | show [dir] | env [dir] | suggest [dir] [--json]\n'
      + '       sdlc-config.cjs init-tests [dir] [--language javascript|typescript] [--runner <name>] [--yes] [--dry-run] [--no-install]');
    process.exit(2);
  };
  if (!['detect', 'show', 'env', 'suggest', 'init-tests'].includes(cmd) || runnerArg === '' || (languageArg !== undefined && !LANGUAGES.includes(languageArg))) usage();
  if (!exists(dir)) { console.error(`ERROR: ${dir} does not exist`); process.exit(2); }

  if (cmd === 'init-tests') {
    initTests(dir, { runner: runnerArg, language: languageArg, yes: flag('--yes'), dryRun: flag('--dry-run'), install: !flag('--no-install') }).then(code => process.exit(code));
  } else if (cmd === 'suggest') {
    const s = suggest(dir, findRoot(dir), { language: languageArg });
    if (json) process.stdout.write(JSON.stringify(s, null, 2) + '\n');
    else if (s.status === 'unsupported') console.log(`${s.dir}: ${s.reason}`);
    else if (s.status === 'has-tests') console.log(`${s.dir}: tests are already set up (${s.existing.map(e => `${e.dir}: ${e.runner}`).join(', ')})`);
    else { console.log(`No tests found in ${where(s.project.dir)}.\n${languageLine(s.project)}${languageArg ? '' : ' (correct it with --language)'}\n`); printSuggestions(s); console.log(`\nSet one up with: node scripts/sdlc-config.cjs init-tests ${dirArg || '.'} --runner <name>`); }
    process.exit(s.status === 'unsupported' ? 1 : 0);
  } else if (cmd === 'detect') {
    const found = detect(dir);
    if (json) process.stdout.write(JSON.stringify(found, null, 2) + '\n');
    else if (!found.length) console.log('No test suite found.');
    else {
      for (const f of found) {
        if (f.unknown) { console.log(`${f.dir}: test runner not recognised (set it in ${CONFIG_FILE})\n  evidence:     ${f.evidence[0]}`); continue; }
        console.log(`${f.dir}: ${f.runner || `ambiguous (${f.candidates.join(', ')})`} · ${f.language} · ${f.packageManager}`);
        if (f.runner) console.log(`  test command: ${f.testCmd}\n  test files:   ${f.testGlobs.join(', ')}`);
        if (f.covers && f.covers.length) console.log(`  also runs:    ${f.covers.join(', ')}`);
        console.log(`  evidence:     ${f.evidence.join('; ')}`);
      }
    }
    process.exit(found.some(f => !f.runner && !f.unknown) ? 1 : 0);
  } else {
    const { config, errors, warnings } = resolve(dir);
    for (const w of warnings) console.error(`WARNING: ${w}`);
    if (errors.length) { for (const e of errors) console.error(`ERROR: ${e}`); process.exit(1); }
    if (cmd === 'show') process.stdout.write(JSON.stringify({ ...config, testDirs: config.suites.map(testDir), allowedTools: allowedTools(config) }, null, 2) + '\n');
    else process.stdout.write(shellEnv(config));
  }
}
