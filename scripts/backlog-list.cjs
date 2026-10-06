#!/usr/bin/env node
// Lists the items in Docs/backlog/index.md with a derived status. Read-only.
//   node scripts/backlog-list.cjs [status[,status...]] [--status <list>] [--json]
// Exit 0 = ok, 1 = index missing, 2 = bad arguments. BACKLOG_ROOT overrides the repo root.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const USAGE = 'Usage: backlog-list [status[,status...]] [--status <list>] [--json]';
const STATUSES = ['pending', 'in-progress', 'blocked', 'completed'];
const ALIASES = { open: 'pending', done: 'completed' };

const usageError = message => Object.assign(new Error(message), { code: 2 });
const resolveRoot = env => env.BACKLOG_ROOT || path.join(__dirname, '..');

function parseIndex(text) {
  const items = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^- \[( |x|X|!)\] `([^`]+)`(?: - (.*))?$/);
    if (m) items.push({ marker: m[1], slug: m[2], rest: m[3] || '' });
  }
  return items;
}

function parseTitle(rest) {
  let title = rest;
  let type = null;
  const prefix = title.match(/^(bug|feature):\s*/i);
  if (prefix) {
    type = prefix[1].toLowerCase();
    title = title.slice(prefix[0].length);
  }
  let blockedReason = '';
  const blocked = title.match(/\s*\(blocked:\s*(.*)\)\s*$/);
  if (blocked) {
    blockedReason = blocked[1].trim();
    title = title.slice(0, blocked.index);
  }
  return { type, title: title.trim(), blockedReason };
}

// A slug is used as a folder name and in a git ref pattern: reject separators, "..", and glob characters.
const safeSlug = slug => !/[\\/*?[\]]/.test(slug) && slug !== '..' && slug !== '.';

function parseBrief(root, slug) {
  if (!safeSlug(slug)) return { hasBrief: false, type: null, priority: null };
  const file = path.join(root, 'Docs', 'backlog', slug, 'brief.md');
  if (!fs.existsSync(file)) return { hasBrief: false, type: null, priority: null };
  const text = fs.readFileSync(file, 'utf8');
  const typeLine = text.match(/^\s*Type:[ \t]*(\S+)/im);
  const priLine = text.match(/^\s*Priority:[ \t]*(.*)$/im);
  const pri = priLine && priLine[1].match(/\bP[0-3]\b/);
  return {
    hasBrief: true,
    type: typeLine ? typeLine[1].toLowerCase() : null,
    priority: pri ? pri[0] : null,
  };
}

const branchCache = new Map();
function branchExists(root, slug) {
  const key = `${root}\0${slug}`;
  if (!safeSlug(slug)) return false;
  if (branchCache.has(key)) return branchCache.get(key);
  const list = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  let found = false;
  try {
    found = !!list(['branch', '--list', `sdlc/${slug}`]) || !!list(['branch', '-r', '--list', `origin/sdlc/${slug}`]);
  } catch (e) {
    found = false;
  }
  branchCache.set(key, found);
  return found;
}

function deriveItem(entry, root) {
  const { type, title, blockedReason } = parseTitle(entry.rest);
  const brief = parseBrief(root, entry.slug);
  let status;
  if (entry.marker === 'x' || entry.marker === 'X') status = 'completed';
  else if (entry.marker === '!') status = 'blocked';
  else status = branchExists(root, entry.slug) ? 'in-progress' : 'pending';
  return {
    status,
    slug: entry.slug,
    type: type || brief.type,
    priority: brief.priority,
    title,
    note: [blockedReason, brief.hasBrief ? null : 'no brief'].filter(Boolean).join('; '),
    hasBrief: brief.hasBrief,
  };
}

function notInIndex(root, entries) {
  const indexed = new Set(entries.map(e => e.slug));
  const dir = path.join(root, 'Docs', 'backlog');
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !indexed.has(d.name) && fs.existsSync(path.join(dir, d.name, 'brief.md')))
    .map(d => d.name)
    .sort();
}

function normalizeStatuses(raw) {
  const out = new Set();
  for (const part of raw.split(',')) {
    const v = part.toLowerCase();
    if (v === 'all') STATUSES.forEach(s => out.add(s));
    else if (STATUSES.includes(v)) out.add(v);
    else if (ALIASES[v]) out.add(ALIASES[v]);
    else throw usageError(`Unknown status "${part}". Valid: ${STATUSES.join(', ')}, all`);
  }
  return out;
}

function parseArgs(argv) {
  let positional = null;
  let status = null;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') json = true;
    else if (a === '--status') {
      const v = argv[i + 1];
      if (status !== null || v === undefined || v.startsWith('-')) throw usageError(USAGE);
      status = v;
      i++;
    } else if (a.startsWith('-')) throw usageError(USAGE);
    else if (positional !== null) throw usageError(USAGE);
    else positional = a;
  }
  if (positional !== null && status !== null) throw usageError(USAGE);
  const raw = positional !== null ? positional : status;
  return { statuses: normalizeStatuses(raw === null ? 'all' : raw), raw, json };
}

function formatTable(items, all, extras, rawFilter) {
  const count = s => all.filter(i => i.status === s).length;
  const footer = `pending ${count('pending')} · in-progress ${count('in-progress')} · blocked ${count('blocked')} · completed ${count('completed')} · total ${all.length}`;
  const lines = [];
  if (!items.length) {
    lines.push(`No items with status: ${rawFilter}`);
  } else {
    const rows = [['STATUS', 'SLUG', 'TYPE', 'PRI', 'TITLE', 'NOTE']].concat(
      items.map(i => [i.status, i.slug, i.type || '-', i.priority || '-', i.title, i.note])
    );
    const widths = rows[0].map((_, c) => Math.max(...rows.map(r => r[c].length)));
    for (const r of rows) lines.push(r.map((cell, c) => cell.padEnd(widths[c])).join('  ').trimEnd());
  }
  lines.push('', footer);
  if (extras.length) lines.push(`Not in index: ${extras.join(', ')}`);
  return lines.join('\n') + '\n';
}

const formatJson = items => JSON.stringify(items.map(i => ({
  status: i.status,
  slug: i.slug,
  type: i.type || null,
  priority: i.priority || null,
  title: i.title,
  note: i.note || '',
  hasBrief: i.hasBrief,
}))) + '\n';

function main(argv, env = process.env, io = { out: s => process.stdout.write(s), err: s => process.stderr.write(s) }) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    io.err(`${e.message}\n`);
    return e.code || 2;
  }
  const root = resolveRoot(env);
  const indexFile = path.join(root, 'Docs', 'backlog', 'index.md');
  if (!fs.existsSync(indexFile)) {
    io.err('Docs/backlog/index.md not found\n');
    return 1;
  }
  const entries = parseIndex(fs.readFileSync(indexFile, 'utf8'));
  const all = entries.map(e => deriveItem(e, root));
  const shown = all.filter(i => args.statuses.has(i.status));
  const filterText = args.raw === null ? 'all' : args.raw;
  io.out(args.json ? formatJson(shown) : formatTable(shown, all, notInIndex(root, entries), filterText));
  return 0;
}

module.exports = { parseIndex, parseTitle, parseBrief, parseArgs, normalizeStatuses, formatTable, formatJson, main };

if (require.main === module) process.exitCode = main(process.argv.slice(2), process.env);
