#!/usr/bin/env node
// Mechanical checks for the Test repair stage of scripts/sdlc.sh. Exit 0 = pass, 1 = reject (reasons on stderr).
//   precheck  <jest.json> <test-issues.md> <max>   failing tests must all be claimed; claims capped and real
//   diffcheck <red_sha> <test-issues.md>           only claimed files changed; no skips; no weaker assertions
//   namecheck <red.json> <now.json>                every test that existed at red still exists
//   redcheck  <red.json> <repaired-on-red.json>    every test that failed at red still fails on red source
//   claimed   <test-issues.md>                     print claimed test keys
//   unclaimed <now.json> <test-issues.md>          print failing test keys that are not claimed
//   retry-plan                                     stdin: keys; print "<file>\t<jest -t pattern>" per file (empty pattern = whole file)
//   merge-retry <now.json> <test-issues.md> <flaky-tests.md> <retry.json>...   unclaimed failures that passed on re-run become passed
//   resumecheck <red_sha> <test-issues.md> <slug>  preconditions for FROM=test-repair (read-only; empty red_sha = no commit)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const TEST_DIR = 'server/__tests__';
const rel = p => p.replace(/\\/g, '/').replace(/^.*?(server\/__tests__\/)/, '$1').replace(/^server\//, '');
const fail = msgs => { console.error(msgs.map(m => 'REJECT: ' + m).join('\n')); process.exit(1); };

const fileOf = f => rel(path.relative(path.join(process.cwd(), 'server'), f.name) || f.name);
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

function collect(j) {
  const all = new Set(), failed = new Set(), passed = new Set(), passedFiles = new Set();
  for (const f of j.testResults) {
    const file = fileOf(f);
    if (f.status === 'passed') passedFiles.add(file);
    if (!f.assertionResults.length && f.status === 'failed') failed.add(`${file}::<suite failed to run>`);
    for (const a of f.assertionResults) {
      const key = `${file}::${norm(a.fullName)}`;
      all.add(key);
      if (a.status === 'failed') failed.add(key);
      if (a.status === 'passed') passed.add(key);
    }
  }
  return { all, failed, passed, passedFiles };
}

function results(jsonFile) {
  const { all, failed } = collect(JSON.parse(fs.readFileSync(jsonFile, 'utf8')));
  return { all, failed };
}

// test-issues.md lines: "<test file> :: <full test name> :: <reason citing the spec>"
function claims(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n')
    .map(l => l.replace(/^[-*]\s*/, '').split(' :: ').map(s => s.trim()))
    .filter(p => p.length >= 3 && p[0] && p[1] && p[2])
    .map(([f, name, ...why]) => ({ file: rel(f.replace(/^server\//, '')), name, why: why.join(' :: '), key: `${rel(f.replace(/^server\//, ''))}::${norm(name)}` }));
}

const norm = s => s.replace(/\s*›\s*/g, ' ').replace(/\s+/g, ' ').trim();
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const count = (s, re) => (s.match(re) || []).length;
const WEAK = /\.(toBeDefined|toBeTruthy|toBeFalsy|toBeUndefined|toBeNull)\(|expect\.(anything|any)\(/g;
const SKIP = /\.(skip|only|todo)\(|\b(xit|xtest|xdescribe|fit|fdescribe)\(/g;

const [, , cmd, a, b, c] = process.argv;

const usage = msg => { console.error('usage: sdlc-testcheck.cjs ' + msg); process.exit(1); };
const escapeRe = n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const retrySet = (nowJson, issuesFile) => {
  const claimed = new Set(claims(issuesFile).map(x => x.key));
  return [...results(nowJson).failed].filter(k => !claimed.has(k));
};

if (cmd === 'claimed') {
  claims(a).forEach(x => console.log(x.key));
} else if (cmd === 'unclaimed') {
  if (!a || !b) usage('unclaimed <now.json> <test-issues.md>');
  retrySet(a, b).forEach(k => console.log(k));
} else if (cmd === 'retry-plan') {
  const byFile = new Map();
  for (const key of fs.readFileSync(0, 'utf8').split('\n').filter(Boolean)) {
    const i = key.indexOf('::'), file = key.slice(0, i), name = key.slice(i + 2);
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(name);
  }
  for (const [file, names] of byFile) {
    const pat = names.includes('<suite failed to run>') ? '' : '^(?:' + names.map(escapeRe).join('|') + ')$';
    console.log(`${file}\t${pat}`);
  }
} else if (cmd === 'merge-retry') {
  if (!a || !b || !c) usage('merge-retry <now.json> <test-issues.md> <flaky-tests.md> <retry.json>...');
  const keys = retrySet(a, b);
  const reruns = process.argv.slice(6).map(readJson).filter(j => j && Array.isArray(j.testResults)).map(collect);
  const flaky = keys.filter(k => k.endsWith('::<suite failed to run>')
    ? reruns.some(r => r.passedFiles.has(k.slice(0, k.lastIndexOf('::'))))
    : reruns.some(r => r.passed.has(k)) && !reruns.some(r => r.failed.has(k)));
  if (flaky.length) {
    const set = new Set(flaky), j = JSON.parse(fs.readFileSync(a, 'utf8'));
    for (const f of j.testResults) {
      const file = fileOf(f);
      if (set.has(`${file}::<suite failed to run>`)) f.status = 'passed';
      for (const t of f.assertionResults) if (set.has(`${file}::${norm(t.fullName)}`)) t.status = 'passed';
    }
    fs.writeFileSync(a, JSON.stringify(j));
    fs.appendFileSync(c, flaky.map(k => `${k} :: first run: failed :: re-run: passed\n`).join(''));
    flaky.forEach(k => console.log('WARNING: flaky test passed on re-run, not rejected: ' + k));
  }
} else if (cmd === 'precheck') {
  const max = Number(c || 3), cl = claims(b), { all, failed } = results(a), errs = [];
  const keys = new Set(cl.map(x => x.key));
  if (!cl.length) errs.push('test-issues.md has no valid "<file> :: <test name> :: <reason>" lines');
  if (cl.length > max) errs.push(`${cl.length} tests claimed wrong; the limit is ${max}`);
  for (const k of keys) if (!all.has(k)) errs.push(`claimed test does not exist: ${k}`);
  for (const k of failed) if (!keys.has(k)) errs.push(`failing test is NOT claimed as a test defect (source bug, not test repair): ${k}`);
  for (const x of cl) if (!/(spec|decision|round|S-R|isolat|mock)/i.test(x.why)) errs.push(`claim gives no spec/decision/isolation justification: ${x.key}`);
  if (errs.length) fail(errs);
} else if (cmd === 'diffcheck') {
  const cl = claims(b), errs = [], allowed = new Set(cl.map(x => 'server/' + x.file));
  const changed = new Set(git('diff', '--name-only', a, '--', TEST_DIR).split('\n').filter(Boolean));
  git('ls-files', '--others', '--exclude-standard', '--', TEST_DIR).split('\n').filter(Boolean).forEach(f => changed.add(f));
  if (!changed.size) errs.push('no test file was changed');
  for (const f of changed) {
    if (!allowed.has(f)) { errs.push(`changed a test file that was not claimed: ${f}`); continue; }
    let old = ''; try { old = git('show', `${a}:${f}`); } catch { errs.push(`claimed file did not exist at red: ${f}`); continue; }
    const now = fs.readFileSync(f, 'utf8');
    if (count(now, /\bexpect\(/g) < count(old, /\bexpect\(/g)) errs.push(`fewer expect() calls than at red in ${f}`);
    if (count(now, WEAK) > count(old, WEAK)) errs.push(`weaker matchers added (toBeDefined/toBeTruthy/expect.anything...) in ${f}`);
    if (count(now, SKIP) > count(old, SKIP)) errs.push(`skip/only/todo added in ${f}`);
    if (count(now, /\b(it|test)\(/g) < count(old, /\b(it|test)\(/g)) errs.push(`fewer it()/test() blocks than at red in ${f}`);
  }
  if (errs.length) fail(errs);
} else if (cmd === 'namecheck') {
  const before = results(a).all, now = results(b).all, errs = [];
  for (const k of before) if (!now.has(k)) errs.push(`test removed or renamed: ${k}`);
  if (errs.length) fail(errs);
} else if (cmd === 'redcheck') {
  // A test that detected the missing behaviour at red must still detect it after repair.
  const origFailed = results(a).failed, nowFailed = results(b).failed, errs = [];
  for (const k of origFailed) if (!nowFailed.has(k)) errs.push(`test failed at red but now PASSES on the unimplemented source (no longer detects the bug): ${k}`);
  if (errs.length) fail(errs);
} else if (cmd === 'resumecheck') {
  // Read-only preconditions for FROM=test-repair. Rejects are collected and printed together.
  if (b === undefined || c === undefined) { console.error('usage: sdlc-testcheck.cjs resumecheck <red_sha> <test-issues.md> <slug>'); process.exit(1); }
  const errs = [], slug = c, tryGit = (...g) => { try { return git(...g); } catch { return null; } };
  let sha = a || '';
  if (!sha) errs.push(`no red-tests commit found for ${slug} (expected a commit with subject "test(${slug}): add failing tests")`);
  else if (tryGit('rev-parse', '--verify', '--quiet', sha + '^{commit}') === null) { errs.push(`red-tests commit ${sha} is not a known commit`); sha = ''; }
  if (!fs.existsSync(b)) errs.push(`claim file is missing: ${b}`);
  else if (!fs.readFileSync(b, 'utf8').trim()) errs.push(`claim file is empty: ${b}`);
  else if (!claims(b).length) errs.push(`claim file has no valid "<file> :: <test name> :: <reason>" lines: ${b}`);
  if (sha) {
    const esc = slug.replace(/[.*^$\[\]\\]/g, '\\$&');
    const repaired = (tryGit('log', '--format=%h', '-1', `--grep=^test(${esc}): repair invalid tests`, `${sha}..HEAD`) || '').trim();
    if (repaired) errs.push(`test repair was already accepted in commit ${repaired}: use FROM=review`);
    const lines = out => (out || '').split('\n').filter(Boolean);
    const untracked = lines(tryGit('ls-files', '--others', '--exclude-standard'));
    const tests = [...new Set([...lines(tryGit('diff', '--name-only', sha, '--', TEST_DIR)), ...untracked.filter(f => f.startsWith(TEST_DIR + '/'))])];
    if (tests.length) errs.push(`tests changed since the red-tests commit ${sha.slice(0, 7)}: ${tests.join(', ')}; restore with: git checkout ${sha} -- ${TEST_DIR} && git clean -fd ${TEST_DIR}`);
    const impl = [...new Set([...lines(tryGit('diff', '--name-only', sha)), ...untracked])].filter(f => !f.startsWith(TEST_DIR + '/') && !f.startsWith('Docs/'));
    if (!impl.length) errs.push(`no implementation change since the red-tests commit (changes only under ${TEST_DIR}/ or Docs/ do not count)`);
  }
  if (errs.length) fail(errs);
} else {
  console.error('usage: sdlc-testcheck.cjs precheck|diffcheck|namecheck|redcheck|claimed|unclaimed|retry-plan|merge-retry|resumecheck ...');
  process.exit(1);
}
