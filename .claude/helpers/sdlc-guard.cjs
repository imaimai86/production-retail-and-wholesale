#!/usr/bin/env node
// SDLC guard hooks. State lives in .claude/sdlc-state.json: { phase, slug, red_sha, attempts }.
//   node sdlc-guard.cjs set <phase> <slug> [red_sha]   (phase: implement | review)
//   node sdlc-guard.cjs clear
//   node sdlc-guard.cjs pre-tool   (PreToolUse hook: protect server/__tests__)
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
  const inTests = p => typeof p === 'string' && /(^|\/)server\/__tests__\//.test(p.replace(/\\/g, '/'));
  let blocked = false;
  if (input.tool_name === 'Bash') {
    const cmdline = ti.command || '';
    const writes = /(\bsed\s+-i|\btee\b|\brm\b|\bmv\b|\bcp\b|>|\bgit\s+(checkout|restore|apply)\b)/.test(cmdline);
    blocked = /__tests__/.test(cmdline) && writes;
  } else {
    blocked = inTests(ti.file_path) || inTests(ti.notebook_path);
  }
  if (blocked) {
    console.error(`BLOCKED: server/__tests__ is read-only during the '${s.phase}' phase of ${s.slug}. Fix the source code, not the tests. If a test is truly wrong, stop and tell the user.`);
    process.exit(2);
  }
} else if (cmd === 'stop') {
  // Green gate: don't let the session end while tests fail (bounded by MAX_ATTEMPTS).
  const s = read();
  if (!active(s)) process.exit(0);
  const r = spawnSync('npm', ['test'], { cwd: ROOT, encoding: 'utf8' });
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
    reason: `npm test is failing (attempt ${s.attempts}/${MAX_ATTEMPTS}). Fix the source, not server/__tests__.\n\n${tail}`,
  }));
} else {
  console.error('usage: sdlc-guard.cjs set|clear|pre-tool|stop');
  process.exit(1);
}
