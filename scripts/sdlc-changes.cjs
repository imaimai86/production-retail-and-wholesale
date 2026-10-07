#!/usr/bin/env node
// Tells the SDLC Ship stage which files the cycle changed. Read-only.
//   node scripts/sdlc-changes.cjs snapshot <baseline.json>
//   node scripts/sdlc-changes.cjs changed  <baseline.json>   -> { include: [...], skipped: [{path, reason}], mirror: [{from, to}] }
//   node scripts/sdlc-changes.cjs mask <env-file> <example-file>   writes the file with every value replaced by <value>
// `mirror` lists each `.env` the cycle changed (never committed) with the sibling `.env.example` to write
// from it; it leaves out a `.env.example` the developer already had modified or the cycle itself changed.
// A snapshot maps every path `git status` reports (modified, deleted, untracked, staged) to a content
// hash (null when deleted). `changed` compares the working tree with it. Exit 0 = ok, 1 = error, 2 = usage.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const USAGE = 'Usage: sdlc-changes snapshot|changed <baseline.json> | mask <env-file> <example-file>';
const MAX_BYTES = 1024 * 1024;

const git = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
const toplevel = () => git(['rev-parse', '--show-toplevel']).trim();

// Current state: { path: hash | null }. Paths are relative to the repo root; gitignored paths never appear.
function currentState(top) {
  const out = git(['-C', top, 'status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const parts = out.split('\0');
  const state = {};
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    const file = entry.slice(3);
    if (xy[0] === 'R' || xy[0] === 'C' || xy[1] === 'R' || xy[1] === 'C') {
      const from = parts[++i];
      if (xy[0] === 'R' || xy[1] === 'R') state[from] = null; // rename = delete + add
    }
    state[file] = null;
  }
  for (const file of Object.keys(state)) state[file] = hashOf(top, file);
  return state;
}

function hashOf(top, file) {
  const abs = path.join(top, file);
  let stat;
  try { stat = fs.lstatSync(abs); } catch { return null; }
  if (!stat.isFile() && !stat.isSymbolicLink()) return null;
  try { return git(['-C', top, 'hash-object', '--', file]).trim(); } catch { return null; }
}

function skipReason(file, top) {
  const segments = file.split('/');
  const base = segments[segments.length - 1];
  if (base === '.env' || (base.startsWith('.env.') && base !== '.env.example')
    || /\.(pem|key|p12|keystore)$/.test(base) || base.startsWith('id_rsa')) return 'sensitive file';
  if (segments.some(s => s === '.vscode' || s === '.idea' || s === '.claude')) return 'local or agent configuration';
  if (segments.includes('node_modules') || base === '.DS_Store') return 'generated';
  try {
    if (fs.statSync(path.join(top, file)).size > MAX_BYTES) return 'too large';
  } catch { /* deleted */ }
  return null;
}

// KEY=value -> KEY=<value>; comments, blank lines and lines without "=" are kept as they are.
function maskEnv(text) {
  return text.split('\n').map(line => {
    const m = line.match(/^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_.-]*\s*=)/);
    return m ? `${m[1]}<value>` : line;
  }).join('\n');
}

function main(argv) {
  const [cmd, baselineFile, exampleFile] = argv;
  if (cmd === 'mask') {
    if (!baselineFile || !exampleFile) { console.error(USAGE); return 2; }
    fs.writeFileSync(exampleFile, maskEnv(fs.readFileSync(baselineFile, 'utf8')));
    return 0;
  }
  if (!['snapshot', 'changed'].includes(cmd) || !baselineFile) {
    console.error(USAGE);
    return 2;
  }
  const top = toplevel();
  const now = currentState(top);
  if (cmd === 'snapshot') {
    fs.mkdirSync(path.dirname(path.resolve(baselineFile)), { recursive: true });
    fs.writeFileSync(baselineFile, JSON.stringify(now, null, 2) + '\n');
    return 0;
  }
  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
  const include = [];
  const skipped = [];
  for (const file of Object.keys(now).sort()) {
    const inBaseline = Object.prototype.hasOwnProperty.call(baseline, file);
    if (inBaseline && baseline[file] === now[file]) continue;
    const reason = inBaseline ? 'pre-existing local changes' : skipReason(file, top);
    if (reason) skipped.push({ path: file, reason });
    else include.push(file);
  }
  const mirror = [];
  for (const { path: file, reason } of skipped) {
    if (reason !== 'sensitive file' || path.posix.basename(file) !== '.env' || now[file] === null) continue;
    const dir = path.posix.dirname(file);
    const to = dir === '.' ? '.env.example' : `${dir}/.env.example`;
    const taken = include.includes(to) || skipped.some(s => s.path === to)
      || Object.prototype.hasOwnProperty.call(baseline, to);
    if (!taken) mirror.push({ from: file, to });
  }
  process.stdout.write(JSON.stringify({ include, skipped, mirror }, null, 2) + '\n');
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  console.error(`sdlc-changes: ${err.message}`);
  process.exitCode = 1;
}
