// Generates the YouTube thumbnail SVGs for the SDLC video: node Docs/video/thumbnails/generate.cjs Docs/video/thumbnails
const fs = require('fs');
const path = require('path');
const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });

const C = {
  bg: '#0c1316', panel: '#152129', panel2: '#1b2a33', line: '#2a3c46', ink: '#eef3f5', muted: '#90a4ae',
  red: '#ff5f5f', green: '#3ddc84', amber: '#ffb547', blue: '#74b9ff',
};
const DISPLAY = "Archivo, 'Arial Black', 'Helvetica Neue', Arial, sans-serif";
const MONO = "'JetBrains Mono', 'DejaVu Sans Mono', Menlo, Consolas, monospace";
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function t(x, y, s, o = {}) {
  const a = [`x="${x}"`, `y="${y}"`, `fill="${o.fill || C.ink}"`, `font-size="${o.size || 32}"`,
    `font-family="${esc(o.mono ? MONO : DISPLAY)}"`, `font-weight="${o.weight || (o.mono ? 500 : 800)}"`];
  if (o.anchor) a.push(`text-anchor="${o.anchor}"`);
  if (o.ls) a.push(`letter-spacing="${o.ls}"`);
  return `<text ${a.join(' ')}>${esc(s)}</text>`;
}
const rect = (x, y, w, h, o = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.rx ?? 14}" fill="${o.fill || C.panel}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw || 3}"` : ''}/>`;
const check = (cx, cy, r, color = C.green) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/><path d="M${cx - r * 0.45} ${cy} l${r * 0.32} ${r * 0.34} l${r * 0.6} ${-r * 0.66}" fill="none" stroke="${C.bg}" stroke-width="${r * 0.28}" stroke-linecap="round" stroke-linejoin="round"/>`;
const cross = (cx, cy, r, color = C.red) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/><path d="M${cx - r * 0.38} ${cy - r * 0.38} L${cx + r * 0.38} ${cy + r * 0.38} M${cx + r * 0.38} ${cy - r * 0.38} L${cx - r * 0.38} ${cy + r * 0.38}" stroke="${C.bg}" stroke-width="${r * 0.28}" stroke-linecap="round"/>`;
const lock = (x, y, s, color = C.amber) =>
  `<path d="M${x + s * 0.25} ${y + s * 0.45} v${-s * 0.15} a${s * 0.25} ${s * 0.25} 0 0 1 ${s * 0.5} 0 v${s * 0.15}" fill="none" stroke="${color}" stroke-width="${s * 0.1}"/>` +
  `<rect x="${x + s * 0.12}" y="${y + s * 0.42}" width="${s * 0.76}" height="${s * 0.55}" rx="${s * 0.08}" fill="${color}"/>`;
const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
  `<defs><pattern id="g" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="${C.line}" stroke-width="1" opacity="0.45"/></pattern></defs>` +
  `<rect width="${w}" height="${h}" fill="${C.bg}"/><rect width="${w}" height="${h}" fill="url(#g)"/>${body}</svg>\n`;

// ---------- main thumbnail, 1280 x 720 ----------
function mainThumb() {
  let b = '';
  b += t(64, 92, 'OPEN-SOURCE AI SDLC PIPELINE', { mono: true, size: 26, fill: C.muted, ls: 3 });
  b += t(60, 214, 'SOFTWARE', { size: 100, weight: 900 });
  b += t(60, 324, 'FACTORY', { size: 100, weight: 900, fill: C.green });
  b += t(64, 424, 'AI agents that can’t', { size: 44, fill: C.amber });
  b += t(64, 478, 'cheat their own tests', { size: 44, fill: C.amber });
  // test panel
  b += rect(752, 112, 468, 420, { fill: C.panel, stroke: C.line });
  b += t(784, 160, '$ npm test', { mono: true, size: 24, fill: C.muted });
  b += t(1028, 160, 'RED', { mono: true, size: 20, fill: C.red, anchor: 'middle', weight: 700 });
  b += t(1140, 160, 'GREEN', { mono: true, size: 20, fill: C.green, anchor: 'middle', weight: 700 });
  const rows = ['missing name', 'blank name', 'extra fields', 'auth first'];
  rows.forEach((r, i) => {
    const y = 210 + i * 62;
    b += rect(776, y - 30, 420, 50, { fill: C.panel2, rx: 10 });
    b += t(796, y + 3, r, { mono: true, size: 24 });
    b += cross(1028, y - 5, 15);
    b += `<path d="M1056 ${y - 5} h44 m-12 -10 l12 10 l-12 10" fill="none" stroke="${C.muted}" stroke-width="3" stroke-linecap="round"/>`;
    b += check(1140, y - 5, 15);
  });
  b += lock(784, 448, 44);
  b += t(840, 482, 'tests locked · a1b2c3d', { mono: true, size: 24, fill: C.amber });
  // conveyor of stages
  const st = ['Spec', 'Plan', 'Red tests', 'Implement', 'Test repair', 'Review', 'Ship'];
  b += `<line x1="96" y1="610" x2="1184" y2="610" stroke="${C.line}" stroke-width="6" stroke-linecap="round"/>`;
  st.forEach((s, i) => {
    const x = 96 + i * (1088 / 6);
    b += check(x, 610, 18, s === 'Test repair' ? C.amber : C.green);
    b += t(x, 668, s, { mono: true, size: 22, fill: C.muted, anchor: 'middle' });
  });
  return svg(1280, 720, b);
}

// ---------- Shorts, 1080 x 1920 ----------
function short(n, hook, accentLine, payoff, art) {
  let b = '';
  b += t(80, 150, `SHORT ${String(n).padStart(2, '0')} · SDLC PIPELINE`, { mono: true, size: 32, fill: C.green, ls: 3, weight: 700 });
  hook.forEach((l, i) => { b += t(72, 300 + i * 112, l, { size: 100, weight: 900, fill: i === accentLine ? C.amber : C.ink }); });
  b += art;
  payoff.forEach((l, i) => { b += t(80, 1700 + i * 62, l, { size: 50, fill: C.amber }); });
  b += `<line x1="80" y1="1800" x2="1000" y2="1800" stroke="${C.line}" stroke-width="2"/>`;
  b += t(80, 1856, 'Open source · full video on the channel', { mono: true, size: 30, fill: C.muted });
  return svg(1080, 1920, b);
}
const box = (y, h) => rect(60, y, 960, h, { fill: C.panel, stroke: C.line });

const shorts = [];

// 1 software factory
{
  let a = '';
  const s = ['Requirements', 'Design', 'Tests', 'Code', 'Review', 'Release'];
  a += `<line x1="170" y1="840" x2="170" y2="1500" stroke="${C.line}" stroke-width="8"/>`;
  s.forEach((name, i) => {
    const y = 840 + i * 132;
    a += rect(240, y - 46, 560, 92, { fill: C.panel, stroke: C.line, rx: 16 });
    a += t(276, y + 14, name, { size: 46 });
    a += check(170, y, 30);
    a += t(840, y + 12, 'gate', { mono: true, size: 28, fill: C.muted });
  });
  shorts.push(short(1, ['WHAT IS A', 'SOFTWARE', 'FACTORY?'], 1, ['The line and the inspections,', 'not the workers.'], a));
}
// 2 homework
{
  let a = box(820, 760);
  ['rejects missing name', 'rejects blank name', 'ignores password', 'auth runs first'].forEach((r, i) => {
    const y = 900 + i * 96;
    a += cross(130, y, 26);
    a += t(180, y + 12, r, { mono: true, size: 38 });
  });
  a += lock(100, 1268, 64);
  a += t(190, 1316, 'test(fix-user-validation)', { mono: true, size: 34, fill: C.amber });
  a += t(190, 1362, 'add failing tests · a1b2c3d', { mono: true, size: 30, fill: C.muted });
  a += rect(100, 1430, 880, 100, { fill: C.red, rx: 12 });
  a += t(540, 1495, 'GUARD FAILED: tests modified', { mono: true, size: 38, fill: C.bg, anchor: 'middle', weight: 800 });
  shorts.push(short(2, ['AI CAN’T', 'GRADE ITS', 'OWN', 'HOMEWORK'], 3, ['Make cheating detectable.'], a));
}
// 3 asks before it codes
{
  let a = '';
  const q = [['Q1  What is a valid name?', 'Suggested: a non-empty string'], ['Q2  Extra fields like password?', 'Suggested: ignored, not stored'],
    ['Q4  Auth before validation?', 'Suggested: auth runs first']];
  q.forEach(([qq, ss], i) => {
    const y = 760 + i * 230;
    a += rect(60, y, 960, 196, { fill: C.panel, stroke: C.line });
    a += t(100, y + 72, qq, { mono: true, size: 38, weight: 700 });
    a += t(100, y + 132, ss, { mono: true, size: 32, fill: C.green });
    a += t(100, y + 174, 'Answer: accept', { mono: true, size: 26, fill: C.muted });
  });
  a += t(540, 1500, '+ 3 more questions', { mono: true, size: 34, fill: C.muted, anchor: 'middle' });
  shorts.push(short(3, ['IT ASKS', 'BEFORE', 'IT CODES'], 2, ['6 questions from one', 'vague bug report.'], a));
}
// 4 the test is wrong
{
  let a = '';
  const links = ['Flaky re-run', 'Pre-check: max 3 claims', 'Source untouched', 'Diff check', 'Name check', 'Red check', 'Independent audit'];
  links.forEach((l, i) => {
    const y = 780 + i * 92;
    a += `<rect x="90" y="${y - 32}" width="96" height="58" rx="29" fill="none" stroke="${C.green}" stroke-width="10"/>`;
    a += t(230, y + 12, l, { mono: true, size: 38 });
  });
  a += rect(140, 1440, 800, 120, { fill: 'none', stroke: C.green, sw: 8, rx: 10 });
  a += t(540, 1520, 'VERDICT: VALID', { mono: true, size: 64, fill: C.green, anchor: 'middle', weight: 800 });
  shorts.push(short(4, ['WHEN AI SAYS', '“THE TEST', 'IS WRONG”'], 1, ['If in any doubt: INVALID.'], a));
}
// 5 bash is the boss
{
  let a = box(720, 520);
  a += t(100, 790, 'scripts/sdlc.sh', { mono: true, size: 30, fill: C.muted });
  [['if tests_pass; then', C.blue], ['  echo "RED GATE FAILED"', C.red], ['  exit 1', C.ink], ['fi', C.blue], ['agent impl-1 implement', C.green]].forEach(([l, c], i) => {
    a += t(100, 870 + i * 70, l, { mono: true, size: 40, fill: c });
  });
  const ag = ['Spec', 'Plan', 'Tests', 'Code', 'Review'];
  ag.forEach((g, i) => {
    const x = 156 + i * 192, on = i === 3;
    a += `<circle cx="${x}" cy="1380" r="62" fill="${on ? C.green : C.panel2}" stroke="${on ? C.green : C.line}" stroke-width="4"/>`;
    a += `<circle cx="${x - 20}" cy="1370" r="9" fill="${on ? C.bg : C.muted}"/><circle cx="${x + 20}" cy="1370" r="9" fill="${on ? C.bg : C.muted}"/>`;
    a += t(x, 1490, g, { mono: true, size: 30, fill: on ? C.green : C.muted, anchor: 'middle' });
  });
  shorts.push(short(5, ['MY AI', 'AGENTS', 'HAVE A', 'BASH BOSS'], 3, ['Agents propose.', 'Gates dispose.'], a));
}
// 6 mission control
{
  let a = rect(60, 760, 960, 820, { fill: C.panel, stroke: C.line, rx: 18 });
  a += rect(60, 760, 960, 80, { fill: C.panel2, rx: 18 });
  a += t(100, 812, 'SDLC · fix-user-validation', { mono: true, size: 32, weight: 700 });
  const chips = [['Spec', C.green], ['Plan', C.green], ['Red tests', C.green], ['Implement', C.amber], ['Review', C.line], ['Commit', C.line]];
  chips.forEach(([c, col], i) => {
    const x = 100 + (i % 3) * 300, y = 880 + Math.floor(i / 3) * 96;
    a += rect(x, y, 270, 72, { fill: col === C.line ? C.panel2 : col, rx: 36 });
    a += t(x + 135, y + 48, c, { mono: true, size: 30, anchor: 'middle', fill: col === C.line ? C.muted : C.bg, weight: 700 });
  });
  a += rect(100, 1110, 880, 28, { fill: C.panel2, rx: 14 }) + rect(100, 1110, 560, 28, { fill: C.green, rx: 14 });
  a += t(100, 1200, 'Implement · attempt 2/4 · 03:12', { mono: true, size: 34 });
  a += t(100, 1256, 'tests 14/17 passing', { mono: true, size: 30, fill: C.muted });
  [['Answer', C.amber], ['Stop', C.red], ['Resume', C.green]].forEach(([l, col], i) => {
    const x = 100 + i * 300;
    a += rect(x, 1340, 270, 100, { fill: 'none', stroke: col, sw: 4, rx: 12 });
    a += t(x + 135, 1404, l, { size: 40, fill: col, anchor: 'middle' });
  });
  a += t(100, 1530, 'Allow this run · Allow always · Deny', { mono: true, size: 30, fill: C.muted });
  shorts.push(short(6, ['MISSION', 'CONTROL IN', 'CLAUDE CODE'], 2, ['Start, watch, answer, stop.'], a));
}
// 7 worktrees
{
  let a = '';
  a += rect(80, 760, 300, 90, { fill: C.panel2, stroke: C.line, rx: 45 });
  a += t(230, 818, 'main', { mono: true, size: 40, anchor: 'middle', weight: 700 });
  a += `<path d="M230 850 V1500" stroke="${C.line}" stroke-width="10" fill="none"/>`;
  [[1040, 'sdlc/add-db-health-check', C.green], [1340, 'sdlc/fix-pagination-limits', C.blue]].forEach(([y, br, col]) => {
    a += `<path d="M230 ${y - 140} C 230 ${y - 40}, 260 ${y}, 330 ${y}" stroke="${col}" stroke-width="10" fill="none"/>`;
    a += `<circle cx="230" cy="${y - 140}" r="16" fill="${col}"/>`;
    a += rect(330, y - 80, 680, 170, { fill: C.panel, stroke: col, rx: 16 });
    a += t(360, y - 18, br, { mono: true, size: 32, fill: col, weight: 700 });
    a += t(360, y + 40, '../repo-sdlc/<slug>/', { mono: true, size: 30, fill: C.muted });
  });
  shorts.push(short(7, ['TWO', 'FEATURES,', 'ZERO', 'CONFLICTS'], 3, ['One git worktree', 'per pipeline.'], a));
}
// 8 bring your own model
{
  let a = box(740, 560);
  [['Spec', 'opus'], ['Plan', 'opus'], ['Red tests', 'sonnet'], ['Implement', 'gateway/your-model'], ['Test audit', 'opus'], ['Review', 'opus']].forEach(([s, m], i) => {
    const y = 820 + i * 80;
    a += t(100, y, s, { mono: true, size: 36 });
    a += t(980, y, m, { mono: true, size: 36, anchor: 'end', fill: m.includes('/') ? C.amber : C.blue });
  });
  a += rect(60, 1350, 960, 230, { fill: C.panel2, stroke: C.amber, rx: 16 });
  a += lock(96, 1384, 70);
  a += t(196, 1430, 'api_key_env: GATEWAY_KEY', { mono: true, size: 34, fill: C.amber });
  a += t(196, 1490, 'the key itself is never stored', { mono: true, size: 30, fill: C.muted });
  a += t(196, 1540, 'https only (http: localhost)', { mono: true, size: 30, fill: C.muted });
  shorts.push(short(8, ['BRING', 'YOUR OWN', 'MODEL'], 2, ['Keep your keys.'], a));
}
// 9 won't commit .env
{
  let a = box(760, 800);
  a += t(100, 830, 'Ship stage', { mono: true, size: 30, fill: C.muted });
  [['server/index.js', 1], ['server/__tests__/users.test.js', 1], ['.env.example  (change-me)', 1],
    ['.env  (sensitive file)', 0], ['id_rsa  (sensitive file)', 0], ['.claude/  (agent config)', 0], ['dump.sql  (over 1 MiB)', 0]].forEach(([f, ok], i) => {
    const y = 910 + i * 92;
    a += ok ? check(126, y, 26) : cross(126, y, 26);
    a += t(180, y + 12, f, { mono: true, size: 34, fill: ok ? C.ink : C.muted });
  });
  shorts.push(short(9, ['IT WON’T', 'COMMIT', 'YOUR .ENV'], 2, ['Ship commits only', 'what the cycle built.'], a));
}
// 10 ai-sdlc-helper
{
  let a = '';
  a += rect(60, 760, 440, 220, { fill: C.panel, stroke: C.green, rx: 16 });
  a += t(100, 830, 'npm', { mono: true, size: 30, fill: C.muted });
  a += t(100, 890, 'engine', { size: 54 });
  a += t(100, 940, 'CLI · adapters', { mono: true, size: 28, fill: C.muted });
  a += t(540, 890, '+', { size: 80, anchor: 'middle', fill: C.muted });
  a += rect(580, 760, 440, 220, { fill: C.panel, stroke: C.blue, rx: 16 });
  a += t(620, 830, 'Claude Code', { mono: true, size: 30, fill: C.muted });
  a += t(620, 890, 'plugin', { size: 54 });
  a += t(620, 940, 'pane · guard', { mono: true, size: 28, fill: C.muted });
  a += t(80, 1070, 'HELP WANTED', { mono: true, size: 32, fill: C.amber, ls: 4, weight: 700 });
  ['Adapters', 'Prompts', 'Pane UI', 'Windows', 'Docs', 'Try it'].forEach((l, i) => {
    const x = 60 + (i % 2) * 490, y = 1110 + Math.floor(i / 2) * 150;
    a += rect(x, y, 470, 126, { fill: C.panel2, stroke: C.line, rx: 14 });
    a += t(x + 40, y + 80, l, { size: 48 });
  });
  shorts.push(short(10, ['HELP US', 'BUILD', 'AI-SDLC-', 'HELPER'], 2, ['MIT licensed.', 'Contributors wanted.'], a));
}

fs.writeFileSync(path.join(OUT, 'main.svg'), mainThumb());
shorts.forEach((s, i) => fs.writeFileSync(path.join(OUT, `short-${String(i + 1).padStart(2, '0')}.svg`), s));
console.log('wrote', 1 + shorts.length, 'files to', OUT);
