#!/usr/bin/env node
// Which files did an SDLC cycle change? Used by scripts/sdlc.sh (Ship stage).
//   node scripts/sdlc-changes.cjs snapshot <out.json>      record the working tree state
//   node scripts/sdlc-changes.cjs changed  <baseline.json> print {"include":[..],"skipped":[..]}
// Baseline layout (also read by scripts/sdlc-ship.sh): flat { "<path>": "<git blob sha>" | null },
// null meaning the path is absent from disk (deleted).
const fs = require('fs');
const { execFileSync } = require('child_process');

const MAX_SIZE = 1048576;

function fail(msg) {
  process.stderr.write(String(msg).split('\n')[0] + '\n');
  process.exit(1);
}

function git(args) {
  try {
    return execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 });
  } catch (err) {
    const detail = err.stderr ? err.stderr.toString().trim() : err.message;
    return fail('git failed: ' + detail);
  }
}

function readStatus() {
  const inside = git(['rev-parse', '--is-inside-work-tree']).toString().trim();
  if (inside !== 'true') fail('not a git work tree');
  const fields = git(['status', '--porcelain=v1', '-z', '--untracked-files=all']).toString('utf8').split('\0');
  const paths = new Set();
  for (let i = 0; i < fields.length; i++) {
    const rec = fields[i];
    if (rec.length < 4) continue;
    const xy = rec.slice(0, 2);
    paths.add(rec.slice(3));
    if (/[RC]/.test(xy)) {
      i++;
      if (fields[i]) paths.add(fields[i]);
    }
  }
  return paths;
}

function hashOf(path) {
  let st;
  try {
    st = fs.lstatSync(path);
  } catch (e) {
    return null;
  }
  if (st.isDirectory()) return null;
  return git(['hash-object', '--', path]).toString().trim();
}

function sizeOf(path) {
  try {
    return fs.lstatSync(path).size;
  } catch (e) {
    return 0;
  }
}

function byteCmp(a, b) {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

function snapshot(outFile) {
  if (!outFile) fail('usage: sdlc-changes.cjs snapshot <out.json>');
  const snap = {};
  for (const p of [...readStatus()].sort(byteCmp)) snap[p] = hashOf(p);
  try {
    fs.writeFileSync(outFile, JSON.stringify(snap));
  } catch (e) {
    fail('cannot write ' + outFile + ': ' + e.message);
  }
}

function loadBaseline(file) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fail('cannot read baseline ' + file + ': ' + e.message);
  }
  const ok = data !== null && typeof data === 'object' && !Array.isArray(data) &&
    Object.values(data).every((v) => v === null || typeof v === 'string');
  if (!ok) fail('invalid baseline ' + file);
  return data;
}

function classify(path, baseline, size) {
  const segs = path.split('/');
  const base = segs[segs.length - 1];
  if ((base === '.env' || (base.startsWith('.env.') && base !== '.env.example')) ||
    /\.(pem|key|p12|keystore)$/.test(base) || base.startsWith('id_rsa')) return 'sensitive file';
  if (segs.some((s) => s === '.vscode' || s === '.idea' || s === '.claude')) return 'local or agent configuration';
  if (segs.includes('node_modules') || base === '.DS_Store') return 'generated';
  if (Object.prototype.hasOwnProperty.call(baseline, path)) return 'pre-existing local changes';
  if (size > MAX_SIZE) return 'too large';
  return null;
}

function changed(baselineFile) {
  if (!baselineFile) fail('usage: sdlc-changes.cjs changed <baseline.json>');
  const baseline = loadBaseline(baselineFile);
  const include = [];
  const skipped = [];
  for (const p of readStatus()) {
    const h = hashOf(p);
    if (Object.prototype.hasOwnProperty.call(baseline, p) && baseline[p] === h) continue;
    const reason = classify(p, baseline, h === null ? 0 : sizeOf(p));
    if (reason) skipped.push({ path: p, reason });
    else include.push(p);
  }
  include.sort(byteCmp);
  skipped.sort((a, b) => byteCmp(a.path, b.path));
  process.stdout.write(JSON.stringify({ include, skipped }) + '\n');
}

try {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'snapshot') snapshot(arg);
  else if (cmd === 'changed') changed(arg);
  else fail('usage: sdlc-changes.cjs snapshot|changed <file>');
} catch (err) {
  fail(err.message);
}
