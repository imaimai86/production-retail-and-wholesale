#!/usr/bin/env node
// Mechanical checks for the Test repair stage of scripts/sdlc.sh. Exit 0 = pass, 1 = reject (reasons on stderr).
//   precheck  <jest.json> <test-issues.md> <max>   failing tests must all be claimed; claims capped and real
//   diffcheck <red_sha> <test-issues.md>           only claimed files changed; no skips; no weaker assertions
//   namecheck <red.json> <now.json>                every test that existed at red still exists
//   redcheck  <red.json> <repaired-on-red.json>    every test that failed at red still fails on red source
//   claimed   <test-issues.md>                     print claimed test keys
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const TEST_DIR = 'server/__tests__';
const rel = p => p.replace(/\\/g, '/').replace(/^.*?(server\/__tests__\/)/, '$1').replace(/^server\//, '');
const fail = msgs => { console.error(msgs.map(m => 'REJECT: ' + m).join('\n')); process.exit(1); };

function results(jsonFile) {
  const j = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  const all = new Set(), failed = new Set();
  for (const f of j.testResults) {
    const file = rel(path.relative(path.join(process.cwd(), 'server'), f.name) || f.name);
    if (!f.assertionResults.length && f.status === 'failed') failed.add(`${file}::<suite failed to run>`);
    for (const a of f.assertionResults) {
      const key = `${file}::${norm(a.fullName)}`;
      all.add(key);
      if (a.status === 'failed') failed.add(key);
    }
  }
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

if (cmd === 'claimed') {
  claims(a).forEach(x => console.log(x.key));
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
} else {
  console.error('usage: sdlc-testcheck.cjs precheck|diffcheck|namecheck|redcheck|claimed ...');
  process.exit(1);
}
