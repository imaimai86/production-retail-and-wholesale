#!/usr/bin/env node
// Gates that make the SDLC pipeline require integration tests for database and API changes.
// Exit 0 = pass, 1 = reject (REJECT: lines on stderr), same style as scripts/sdlc-testcheck.cjs.
//   section <plan-1.md>                  check the plan's "## DB and API changes" section; prints "none" or "required"
//   plan    <plan-1.md> <test-dir>       section check, then (unless "- none") every bullet's token must be in a
//                                        describe/test/it title of a new or modified file under <test-dir>/integration/
//   diff    <red_sha> <orig_red_sha>     if source changed since <red_sha> (comments and whitespace ignored), the red
//                                        commit <orig_red_sha> must have added files under server/__tests__/integration/
// Run from the repository root.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SOURCE_PATHS = ['server/migrations/', 'server/schema.sql', 'server/models/', 'server/index.js', 'server/middleware/', 'server/validation.js'];
const INTEGRATION_DIR = 'server/__tests__/integration/';

const fail = msgs => { console.error(msgs.map(m => 'REJECT: ' + m).join('\n')); process.exit(1); };
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// Bullet forms allowed in the plan section; each yields the token that a test title must contain.
const BULLETS = [
  [/^- API: `((?:GET|POST|PUT|PATCH|DELETE) \/\S*)`$/, m => m[1]],
  [/^- DB: migration `([\w.-]+)`$/, m => m[1]],
  [/^- DB: table `([A-Za-z_]\w*)`$/, m => m[1]],
  [/^- DB: column `([A-Za-z_]\w*\.[A-Za-z_]\w*)`$/, m => m[1]],
  [/^- DB: model `([\w.-]+)`$/, m => m[1]],
];

function readSection(planFile) {
  if (!fs.existsSync(planFile)) fail([`plan not found: ${planFile}`]);
  const lines = fs.readFileSync(planFile, 'utf8').split('\n');
  const start = lines.findIndex(l => /^##\s+DB and API changes\s*$/.test(l));
  if (start < 0) fail(["Plan has no '## DB and API changes' section"]);
  const bullets = [];
  for (let i = start + 1; i < lines.length && !/^##\s/.test(lines[i]); i++) {
    const l = lines[i].trim();
    if (l.startsWith('- ')) bullets.push(l);
  }
  if (!bullets.length) fail(["'## DB and API changes' has no bullets; write '- none' if nothing changes"]);
  const none = bullets.filter(b => b === '- none');
  if (none.length) {
    if (bullets.length > 1) fail(["'- none' cannot be combined with other bullets in '## DB and API changes'"]);
    return { none: true, tokens: [] };
  }
  const tokens = [], bad = [];
  for (const b of bullets) {
    const hit = BULLETS.map(([re, tok]) => { const m = re.exec(b); return m && tok(m); }).find(Boolean);
    if (hit) tokens.push(hit); else bad.push(`not an allowed bullet in '## DB and API changes': ${b}`);
  }
  if (bad.length) fail(bad);
  return { none: false, tokens };
}

const changedIntegrationFiles = testDir => {
  const dir = `${testDir.replace(/\/+$/, '')}/integration/`;
  const files = new Set(git('diff', '--name-only', 'HEAD', '--', dir).split('\n').filter(Boolean));
  git('ls-files', '--others', '--exclude-standard', '--', dir).split('\n').filter(Boolean).forEach(f => files.add(f));
  return [...files].filter(f => fs.existsSync(f));
};

// The token must be inside the title string of a describe/test/it call (not just somewhere on that line).
const TITLE = /\b(?:describe|test|it)(?:\.\w+)?\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
const titleHas = (src, token) => { TITLE.lastIndex = 0; let m; while ((m = TITLE.exec(src))) if (m[2].includes(token)) return true; return false; };

const isCode = line => { const t = line.trim(); return t !== '' && !/^(\/\/|\*|\/\*|--)/.test(t); };

// Source files changed since <redSha> by more than comments or whitespace (working tree included).
function sourceChanges(redSha) {
  const files = new Set();
  const out = git('diff', '-U0', '-w', '--ignore-blank-lines', '--no-color', redSha, '--', ...SOURCE_PATHS);
  let current = null;
  for (const line of out.split('\n')) {
    const header = /^diff --git a\/.* b\/(.*)$/.exec(line);
    if (header) { current = header[1]; continue; }
    if (/^(index |--- |\+\+\+ |@@|new file|deleted file|similarity|rename )/.test(line)) continue;
    if (/^[+-]/.test(line) && isCode(line.slice(1)) && current) files.add(current);
  }
  for (const f of git('ls-files', '--others', '--exclude-standard', '--', ...SOURCE_PATHS).split('\n').filter(Boolean)) {
    if (fs.readFileSync(f, 'utf8').split('\n').some(isCode)) files.add(f);
  }
  return [...files].sort();
}

const [, , cmd, a, b] = process.argv;

if (cmd === 'section') {
  console.log(readSection(a).none ? 'none' : 'required');
} else if (cmd === 'plan') {
  const sec = readSection(a);
  if (sec.none) { console.log('none'); process.exit(0); }
  const files = changedIntegrationFiles(b || 'server/__tests__');
  const sources = files.map(f => fs.readFileSync(f, 'utf8'));
  if (!files.length) fail([`the plan lists DB or API changes but no new or modified integration test was found under ${(b || 'server/__tests__').replace(/\/+$/, '')}/integration/`]);
  const missing = sec.tokens.filter(t => !sources.some(src => titleHas(src, t)));
  if (missing.length) fail(missing.map(t => `no integration test has "${t}" in a describe/test/it title (looked in: ${files.join(', ')})`));
  console.log('required');
} else if (cmd === 'diff') {
  if (!a || !b) fail(['usage: sdlc-integration-gate.cjs diff <red_sha> <orig_red_sha>']);
  const changed = sourceChanges(a);
  if (!changed.length) process.exit(0);
  const added = git('diff', '--name-only', `${b}~1`, b, '--', INTEGRATION_DIR).split('\n').filter(Boolean);
  if (!added.length) fail([
    `source changed (${changed.join(', ')}) but the Red tests commit ${b.slice(0, 7)} added no integration tests under ${INTEGRATION_DIR}`,
    'every database or API change needs integration tests written in the Red tests stage; rerun from Plan',
  ]);
} else {
  console.error('usage: sdlc-integration-gate.cjs section|plan|diff ...');
  process.exit(1);
}
