#!/usr/bin/env node
// Which files did this SDLC cycle change? Used by the Ship stage (scripts/sdlc-ship.sh).
//   node scripts/sdlc-changes.cjs snapshot <baseline.json>   record every dirty path and its content hash
//   node scripts/sdlc-changes.cjs mirror   <baseline.json>   copy keys the cycle added to .env into .env.example
//   node scripts/sdlc-changes.cjs changed  <baseline.json>   print { include, skipped, envMirror } as JSON
//   node scripts/sdlc-changes.cjs mark <stage-files.json> [stage]  attribute what changed since the last mark to <stage> (no stage: only reset the mark)
// Run it from the repository root.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MAX_BYTES = 1024 * 1024;

const git = args => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const gitHash = file => execFileSync('git', ['hash-object', '--', file], { encoding: 'utf8' }).trim();

// Every path git reports as modified, deleted, untracked or staged, with a content hash (null when the file is gone).
function currentState() {
  const out = git(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const parts = out.split('\0');
  const state = {};
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry) continue;
    const code = entry.slice(0, 2);
    const file = entry.slice(3);
    if (code[0] === 'R' || code[0] === 'C') {
      // rename: "R  new\0old\0" is one delete (old) plus one add (new)
      const old = parts[++i];
      if (code[0] === 'R') state[old] = null;
    }
    state[file] = fs.existsSync(file) && fs.statSync(file).isFile() ? gitHash(file) : null;
  }
  return state;
}

const isEnvFile = base => /^\.env(\..+)?$/.test(base) && base !== '.env.example';

// Keys of the git-ignored .env files (they never show up in git status, so they are tracked separately).
function envKeys() {
  const out = git(['ls-files', '-o', '-i', '--exclude-standard', '-z']);
  const keys = {};
  for (const file of out.split('\0')) {
    if (!file || file.includes('node_modules/') || !isEnvFile(path.basename(file))) continue;
    keys[file] = parseKeys(fs.readFileSync(file, 'utf8'));
  }
  return keys;
}

function parseKeys(text) {
  const keys = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && !keys.includes(m[1])) keys.push(m[1]);
  }
  return keys;
}

// The first matching rule wins (order matters: it decides the reason the developer sees).
function skipReason(file, preExisting) {
  const base = path.basename(file);
  if (preExisting) return 'pre-existing local changes';
  if (isEnvFile(base) || /\.(pem|key|p12|keystore)$/.test(base) || /^id_rsa/.test(base)) return 'sensitive file';
  if (file.split('/').slice(0, -1).some(dir => ['.vscode', '.idea', '.claude'].includes(dir))) return 'local or agent configuration';
  if (file.split('/').includes('node_modules') || base === '.DS_Store') return 'generated';
  if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) return 'too large';
  return null;
}

function snapshot(target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify({ files: currentState(), env: envKeys() }, null, 2));
}

function changed(baselineFile) {
  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
  const now = currentState();
  const include = [];
  const skipped = [];
  for (const file of Object.keys(now).sort()) {
    const inBaseline = Object.prototype.hasOwnProperty.call(baseline.files, file);
    if (inBaseline && baseline.files[file] === now[file]) continue; // dirty before, untouched since
    const reason = skipReason(file, inBaseline);
    if (reason) skipped.push({ path: file, reason });
    else include.push(file);
  }
  // New keys added to a git-ignored .env since the baseline, to mirror into the sibling .env.example.
  const envMirror = [];
  const nowEnv = envKeys();
  for (const file of Object.keys(nowEnv).sort()) {
    const before = baseline.env && baseline.env[file] ? baseline.env[file] : [];
    const added = nowEnv[file].filter(k => !before.includes(k));
    if (added.length) envMirror.push({ env: file, example: path.join(path.dirname(file), '.env.example'), keys: added });
  }
  return { include, skipped, envMirror };
}

// Copy the key names the cycle added to a git-ignored .env into its sibling .env.example, with a placeholder value
// (never the real value). An .env.example the developer had already modified is left alone.
function mirror(baselineFile) {
  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
  for (const { example, keys } of changed(baselineFile).envMirror) {
    if (Object.prototype.hasOwnProperty.call(baseline.files, example)) {
      console.error(`WARNING: ${example} had local changes before the run; not updated with new keys ${keys.join(', ')}`);
      continue;
    }
    const existing = fs.existsSync(example) ? fs.readFileSync(example, 'utf8') : '';
    const missing = keys.filter(k => !parseKeys(existing).includes(k));
    if (!missing.length) continue;
    const sep = existing && !existing.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(example, existing + sep + missing.map(k => `${k}=change-me`).join('\n') + '\n');
    console.error(`mirrored ${missing.join(', ')} from ${path.basename(example)} sibling .env into ${example}`);
  }
}

// Files each stage changed, for the control pane. `marker` is the dirty state and HEAD at the last mark; what differs now is credited to
// the stage that just ended. A file committed during a stage counts for it, but one a later commit merely collects (Ship) does not.
function mark(target, stage) {
  let state = { marker: null, stages: {} };
  try { state = { ...state, ...JSON.parse(fs.readFileSync(target, 'utf8')) }; } catch (e) { /* first mark */ }
  const now = currentState();
  const head = git(['rev-parse', 'HEAD']).trim();
  if (stage && state.marker) {
    const before = state.marker.files;
    const credited = new Set(Object.values(state.stages).flat());
    const files = new Set();
    for (const f of Object.keys(now)) if (!Object.prototype.hasOwnProperty.call(before, f) || before[f] !== now[f]) files.add(f);
    if (state.marker.head !== head) {
      for (const f of git(['diff', '--name-only', '-z', state.marker.head, head]).split('\0')) if (f && !credited.has(f)) files.add(f);
    }
    const listed = [...files].filter(f => !skipReason(f, false)).sort();
    if (listed.length) state.stages[stage] = [...new Set([...(state.stages[stage] || []), ...listed])].sort();
  }
  state.marker = { files: now, head };
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(state));
}

const [cmd, file, stageArg] = process.argv.slice(2);
if (cmd === 'mark' && file) mark(file, stageArg || '');
else if (cmd === 'snapshot' && file) snapshot(file);
else if (cmd === 'mirror' && file) mirror(file);
else if (cmd === 'changed' && file) process.stdout.write(JSON.stringify(changed(file)) + '\n');
else {
  console.error('usage: sdlc-changes.cjs snapshot|mirror|changed <baseline.json> | mark <stage-files.json> [stage]');
  process.exit(1);
}
