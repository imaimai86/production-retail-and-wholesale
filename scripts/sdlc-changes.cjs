#!/usr/bin/env node
// Which files did the SDLC cycle change? Used by the Ship stage (scripts/sdlc-ship.sh).
//   node scripts/sdlc-changes.cjs snapshot <baseline.json>   record every dirty path with a content hash
//   node scripts/sdlc-changes.cjs changed  <baseline.json>   print {"include":[...],"skipped":[{"path","reason"}]}
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MAX_BYTES = 1024 * 1024;

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
}

const top = git(['rev-parse', '--show-toplevel']).trim();
const inTop = args => git(args, { cwd: top });

// Every path git reports as modified, deleted, untracked or staged (ignored files never appear).
// A rename is reported as a delete of the old path plus an add of the new one.
function dirtyPaths() {
  const parts = inTop(['status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0');
  const paths = new Set();
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    paths.add(entry.slice(3));
    if (xy.includes('R') || xy.includes('C')) {
      const from = parts[++i];
      if (xy.includes('R')) paths.add(from);
    }
  }
  return [...paths].sort();
}

function hashOf(p) {
  const abs = path.join(top, p);
  if (!fs.existsSync(abs)) return null;
  return inTop(['hash-object', '--', p]).trim();
}

function skipReason(p, preExisting) {
  const parts = p.split('/');
  const base = parts[parts.length - 1];
  const dirs = parts.slice(0, -1);
  if (preExisting) return 'pre-existing local changes';
  if (
    base === '.env' || (base.startsWith('.env.') && base !== '.env.example') ||
    /\.(pem|key|p12|keystore)$/.test(base) || base.startsWith('id_rsa')
  ) return 'sensitive file';
  if (dirs.some(d => d === '.vscode' || d === '.idea' || d === '.claude')) return 'local or agent configuration';
  if (dirs.includes('node_modules') || base === '.DS_Store') return 'generated';
  const abs = path.join(top, p);
  if (fs.existsSync(abs) && fs.statSync(abs).size > MAX_BYTES) return 'too large';
  return null;
}

function snapshot(file) {
  const snap = {};
  for (const p of dirtyPaths()) snap[p] = hashOf(p);
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(snap, null, 2) + '\n');
}

function changed(file) {
  const baseline = JSON.parse(fs.readFileSync(file, 'utf8'));
  const include = [];
  const skipped = [];
  for (const p of dirtyPaths()) {
    const inBase = Object.prototype.hasOwnProperty.call(baseline, p);
    if (inBase && baseline[p] === hashOf(p)) continue; // dirty before the run and untouched by it
    const reason = skipReason(p, inBase);
    if (reason) skipped.push({ path: p, reason });
    else include.push(p);
  }
  process.stdout.write(JSON.stringify({ include, skipped }) + '\n');
}

const [cmd, file] = process.argv.slice(2);
try {
  if (cmd === 'snapshot' && file) snapshot(file);
  else if (cmd === 'changed' && file) changed(file);
  else { console.error('Usage: sdlc-changes.cjs snapshot|changed <baseline.json>'); process.exit(2); }
} catch (e) {
  console.error(`sdlc-changes: ${e.message}`);
  process.exit(1);
}
