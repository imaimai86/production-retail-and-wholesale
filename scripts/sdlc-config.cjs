#!/usr/bin/env node
// Project settings for the SDLC pipeline: sdlc.config.json at the project root, completed by detection and defaults.
//   node scripts/sdlc-config.cjs detect [dir] [--json]   the test suites detection finds; writes nothing
//   node scripts/sdlc-config.cjs show   [dir]            the resolved settings as JSON (file, then detection, then defaults)
//   node scripts/sdlc-config.cjs env    [dir]            the resolved settings as shell assignments (SDLC_*), for the scripts
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
  jest: /(^|[\s/;&|(=])jest([\s/;&|)]|$)/,
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

function isTypeScript(dir, root, deps) {
  if (Object.prototype.hasOwnProperty.call(deps, 'typescript')) return true;
  for (let d = dir; ; d = path.dirname(d)) {
    if (exists(path.join(d, 'tsconfig.json'))) return true;
    if (d === root || path.dirname(d) === d) return false;
  }
}

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
    if (!known.length) errors.push(`no test suite found; add "suites" to ${CONFIG_FILE}`);
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

module.exports = { CONFIG_FILE, RUNNERS, detect, detectPackage, resolve, validate, testDir, allowedTools, worktreeBase, shellEnv };

// --- CLI -------------------------------------------------------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const [cmd, dirArg] = args.filter(a => a !== '--json');
  const dir = path.resolve(dirArg || '.');
  const usage = () => { console.error('Usage: sdlc-config.cjs detect [dir] [--json] | show [dir] | env [dir]'); process.exit(2); };
  if (!['detect', 'show', 'env'].includes(cmd)) usage();
  if (!exists(dir)) { console.error(`ERROR: ${dir} does not exist`); process.exit(2); }

  if (cmd === 'detect') {
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
  }

  const { config, errors, warnings } = resolve(dir);
  for (const w of warnings) console.error(`WARNING: ${w}`);
  if (errors.length) { for (const e of errors) console.error(`ERROR: ${e}`); process.exit(1); }
  if (cmd === 'show') process.stdout.write(JSON.stringify({ ...config, testDirs: config.suites.map(testDir), allowedTools: allowedTools(config) }, null, 2) + '\n');
  else process.stdout.write(shellEnv(config));
}
