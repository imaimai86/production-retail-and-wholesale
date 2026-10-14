#!/usr/bin/env node
// Test runner adapters for the SDLC pipeline: run a suite (or some of its files and tests) and report the outcome in one
// shape, whatever the runner (jest, vitest, mocha, node:test, or any command writing a JUnit XML report).
//   node scripts/sdlc-runners.cjs run   [dir] --out <result.json> [--suite <name>] [--cwd <root>] [--file <f>]... [--test <full name>]...
//        without --suite every suite runs (with --file, only those holding the files) and the results are merged
//   node scripts/sdlc-runners.cjs parse <runner> <report> [--root <dir>] [--stderr <file>]   convert a runner's own report
// The result (RunResult):
//   { runner, suite, ok, exitCode, command, tests: [{ file, name, status, message }], suiteErrors: [{ file, message }] }
//   file: relative to the project root; name: describe titles and test title joined by spaces;
//   status: passed | failed | skipped; suiteErrors: test files that failed to load (file may be null when unknown).
// run exits 0 when everything passed, 1 when a test or file failed, 3 when the runner gave no report.
const fs = require('fs');
const os = require('os');
const path = require('path');
const url = require('url');
const { spawnSync } = require('child_process');
const config = require('./sdlc-config.cjs');

const REPORTER = path.join(__dirname, 'sdlc-node-test-reporter.mjs');
const posix = p => p.split(path.sep).join('/');
const realpath = p => { try { return fs.realpathSync(p); } catch { return p; } };
// <file> relative to <root>; runners may report the resolved path of a root reached through a symlink (macOS /var -> /private/var).
const relTo = (root, file) => {
  if (!file) return null;
  const abs = path.resolve(root, file);
  let r = path.relative(root, abs);
  if (r.startsWith('..')) { const alt = path.relative(realpath(root), realpath(abs)); if (!alt.startsWith('..')) r = alt; }
  return posix(r);
};
// JSON with // and /* */ comments (outside strings) removed.
function stripJsonComments(text) {
  let out = ''; let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) { out += c; if (c === '\\') out += text[++i] || ''; else if (c === '"') inString = false; }
    else if (c === '"') { inString = true; out += c; }
    else if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; }
    else if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2); if (i < 0) break; i++; }
    else out += c;
  }
  return out;
}
const norm = s => String(s || '').replace(/\s*›\s*/g, ' ').replace(/\s+/g, ' ').trim();
const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
const STATUS = { passed: 'passed', failed: 'failed', pending: 'skipped', skipped: 'skipped', todo: 'skipped', disabled: 'skipped', focused: 'passed' };

// --- Parsers: a runner's own report -> RunResult parts -------------------------------------------------------------

// Jest --json and Vitest --reporter=json share this shape (testResults[].assertionResults[]).
function parseJestLike(report, { root }) {
  const tests = [];
  const suiteErrors = [];
  for (const f of report.testResults || []) {
    const file = relTo(root, f.name);
    const list = f.assertionResults || [];
    if (!list.length && f.status === 'failed') suiteErrors.push({ file, message: String(f.message || 'test file failed to run').trim().slice(0, 4000) });
    for (const a of list) {
      tests.push({ file, name: norm(a.fullName || [...(a.ancestorTitles || []), a.title].join(' ')), status: STATUS[a.status] || 'failed',
        message: a.status === 'failed' ? String((a.failureMessages || [])[0] || '').slice(0, 4000) : null });
    }
  }
  return { tests, suiteErrors };
}

// Mocha --reporter json: tests[] (with err for failures), pending[], failures[] (hook failures are not in tests[]).
function parseMocha(report, { root }) {
  const key = t => `${t.file}\0${t.fullTitle}`;
  const pending = new Set((report.pending || []).map(key));
  const failed = new Map((report.failures || []).map(t => [key(t), t]));
  const tests = (report.tests || []).map(t => ({
    file: relTo(root, t.file), name: norm(t.fullTitle),
    status: pending.has(key(t)) ? 'skipped' : failed.has(key(t)) ? 'failed' : 'passed',
    message: failed.has(key(t)) ? String((t.err && t.err.message) || '').slice(0, 4000) : null,
  }));
  const inTests = new Set((report.tests || []).map(key));
  const suiteErrors = (report.failures || []).filter(t => !inTests.has(key(t)))
    .map(t => ({ file: relTo(root, t.file), message: `${norm(t.fullTitle)}: ${(t.err && t.err.message) || ''}`.slice(0, 4000) }));
  return { tests, suiteErrors };
}

// A Mocha run that stopped while loading a file prints the error and its stack: the first test file in it is the culprit.
function mochaCrashFile(stderr, root) {
  for (const m of String(stderr || '').matchAll(/(?:\(|\s)((?:\/|[A-Za-z]:\\)[^\s():]+?\.[cm]?[jt]sx?):\d+:\d+/g)) {
    const file = relTo(root, m[1]);
    if (!file.startsWith('..') && !file.includes('node_modules/')) return file;
  }
  return null;
}

// scripts/sdlc-node-test-reporter.mjs lines. Describe blocks and tests with subtests are containers, not tests.
function parseNodeTest(text, { root, cwd = root }) {
  const tests = [];
  const suiteErrors = [];
  const files = new Map();
  const state = file => { if (!files.has(file)) files.set(file, { names: [], hasChild: [] }); return files.get(file); };
  for (const line of String(text || '').split('\n')) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    // Node 18 names an ES module test file by its file: URL
    if (typeof e.file === 'string' && e.file.startsWith('file:')) { try { e.file = url.fileURLToPath(e.file); } catch { /* keep it */ } }
    if (typeof e.name === 'string' && e.name.startsWith('file:')) { try { e.name = url.fileURLToPath(e.name); } catch { /* keep it */ } }
    const s = state(e.file);
    const n = e.nesting || 0;
    if (e.event === 'start') { s.names[n] = e.name; s.names.length = n + 1; s.hasChild[n] = false; continue; }
    if (n > 0) s.hasChild[n - 1] = true;
    const file = relTo(root, e.file);
    // A file that failed to load is reported as one failed test named after the file.
    if (n === 0 && e.event === 'fail' && e.file && e.name && path.resolve(cwd, e.name) === path.resolve(e.file)) {
      suiteErrors.push({ file, message: String(e.message || 'test file failed to run').slice(0, 4000) });
      continue;
    }
    if (e.suite || s.hasChild[n] || e.failureType === 'subtestsFailed') continue;
    tests.push({ file, name: norm([...s.names.slice(0, n), e.name].join(' ')),
      status: e.skip || e.todo ? 'skipped' : e.event === 'pass' ? 'passed' : 'failed', message: e.event === 'fail' ? e.message : null });
  }
  return { tests, suiteErrors };
}

const xmlText = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, c) => String.fromCharCode(c)).replace(/&amp;/g, '&');
const attrs = s => Object.fromEntries([...s.matchAll(/([\w:.-]+)="([^"]*)"/g)].map(m => [m[1], xmlText(m[2])]));
const looksLikePath = s => /[/\\]|\.[cm]?[jt]sx?$/.test(s || '');

// JUnit XML (any runner): nested <testsuite> names that are not file paths prefix the <testcase> name.
function parseJUnit(xml, { root }) {
  const tests = [];
  const suiteErrors = [];
  const suites = [];
  let current = null;
  for (const m of String(xml || '').matchAll(/<(\/?)(testsuite|testcase|failure|error|skipped)\b([^>]*?)(\/?)>/g)) {
    const [, close, tag, rawAttrs, selfClose] = m;
    if (tag === 'testsuite') {
      if (close) suites.pop(); else if (!selfClose) suites.push(attrs(rawAttrs));
    } else if (tag === 'testcase') {
      if (close) { current = null; continue; }
      const a = attrs(rawAttrs);
      const prefix = suites.map(x => x.name).filter(n => n && !looksLikePath(n));
      const classname = a.classname && !looksLikePath(a.classname) && a.classname !== a.name ? a.classname : null;
      const name = classname && classname.endsWith(a.name) ? classname : [...prefix, a.name].join(' ');
      const fileAttr = a.file || (suites.find(x => x.file) || {}).file || (looksLikePath(a.classname) ? a.classname : null)
        || (suites.map(x => x.name).find(looksLikePath) || null);
      current = { file: relTo(root, fileAttr), name: norm(name), status: 'passed', message: null };
      tests.push(current);
      if (selfClose) current = null;
    } else if (current && !close) {
      if (tag === 'skipped') current.status = 'skipped';
      else { current.status = 'failed'; current.message = (attrs(rawAttrs).message || '').slice(0, 4000); }
    }
  }
  return { tests, suiteErrors };
}

// --- Test files ------------------------------------------------------------------------------------------------------

const { globToRegex } = config;

// Test files of a suite, relative to the project root, found by its testGlobs (node_modules and dot folders skipped).
function suiteFiles(root, suite) {
  const base = path.join(root, suite.dir);
  const res = suite.testGlobs.map(g => new RegExp(globToRegex(g.replace(/^\.\//, ''))));
  const out = [];
  const walk = dir => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (res.some(r => r.test(posix(path.relative(base, p))))) out.push(posix(path.relative(root, p)));
    }
  };
  walk(base);
  return out.sort();
}

// The project's Mocha settings (.mocharc.* in <dir>, under its package.json "mocha" key) without "spec": Mocha adds files
// named on the command line to the configured spec instead of replacing it, so a narrowed run needs a spec-less config.
function mochaConfigWithoutSpec(dir) {
  const read = f => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return null; } };
  let pkg = {};
  try { pkg = JSON.parse(read('package.json') || '{}').mocha || {}; } catch { /* none */ }
  let rc = {};
  for (const f of ['.mocharc.cjs', '.mocharc.js', '.mocharc.yaml', '.mocharc.yml', '.mocharc.jsonc', '.mocharc.json']) {
    const text = read(f);
    if (text === null) continue;
    try {
      if (/\.c?js$/.test(f)) { const file = path.join(dir, f); delete require.cache[file]; rc = require(file); }
      else if (/\.ya?ml$/.test(f)) rc = simpleYaml(text);
      else rc = JSON.parse(stripJsonComments(text));
    } catch { rc = {}; }
    break;
  }
  const merged = { ...pkg, ...rc };
  delete merged.spec;
  return merged;
}
// Flat YAML: "key: value" and "key:" followed by "- item" lines (what .mocharc.yml files hold).
function simpleYaml(text) {
  const out = {};
  let list = null;
  for (const line of text.split('\n')) {
    const item = line.match(/^\s+-\s+(.+?)\s*$/);
    const kv = line.match(/^([\w-]+):\s*(.*?)\s*$/);
    const scalar = v => { const u = v.replace(/^['"]|['"]$/g, ''); return u === 'true' ? true : u === 'false' ? false : /^\d+$/.test(u) ? Number(u) : u; };
    if (item && list) out[list].push(scalar(item[1]));
    else if (kv) { list = kv[2] === '' ? kv[1] : null; out[kv[1]] = kv[2] === '' ? [] : scalar(kv[2]); }
  }
  return out;
}

// --- Running ---------------------------------------------------------------------------------------------------------

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const namePattern = names => `^(?:${names.map(escapeRe).join('|')})$`;
const EXEC = { npm: 'npx', pnpm: 'pnpm exec', yarn: 'yarn', bun: 'bunx' };

// Run <suite> (from sdlc-config resolve) at <root>; files (relative to the root) and names narrow the run.
// root may be another checkout of the project (a worktree at an older commit). Returns a RunResult.
function run(suite, { root, files = [], names = [], spawn = spawnSync, env = process.env } = {}) {
  root = realpath(path.resolve(root));
  const cwd = path.join(root, suite.dir);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-run-'));
  const out = path.join(tmp, 'report');
  const inSuite = files.map(f => q(posix(path.relative(cwd, path.resolve(root, f)))));
  const exec = EXEC[suite.packageManager] || 'npx';
  const sh = (command, where = cwd, extraEnv = {}) => {
    const r = spawn('sh', ['-c', command], { cwd: where, encoding: 'utf8', env: { ...env, ...extraEnv }, maxBuffer: 256 * 1024 * 1024 });
    return { status: r.status === null ? 1 : r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
  };
  const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
  const result = (command, exitCode, parts, extra = {}) => {
    fs.rmSync(tmp, { recursive: true, force: true });
    const { tests, suiteErrors } = parts;
    const narrowed = files.length ? new Set(files.map(f => relTo(root, f))) : null;
    const keep = t => !narrowed || narrowed.has(t.file);
    const kept = { tests: tests.filter(keep), suiteErrors: suiteErrors.filter(e => !narrowed || !e.file || narrowed.has(e.file)) };
    const ok = exitCode === 0 && !kept.suiteErrors.length && !kept.tests.some(t => t.status === 'failed');
    return { runner: suite.runner, suite: suite.name, ok, exitCode, command, ...kept, ...extra };
  };
  const noReport = (command, r) => result(command, r.status, { tests: [], suiteErrors: [{ file: null, message: `${r.stdout}${r.stderr}`.trim().slice(-4000) || 'no report' }] }, { noReport: true });

  if (suite.runner === 'jest' || suite.runner === 'vitest') {
    const t = names.length ? ` -t ${q(namePattern(names))}` : '';
    const command = suite.runner === 'jest'
      ? `${exec} jest --json --outputFile=${q(out)}${inSuite.length ? ` ${inSuite.join(' ')}` : ''}${t}`
      : `${exec} vitest run --reporter=json --outputFile=${q(out)}${inSuite.length ? ` ${inSuite.join(' ')}` : ''}${t}`;
    const r = sh(command);
    const report = read(out);
    if (!report) return noReport(command, r);
    return result(command, r.status, parseJestLike(JSON.parse(report), { root }));
  }

  if (suite.runner === 'mocha') {
    const grep = names.length ? ` --grep ${q(namePattern(names))}` : '';
    const rc = path.join(tmp, 'mocharc.json');
    fs.writeFileSync(rc, JSON.stringify(mochaConfigWithoutSpec(cwd)));
    const mocha = list => `${exec} mocha --reporter json --reporter-option output=${q(out)}${list.length ? ` --config ${q(rc)} --no-package ${list.join(' ')}` : ''}${grep}`;
    const command = mocha(inSuite);
    const r = sh(command);
    const report = read(out);
    if (report) return result(command, r.status, parseMocha(JSON.parse(report), { root }));
    // Mocha stops the whole run when one file fails to load: run the files one by one so the others still report.
    const broken = mochaCrashFile(r.stderr, root);
    if (!broken) return noReport(command, r);
    const parts = { tests: [], suiteErrors: [] };
    let exitCode = 0;
    for (const f of files.length ? files.map(f => relTo(root, f)) : suiteFiles(root, suite)) {
      fs.rmSync(out, { force: true });
      const one = sh(mocha([q(posix(path.relative(cwd, path.join(root, f))))]));
      const rep = read(out);
      if (one.status) exitCode = one.status;
      if (rep) { const p = parseMocha(JSON.parse(rep), { root }); parts.tests.push(...p.tests.filter(t => t.file === f)); parts.suiteErrors.push(...p.suiteErrors); }
      else parts.suiteErrors.push({ file: mochaCrashFile(one.stderr, root) || f, message: one.stderr.trim().slice(-4000) });
    }
    return result(`${command}  (then file by file: ${broken} failed to load)`, exitCode || 1, parts);
  }

  if (suite.runner === 'node-test') {
    // The whole suite runs the project's own test command; the reporter is added through NODE_OPTIONS.
    const nodeOptions = `${env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ` : ''}--test-reporter=${REPORTER} --test-reporter-destination=${out}`;
    const tsx = /\btsx\s[^;&|]*--test/.test(suite.testCmd);
    const command = files.length ? `${tsx ? `${exec} tsx` : 'node'} --test ${inSuite.join(' ')}` : suite.testCmd;
    const r = sh(command, files.length ? cwd : root, { NODE_OPTIONS: nodeOptions });
    const report = read(out);
    if (!report) return noReport(command, r);
    // node:test cannot pick tests by full name on every Node version: a narrowed run re-runs whole files.
    return result(command, r.status, parseNodeTest(report, { root, cwd: files.length ? cwd : root }));
  }

  if (suite.runner === 'generic-junit') {
    const command = suite.testCmd;
    const r = sh(command, root);
    const report = read(path.resolve(root, suite.report));
    if (!report) return noReport(command, r);
    return result(command, r.status, parseJUnit(report, { root }));
  }
  throw new Error(`no adapter for runner ${suite.runner}`);
}

module.exports = { parseJestLike, parseMocha, mochaCrashFile, mochaConfigWithoutSpec, simpleYaml, parseNodeTest, parseJUnit, globToRegex, suiteFiles, run, REPORTER };

// --- CLI -------------------------------------------------------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);
  const many = name => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
  const one = name => many(name)[0];
  const valued = new Set(['--out', '--suite', '--cwd', '--file', '--test', '--root', '--stderr']);
  const positional = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]));
  const usage = () => {
    console.error('Usage: sdlc-runners.cjs run [dir] --out <result.json> [--suite <name>] [--cwd <root>] [--file <f>]... [--test <name>]...\n'
      + '       sdlc-runners.cjs parse jest|vitest|mocha|node-test|junit <report> [--root <dir>] [--stderr <file>]');
    process.exit(2);
  };
  const [cmd] = positional;

  if (cmd === 'parse') {
    const [, runner, file] = positional;
    if (!runner || !file) usage();
    const root = path.resolve(one('--root') || '.');
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    let parts;
    if (runner === 'jest' || runner === 'vitest') parts = parseJestLike(JSON.parse(text), { root });
    else if (runner === 'mocha') {
      if (text) parts = parseMocha(JSON.parse(text), { root });
      else { const err = one('--stderr') ? fs.readFileSync(one('--stderr'), 'utf8') : ''; parts = { tests: [], suiteErrors: [{ file: mochaCrashFile(err, root), message: err.trim().slice(-4000) }] }; }
    } else if (runner === 'node-test') parts = parseNodeTest(text, { root });
    else if (runner === 'junit') parts = parseJUnit(text, { root });
    else usage();
    process.stdout.write(JSON.stringify({ runner, ...parts }, null, 2) + '\n');
  } else if (cmd === 'run') {
    const out = one('--out');
    if (!out) usage();
    const dir = path.resolve(positional[1] || '.');
    const { config: cfg, errors } = config.resolve(dir);
    if (errors.length) { for (const e of errors) console.error(`ERROR: ${e}`); process.exit(2); }
    const wanted = one('--suite');
    const files = many('--file');
    // Without --suite: every suite (with --file, those holding the files), their results merged into one.
    const holds = (suite, f) => suite.dir === '.' || f === suite.dir || f.startsWith(`${suite.dir}/`);
    const suites = wanted ? cfg.suites.filter(s => s.name === wanted) : cfg.suites.filter(s => !files.length || files.some(f => holds(s, f)));
    if (!suites.length) { console.error(`ERROR: no suite ${wanted ? `"${wanted}"` : `holds ${files.join(', ')}`} (suites: ${cfg.suites.map(s => `${s.name} in ${s.dir}`).join(', ')})`); process.exit(2); }
    const results = suites.map(suite => run(suite, { root: one('--cwd') || dir, files: files.filter(f => holds(suite, f)), names: many('--test') }));
    const r = results.length === 1 ? results[0] : {
      runner: results.map(x => x.runner).join('+'), suite: results.map(x => x.suite).join('+'), ok: results.every(x => x.ok),
      exitCode: results.find(x => x.exitCode) ? results.find(x => x.exitCode).exitCode : 0, command: results.map(x => x.command).join(' ; '),
      tests: results.flatMap(x => x.tests), suiteErrors: results.flatMap(x => x.suiteErrors), noReport: results.some(x => x.noReport) || undefined,
    };
    fs.writeFileSync(out, JSON.stringify(r) + '\n');
    for (const x of results) {
      const count = st => x.tests.filter(t => t.status === st).length;
      console.log(`${x.suite} (${x.runner}): ${count('passed')} passed, ${count('failed')} failed, ${count('skipped')} skipped, ${x.suiteErrors.length} file errors`);
    }
    process.exit(r.noReport ? 3 : r.ok ? 0 : 1);
  } else usage();
}
