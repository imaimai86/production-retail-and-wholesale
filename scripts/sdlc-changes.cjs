#!/usr/bin/env node
// Tells the SDLC Ship stage which files the cycle changed. Read-only.
//   node scripts/sdlc-changes.cjs snapshot <baseline.json>
//   node scripts/sdlc-changes.cjs changed  <baseline.json>   -> { include: [...], skipped: [{path, reason}] }
// A snapshot maps every path `git status` reports (modified, deleted, untracked, staged) to a content
// hash (null when deleted). `changed` compares the working tree with it. Exit 0 = ok, 1 = error, 2 = usage.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const USAGE = 'Usage: sdlc-changes snapshot|changed <baseline.json>';
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

function main(argv) {
  const [cmd, baselineFile] = argv;
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
  process.stdout.write(JSON.stringify({ include, skipped }, null, 2) + '\n');
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  console.error(`sdlc-changes: ${err.message}`);
  process.exitCode = 1;
}
