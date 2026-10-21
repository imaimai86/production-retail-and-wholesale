#!/usr/bin/env node
// SDLC guard hooks. State lives in .claude/sdlc-state.json: { phase, slug, red_sha, attempts }.
//   node sdlc-guard.cjs set <phase> <slug> [red_sha]   (phase: implement | review)
//   node sdlc-guard.cjs clear
//   node sdlc-guard.cjs pre-tool   (PreToolUse hook: protect the test files)
// The test files and test command come from the project settings (`ai-sdlc-helper layout`); when they cannot be read
// (ai-sdlc-helper missing, or settings it rejects), this repo's: server/__tests__ and npm test.
//   node sdlc-guard.cjs stop       (Stop hook: green gate)
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const STATE = path.join(ROOT, '.claude', 'sdlc-state.json');
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS || 4);
const GUARDED = ['implement', 'review'];

const read = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return null; } };
const write = s => fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
const stdin = () => { try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return {}; } };
const active = s => s && GUARDED.includes(s.phase);

// { testPatterns: [regexp source on paths from the root], testDirs, testFiles, testCmd } for this project.
function layout() {
  try {
    const r = spawnSync('ai-sdlc-helper', ['layout', ROOT], { cwd: ROOT, encoding: 'utf8' });
    const l = r.status === 0 ? JSON.parse(r.stdout) : null;
    if (l && Array.isArray(l.testPatterns) && Array.isArray(l.testDirs) && l.testCmd) return l;
  } catch { /* ai-sdlc-helper missing, or output that is not the layout */ }
  return { testPatterns: ['^server/__tests__/'], testDirs: ['server/__tests__'], testFiles: 'server/__tests__/', testCmd: 'npm test' };
}
// A path (absolute, or from the root) as a path from the root.
const fromRoot = p => {
  const n = String(p).replace(/\\/g, '/').replace(/^['"]|['"]$/g, '');
  return path.isAbsolute(n) ? path.relative(ROOT, n).split(path.sep).join('/') : n.replace(/^\.\//, '');
};
const [, , cmd, a, b, c] = process.argv;

if (cmd === 'set') {
  write({ phase: a, slug: b, red_sha: c || null, attempts: 0 });
  console.log(`sdlc phase=${a} slug=${b}`);
} else if (cmd === 'clear') {
  try { fs.unlinkSync(STATE); } catch { /* none */ }
  console.log('sdlc state cleared');
} else if (cmd === 'pre-tool') {
  // Block edits to tests while implementing/reviewing. Exit 2 = block, stderr goes to Claude.
  const s = read();
  if (!active(s)) process.exit(0);
  const input = stdin();
  const ti = input.tool_input || {};
  const l = layout();
  const patterns = l.testPatterns.map(x => new RegExp(x));
  const inTests = p => typeof p === 'string' && p !== '' && patterns.some(re => re.test(fromRoot(p)));
  let blocked = false;
  if (input.tool_name === 'Bash') {
    const cmdline = ti.command || '';
    const writes = /(\bsed\s+-i|\btee\b|\brm\b|\bmv\b|\bcp\b|>|\bgit\s+(checkout|restore|apply)\b)/.test(cmdline);
    // a word of the command that is a test file, a test folder, or inside one
    const words = cmdline.split(/[\s;&|<>()]+/).filter(Boolean);
    const touchesTests = words.some(w => inTests(w) || l.testDirs.some(d => d !== '.' && fromRoot(w).replace(/\/+$/, '') === d));
    blocked = writes && touchesTests;
  } else {
    blocked = inTests(ti.file_path) || inTests(ti.notebook_path);
  }
  if (blocked) {
    console.error(`BLOCKED: the tests (${l.testFiles}) are read-only during the '${s.phase}' phase of ${s.slug}. Fix the source code, not the tests. If a test is truly wrong, stop and tell the user.`);
    process.exit(2);
  }
} else if (cmd === 'stop') {
  // Green gate: don't let the session end while tests fail (bounded by MAX_ATTEMPTS).
  const s = read();
  if (!active(s)) process.exit(0);
  const l = layout();
  const r = spawnSync('sh', ['-c', l.testCmd], { cwd: ROOT, encoding: 'utf8' });
  if (r.status === 0) process.exit(0);
  s.attempts = (s.attempts || 0) + 1;
  write(s);
  if (s.attempts >= MAX_ATTEMPTS) {
    console.error(`sdlc: tests still failing after ${MAX_ATTEMPTS} attempts; releasing the gate. Report the failure to the user.`);
    process.exit(0);
  }
  const tail = (r.stdout + r.stderr).split('\n').slice(-40).join('\n');
  console.log(JSON.stringify({
    decision: 'block',
    reason: `${l.testCmd} is failing (attempt ${s.attempts}/${MAX_ATTEMPTS}). Fix the source, not the tests (${l.testFiles}).\n\n${tail}`,
  }));
} else {
  console.error('usage: sdlc-guard.cjs set|clear|pre-tool|stop');
  process.exit(1);
}
