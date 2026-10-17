// Builds the review page: npm i --no-save marked@12.0.2, then node Docs/video/build-review-page.cjs Docs/video/sdlc-video-script.md Docs/video/thumbnails Docs/video/script-review.html
const fs = require('fs');
const { marked } = require('marked');
const [, , MD, TH, OUT] = process.argv;

let n = 0;
const svg = f => fs.readFileSync(`${TH}/${f}`, 'utf8').trim()
  .replace(/ width="\d+" height="\d+"/, ' role="img"')
  .replace(/id="g"/, () => `id="g${++n}"`).replace(/url\(#g\)/, `url(#g${n})`);
const shortTitles = [];
let md = fs.readFileSync(MD, 'utf8');
md = md.replace(/^### Short (\d+): "(.+?)" \((\d+ s)\)$/gm, (m, num, title, len) => {
  shortTitles[num] = title;
  return `${m}\n\n<!--thumb:${num}-->`;
});

const slug = s => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
let html = marked.parse(md);
const toc = [];
html = html.replace(/<h([23])>(.*?)<\/h\1>/g, (m, lv, inner) => {
  const id = slug(inner);
  toc.push({ lv: +lv, id, text: inner.replace(/<[^>]+>/g, '') });
  return `<h${lv} id="${id}">${inner}</h${lv}>`;
});
// The first h1 is replaced by the page header.
html = html.replace(/<h1>.*?<\/h1>/, '');
html = html.replace(/<p><strong>SCREEN:<\/strong>/g, '<p class="cue screen"><span class="cue-label">Screen</span>');
html = html.replace(/<p><strong>VO:<\/strong><\/p>/g, '<p class="cue vo"><span class="cue-label">Voice-over</span></p>');
html = html.replace(/<blockquote>/g, '<blockquote class="narration">');
html = html.replace(/\[R:(\w+)\]/g, '<span class="chip r" title="Remotion scene">$1</span>');
html = html.replace(/\[CAP\]/g, '<span class="chip cap" title="Screen capture">capture</span>');
html = html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
html = html.replace(/<!--thumb:(\d+)-->/g, (m, num) =>
  `<figure class="inline-thumb">${svg(`short-${num.padStart(2, '0')}.svg`)}<figcaption>short-${num.padStart(2, '0')}.svg</figcaption></figure>`);

const gallery = `
<section class="gallery" id="thumbnails" aria-labelledby="thumbs-h">
  <h2 id="thumbs-h">Thumbnails</h2>
  <p class="lede">Twelve SVGs in <code>Docs/video/thumbnails/</code>: one 1280 × 720 for the main video, one 1080 × 1920 cover per Short. Each Short's cover also sits next to its script below.</p>
  <figure class="main-thumb">${svg('main.svg')}<figcaption><b>Main video</b> · main.svg · 1280 × 720</figcaption></figure>
  <div class="shorts-grid">
    ${shortTitles.map((title, i) => title === undefined ? '' : `<figure><a href="#${toc.find(t => t.text.startsWith(`Short ${i}:`)).id}" aria-label="Short ${i} script">${svg(`short-${String(i).padStart(2, '0')}.svg`)}</a><figcaption><b>${String(i).padStart(2, '0')}</b> ${title}</figcaption></figure>`).join('\n    ')}
  </div>
</section>`;

// Captures cut from the screen recordings, published next to the page under captures/.
const capDir = require('path').dirname(TH) + '/captures';
const capFiles = fs.existsSync(capDir) ? fs.readdirSync(capDir).sort() : [];
const capLabel = {
  's01-sdlc-button.png': 'SDLC and CONFIG buttons', 's02-board-backlog.png': 'The board, backlog loaded',
  's03-ticket-brief.png': 'Ticket view: the brief', 's04-run-selected.png': 'Ticked, Run selected (1)',
  's05-starting.png': 'Starting add-json-logging…', 's06-started-in-spec.png': 'Toast, card lands in Spec',
  's07-pipeline-view.png': 'Pipeline view', 'c01-open-board.mp4': 'Open the board · 7 s',
  'c02-read-briefs.mp4': 'Read three briefs · 10 s at 1.6×', 'c03-select-and-run.mp4': 'Select and run · 15 s',
  'c04-pipeline-view.mp4': 'Open the pipeline · 8 s', 'c05-full-timelapse.mp4': 'Whole flow · 20 s at 2.2×',
  'v01-select-and-run-vertical.mp4': 'Vertical, for Short 6 · 15 s',
  's08-paused-questions.png': 'Paused: 7 questions', 's09-accept-suggested.png': 'Use suggested → accept suggested',
  's10-refused-actions.png': 'Spec agent refused 2 actions', 's11-allowed.png': 'Allowed',
  's12-spec-restarted.png': 'Spec restarts as spec-2', 's13-plan-running.png': 'Plan running',
  's14-board-plan-column.png': 'Card in the Plan column', 's15-plan-refused.png': 'Plan agent refused 2 actions',
  's16-one-more-to-decide.png': 'Allowed: 1 more to decide',
  'c06-paused-for-answers.mp4': 'Paused for answers · 6 s', 'c07-accept-suggested.mp4': 'Use suggested on Q1–Q4 · 7 s',
  'c08-allow-refused-actions.mp4': 'Allow all refused actions · 13 s', 'c09-spec-allow-always.mp4': 'Spec: Allow always, restart · 17 s',
  'c10-plan-running.mp4': 'Plan running, card in Plan · 8 s', 'c11-plan-allow-always.mp4': 'Plan: Allow always on each · 18 s',
  'v02-spec-questions-vertical.mp4': 'Vertical questions, for Short 3 · 10 s',
};
const captures = capFiles.length ? `
<section class="captures" id="captures" aria-labelledby="caps-h">
  <h2 id="caps-h">Captures</h2>
  <p class="lede">Cut from six recordings of the pane (start a task, Spec questions, refused actions, Plan), cropped to the pane so the usage warning and the permissions status line stay out of frame. Files in <code>Docs/video/captures/</code>.</p>
  <h3>Clips</h3>
  <div class="cap-grid">${capFiles.filter(f => f.endsWith('.mp4')).map(f =>
    `<figure class="${f.startsWith('v') ? 'tall' : ''}"><video src="captures/${f}" controls muted loop playsinline preload="metadata"></video><figcaption><b>${capLabel[f] || f}</b> ${f}</figcaption></figure>`).join('')}</div>
  <h3>Stills</h3>
  <div class="cap-grid">${capFiles.filter(f => f.endsWith('.png')).map(f =>
    `<figure><img src="captures/${f}" alt="${capLabel[f] || f}" loading="lazy"><figcaption><b>${capLabel[f] || f}</b> ${f}</figcaption></figure>`).join('')}</div>
</section>` : '';

const nav = toc.filter(t => t.lv === 2 || /^\d\. /.test(t.text) || /^Short \d+:/.test(t.text))
  .map(t => `<a class="l${t.lv}" href="#${t.id}">${t.text.replace(/^Short (\d+): &quot;(.+?)&quot;.*/, '$1 · $2').replace(/ \(\d+:\d+ to \d+:\d+\)$/, '')}</a>`).join('');

const page = `<title>Software Factory Script</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;800;900&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Serif:ital,wght@0,400;1,400&family=JetBrains+Mono:wght@500;700;800&display=swap">
<style>
/* Layout: a production binder. Sticky chapter rail on the left, script column on the right; thumbnails gallery first. */
:root {
  --bg: #f3f5f6; --surface: #ffffff; --ink: #121a1e; --muted: #56656d; --rule: #d7dee2;
  --accent: #0f7a52; --amber: #a86400; --amber-bg: #fff4e0; --screen-bg: #eaf0f3;
  --display: Archivo, 'Arial Black', Arial, sans-serif; --body: 'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif;
  --narr: 'IBM Plex Serif', Georgia, serif; --mono: 'JetBrains Mono', Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0c1316; --surface: #142027; --ink: #e8eef1; --muted: #93a6af; --rule: #263840;
  --accent: #3ddc84; --amber: #ffb547; --amber-bg: #2a2110; --screen-bg: #172830; color-scheme: dark } }
:root[data-theme="dark"] {
  --bg: #0c1316; --surface: #142027; --ink: #e8eef1; --muted: #93a6af; --rule: #263840;
  --accent: #3ddc84; --amber: #ffb547; --amber-bg: #2a2110; --screen-bg: #172830; color-scheme: dark }
body { background: var(--bg); color: var(--ink); font: 16px/1.6 var(--body); }
.wrap { max-width: 1240px; margin: 0 auto; padding-block: 40px 96px;
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
header.top { display: grid; gap: 10px; padding-bottom: 28px; border-bottom: 1px solid var(--rule); margin-bottom: 36px; }
.eyebrow { font: 700 12px/1 var(--mono); letter-spacing: .16em; text-transform: uppercase; color: var(--accent); }
header.top h1 { font: 900 clamp(34px, 6vw, 64px)/1 var(--display); margin: 0; text-wrap: balance; letter-spacing: -.01em; }
header.top p { margin: 0; color: var(--muted); max-width: 68ch; }
.meta { display: flex; flex-wrap: wrap; gap: 8px 18px; font: 500 13px/1.4 var(--mono); color: var(--muted); }
.layout { display: grid; grid-template-columns: 230px minmax(0, 1fr); gap: 48px; }
nav.rail { position: sticky; top: calc(env(safe-area-inset-top, 0px) + 20px); align-self: start; display: grid; gap: 2px;
  max-height: calc(100vh - 40px); overflow-y: auto; font-size: 13.5px; }
nav.rail a { color: var(--muted); text-decoration: none; padding: 4px 10px; border-radius: 6px; line-height: 1.35; }
nav.rail a:hover, nav.rail a:focus-visible { color: var(--ink); background: var(--surface); outline: none; }
nav.rail a.l2 { color: var(--ink); font-weight: 600; margin-top: 12px; }
nav.rail a:first-child { margin-top: 0; }
main { min-width: 0; }
main h2 { font: 800 30px/1.15 var(--display); margin: 56px 0 14px; text-wrap: balance; scroll-margin-top: 20px; }
main h3 { font: 800 21px/1.25 var(--display); margin: 40px 0 10px; text-wrap: balance; scroll-margin-top: 20px; }
main h4 { font: 600 16px/1.3 var(--body); margin: 28px 0 6px; color: var(--accent); }
main p, main li { max-width: 72ch; }
main hr { border: 0; border-top: 1px solid var(--rule); margin: 40px 0; }
code { font: 500 .88em var(--mono); background: var(--screen-bg); padding: .1em .35em; border-radius: 4px; overflow-wrap: anywhere; }
pre { background: var(--screen-bg); padding: 14px 16px; border-radius: 8px; overflow-x: auto; }
pre code { background: none; padding: 0; overflow-wrap: normal; }
.lede { color: var(--muted); }
.cue { display: block; }
.cue-label { display: inline-block; font: 700 11px/1 var(--mono); letter-spacing: .14em; text-transform: uppercase; margin-right: 10px; vertical-align: 2px; }
.cue.screen { background: var(--screen-bg); border-radius: 8px; padding: 12px 14px; font-size: 14.5px; color: var(--muted); }
.cue.screen .cue-label { color: var(--accent); }
.cue.vo { margin: 18px 0 4px; }
.cue.vo .cue-label { color: var(--amber); }
blockquote.narration { margin: 0 0 18px; padding: 2px 0 2px 20px; border-left: 3px solid var(--amber); font: 18px/1.65 var(--narr); }
blockquote.narration p { margin: 0 0 12px; }
blockquote.narration li { margin-bottom: 4px; }
.chip { display: inline-block; font: 700 11.5px/1.5 var(--mono); padding: 1px 8px; border-radius: 999px; vertical-align: 1px; white-space: nowrap; }
.chip.r { color: var(--accent); border: 1px solid var(--accent); }
.chip.cap { color: var(--amber); border: 1px solid var(--amber); }
.table-wrap { overflow-x: auto; margin: 14px 0 22px; border: 1px solid var(--rule); border-radius: 8px; background: var(--surface); }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--rule); vertical-align: top; }
th { font: 600 12px/1.3 var(--mono); text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
tr:last-child td { border-bottom: 0; }
figure { margin: 0; }
figure svg { display: block; width: 100%; height: auto; border-radius: 10px; }
figcaption { font: 500 12.5px/1.4 var(--mono); color: var(--muted); margin-top: 8px; }
figcaption b { color: var(--ink); }
.gallery h2 { margin-top: 0; }
.main-thumb { max-width: 880px; margin: 18px 0 30px; }
.shorts-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 22px 16px; }
.shorts-grid a { display: block; border-radius: 10px; }
.shorts-grid a:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
.shorts-grid a:hover svg { transform: translateY(-3px); }
.shorts-grid svg { transition: transform .15s ease; }
.cap-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); gap: 22px 16px; align-items: start; }
.cap-grid img, .cap-grid video { display: block; width: 100%; height: auto; border-radius: 8px; border: 1px solid var(--rule); background: #0c1316; }
.cap-grid figure.tall video { max-width: 260px; }
.inline-thumb { float: right; width: 190px; margin: 4px 0 16px 28px; }
main h3 + p, main h3 ~ ul { overflow-wrap: anywhere; }
main ul::after { content: ""; display: block; clear: both; }
@media (max-width: 1000px) { .shorts-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 860px) { .layout { grid-template-columns: minmax(0, 1fr); } nav.rail { display: none; } }
@media (max-width: 560px) { .shorts-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .inline-thumb { float: none; width: 60%; margin: 8px 0 14px; } blockquote.narration { font-size: 17px; } }
@media (prefers-reduced-motion: reduce) { .shorts-grid svg { transition: none; } .shorts-grid a:hover svg { transform: none; } }
</style>
<div class="wrap">
  <header class="top">
    <span class="eyebrow">Script review · draft 5</span>
    <h1>The Software Factory</h1>
    <p>Main YouTube video and eleven Shorts on the SDLC pipeline, the sdlc-monitor plugin and the /triage intake. Voice-over is set in serif, on-screen directions in tinted boxes. Green chips are Remotion scenes; amber chips are screen captures.</p>
    <div class="meta"><span>Main video ≈ 24 min · 16:9</span><span>11 Shorts · 45–60 s · 9:16</span><span>Source: Docs/video/sdlc-video-script.md</span></div>
  </header>
  <div class="layout">
    <nav class="rail" aria-label="Chapters"><a class="l2" href="#thumbnails">Thumbnails</a>${captures ? '<a class="l2" href="#captures">Captures</a>' : ''}${nav}</nav>
    <main>${gallery}${captures}${html}</main>
  </div>
</div>
`;
fs.writeFileSync(OUT, page);
console.log('wrote', OUT, Math.round(page.length / 1024) + ' KB', 'shorts', shortTitles.filter(Boolean).length);
