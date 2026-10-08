#!/usr/bin/env node
// Mechanical integration-test gates for scripts/sdlc.sh. Exit 0 = pass, 1 = reject (reasons on stderr).
//   plan <plan.md> <test_dir>        the plan's '## DB and API changes' section is well formed and every bullet's
//                                    token appears in a new or modified file under <test_dir>/integration/.
//                                    Prints NONE on stdout when the section is '- none' (nothing otherwise).
//   diff <red_sha> <orig_red_sha>    source changes since <red_sha> (DB or API paths, comments and whitespace ignored)
//                                    need integration tests in the original red-tests commit <orig_red_sha>.
const fs = require('fs');
const { execFileSync } = require('child_process');

const fail = msgs => { console.error(msgs.map(m => 'REJECT: ' + m).join('\n')); process.exit(1); };
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const usage = () => {
  console.error('usage: sdlc-integration-gate.cjs plan <plan.md> <test_dir>\n       sdlc-integration-gate.cjs diff <red_sha> <orig_red_sha>');
  process.exit(1);
};

const HEADING = '## DB and API changes';
const BULLETS = [
  ['API', /^- API: `([A-Z]+ \S+)`$/],
  ['migration', /^- DB: migration `([^`\s]+)`$/],
  ['table', /^- DB: table `([^`\s]+)`$/],
  ['column', /^- DB: column `([^`\s.]+\.[^`\s.]+)`$/],
  ['model', /^- DB: model `([^`\s]+)`$/],
  ['none', /^- none$/],
];

function parseSection(planFile) {
  const lines = fs.readFileSync(planFile, 'utf8').split('\n').map(l => l.replace(/\s+$/, ''));
  const start = lines.indexOf(HEADING);
  if (start < 0) fail([`Plan has no '${HEADING}' section`]);
  const body = [];
  for (let i = start + 1; i < lines.length && !lines[i].startsWith('## '); i++) if (lines[i].trim()) body.push(lines[i]);
  const bullets = [], errs = [];
  for (const line of body) {
    const hit = BULLETS.map(([kind, re]) => [kind, re.exec(line)]).find(([, m]) => m);
    if (hit) bullets.push({ line, kind: hit[0], token: hit[1][1] });
    else errs.push(`malformed line in '${HEADING}': ${line}`);
  }
  if (!body.length) errs.push(`'${HEADING}' section is empty (use '- none' when nothing changes)`);
  const none = bullets.some(b => b.kind === 'none');
  if (none && bullets.length > 1) errs.push(`'- none' cannot be combined with other bullets in '${HEADING}'`);
  if (errs.length) fail(errs);
  return { bullets, none };
}

function changedIntegrationFiles(testDir) {
  return git('diff', 'HEAD', '--name-only', '--', `${testDir}/integration/`)
    .split('\n').filter(f => f && fs.existsSync(f));
}

function cmdPlan(planFile, testDir) {
  const { bullets, none } = parseSection(planFile);
  if (none) { console.log('NONE'); return; }
  const text = changedIntegrationFiles(testDir).map(f => fs.readFileSync(f, 'utf8')).join('\n');
  const errs = bullets.filter(b => !text.includes(b.token))
    .map(b => `bullet \`${b.token}\` (${b.line}) is not in any new or modified file under ${testDir}/integration/`);
  if (errs.length) fail(errs);
}

const SOURCE_PATHS = ['server/migrations/', 'server/schema.sql', 'server/models/', 'server/index.js', 'server/middleware/', 'server/validation.js'];
const COMMENT = /^(\/\/|\*|\/\*|--)/;

function sourceChanges(redSha) {
  const out = git('diff', '--no-renames', '-U0', '-w', '--ignore-blank-lines', redSha, '--', ...SOURCE_PATHS);
  const files = new Set();
  let file = null, inHunk = false;
  for (const line of out.split('\n')) {
    const h = /^diff --git a\/(.+) b\/\1$/.exec(line);
    if (h) { file = h[1]; inHunk = false; continue; }
    if (line.startsWith('@@')) { inHunk = true; continue; }
    if (!file || !inHunk || (line[0] !== '+' && line[0] !== '-')) continue;
    if (!COMMENT.test(line.slice(1).trim())) files.add(file);
  }
  return files;
}

function cmdDiff(redSha, origRedSha) {
  const files = sourceChanges(redSha);
  if (!files.size) return;
  const added = git('diff', '--name-only', `${origRedSha}~1`, origRedSha, '--', 'server/__tests__/integration/').trim();
  if (added) return;
  fail([...files].map(f => `${f} changed but the original red-tests commit has no integration tests`)
    .concat('add integration tests: rerun from Plan (FROM=plan)'));
}

const [, , cmd, a, b] = process.argv;
if (cmd === 'plan' && a && b) cmdPlan(a, b);
else if (cmd === 'diff' && a && b) cmdDiff(a, b);
else usage();
