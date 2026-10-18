#!/usr/bin/env node
// Permission requests of the SDLC agents: what a headless `claude -p` agent was refused, and what the developer decided.
// Usage: node scripts/sdlc-permissions.cjs extract <agent.json> <log> <state.json> <stage> <cwd> [<stderr file>]
//        | args <docs-dir> <stage> [<repo-rules.json>] | mode <docs-dir> <stage> | list <state.json> | decide <state.json> <n|all> allow|always|deny [<repo-rules.json>]
// The state file (Docs/backlog/<slug>/logs/permissions.json) holds: pending (asks not decided yet), allow (rules for this run),
// bypass (stage keys run without permission checks), denied (asks refused). Rules are never secrets: a tool name and a path or command.
// Exit 0 ok, 1 on an error. `extract` prints the number of pending asks.
const fs = require('fs');
const path = require('path');

const REPO_RULES = '.claude/sdlc-permissions.json';
const PATH_TOOLS = ['Edit', 'Write', 'NotebookEdit', 'MultiEdit'];

const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
};
const emptyState = () => ({ pending: [], allow: [], bypass: [], denied: [] });
const loadState = file => {
  const s = readJson(file, null);
  const e = emptyState();
  if (!s || typeof s !== 'object') return e;
  for (const k of Object.keys(e)) if (Array.isArray(s[k])) e[k] = s[k];
  return e;
};
const saveState = (file, s) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(s, null, 2)}\n`);
};

// The parts of a shell command line, split on ; && || | & and newlines outside quotes.
function commandParts(command) {
  const parts = [];
  let cur = '';
  let quote = '';
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = '';
      else if (c === '\\' && quote === '"') { cur += c + (command[i + 1] || ''); i++; continue; }
    } else if (c === "'" || c === '"') {
      quote = c;
    } else if (c === '\\') {
      cur += c + (command[i + 1] || ''); i++; continue;
    } else if (';|&\n'.includes(c)) {
      parts.push(cur); cur = '';
      continue;
    }
    cur += c;
  }
  parts.push(cur);

  return parts.map(x => x.trim()).filter(Boolean);
}

// The rule for one command: its first one or two words.
function commandRule(command) {
  const words = command.split(/\s+/);
  const head = words[0] && /^[\w./-]+$/.test(words[0]) ? [words[0]] : [];
  if (head.length && words[1] && /^[a-z][\w-]*$/.test(words[1])) head.push(words[1]);

  return head.length ? `Bash(${head.join(' ')}:*)` : 'Bash';
}

// Whether an allow rule (`Bash(prefix:*)`, `Bash(prefix *)` or an exact `Bash(command)`) already covers one command.
function covers(rule, command) {
  const m = /^Bash\((.*)\)$/.exec(rule);
  if (!m) return false;
  const prefix = m[1].replace(/(:\*| \*)$/, '');
  if (prefix === m[1]) return command === prefix;

  return command === prefix || command.startsWith(`${prefix} `);
}

// The denial as a short, narrow allow rule: the path for a file tool, the first command words for Bash, else the tool name.
// For a command line with several commands, the first one that no rule in `allowed` covers: naming an allowed one (the
// `cd` of `cd x; sed ...`) would grant nothing, and the agent would be refused again.
function ruleFor(tool, input, cwd, allowed = []) {
  const i = input && typeof input === 'object' ? input : {};
  if (PATH_TOOLS.includes(tool)) {
    const p = typeof i.file_path === 'string' ? i.file_path : typeof i.notebook_path === 'string' ? i.notebook_path : '';
    if (!p) return tool;
    const rel = path.isAbsolute(p) ? path.relative(cwd, p) : p;

    return `${tool}(./${rel.replace(/^\.\//, '')})`;
  }
  if (tool === 'Bash' && typeof i.command === 'string') {
    const parts = commandParts(i.command.trim());
    if (!parts.length) return 'Bash';
    const open = parts.find(c => !allowed.some(r => covers(r, c)));

    return commandRule(open || parts[0]);
  }

  return tool;
}

// Whether a refused command line is already decided: every part is covered by a rule, and one of the developer's run rules
// covers a part (so the refusal the developer allowed is not asked again under the name of another, allowed part).
function decidedLine(tool, input, allowed, runRules) {
  if (tool !== 'Bash' || !input || typeof input.command !== 'string') return false;
  const parts = commandParts(input.command.trim());
  const all = [...allowed, ...runRules];

  return parts.length > 0 && parts.every(c => all.some(r => covers(r, c))) && parts.some(c => runRules.some(r => covers(r, c)));
}

// What the person is shown: the file, the command, or the tool's input in one line.
function detailFor(tool, input, cwd) {
  const i = input && typeof input === 'object' ? input : {};
  const p = typeof i.file_path === 'string' ? i.file_path : typeof i.notebook_path === 'string' ? i.notebook_path : '';
  if (p) return path.isAbsolute(p) ? path.relative(cwd, p) : p;
  if (typeof i.command === 'string') return i.command.replace(/\s+/g, ' ').trim().slice(0, 200);

  return JSON.stringify(i).slice(0, 200);
}

// A path under a `.claude/` folder is refused as a "sensitive file" even when an allow rule names it: only a bypass of the checks lifts it.
const isProtected = (tool, detail) => PATH_TOOLS.includes(tool) && /(^|\/)\.claude\//.test(detail);

// Reads the agent's `--output-format json` result: writes its text to `log`, and records the denials as pending asks (unless decided).
// A file that is not JSON (an older agent, a provider error) is copied to the log unchanged.
// `allowed` holds the rules the agent ran with, so a refused command line is named by its part that was not allowed.
function extract({ jsonFile, logFile, stateFile, stage, cwd, errFile, allowed = [] }) {
  const raw = fs.existsSync(jsonFile) ? fs.readFileSync(jsonFile, 'utf8') : '';
  const err = errFile && fs.existsSync(errFile) ? fs.readFileSync(errFile, 'utf8') : '';
  let data = null;
  try { data = JSON.parse(raw); } catch (e) { data = null; }
  const state = loadState(stateFile);
  if (!data || typeof data !== 'object') {
    fs.writeFileSync(logFile, raw + err);

    return state.pending.length;
  }
  const text = typeof data.result === 'string' ? data.result : '';
  const note = data.subtype && data.subtype !== 'success' ? `[agent ended: ${data.subtype}]\n` : '';
  fs.writeFileSync(logFile, `${note}${text}${text.endsWith('\n') ? '' : '\n'}${err}`);
  for (const d of Array.isArray(data.permission_denials) ? data.permission_denials : []) {
    const tool = String(d.tool_name || '');
    if (!tool) continue;
    const detail = detailFor(tool, d.tool_input, cwd);
    const ask = { stage, tool, detail, rule: ruleFor(tool, d.tool_input, cwd, [...allowed, ...state.allow]), protected: isProtected(tool, detail) };
    const same = a => a.tool === ask.tool && a.detail === ask.detail;
    if (state.denied.some(same) || state.pending.some(a => same(a) && a.stage === stage)) continue;
    if (!ask.protected && (state.allow.includes(ask.rule) || decidedLine(tool, d.tool_input, allowed, state.allow))) continue;
    state.pending.push(ask);
  }
  saveState(stateFile, state);

  return state.pending.length;
}

// Allow rules for a stage's run: this run's decisions plus the repository's saved ones.
function rulesFor(docsDir, repoFile) {
  const run = loadState(path.join(docsDir, 'logs', 'permissions.json')).allow;
  const repo = readJson(repoFile, {});
  const saved = Array.isArray(repo.allow) ? repo.allow.filter(r => typeof r === 'string') : [];

  return [...new Set([...saved, ...run])];
}

const modeFor = (docsDir, stage) => (loadState(path.join(docsDir, 'logs', 'permissions.json')).bypass.includes(stage) ? 'bypassPermissions' : 'acceptEdits');

// Applies a decision to pending asks. `allow` grants for this run (a protected path lifts the checks for that stage), `always`
// also saves a rule in the repository file (never for a protected path), `deny` records the refusal so it does not ask again.
function decide(stateFile, which, choice, repoFile) {
  if (!['allow', 'always', 'deny'].includes(choice)) throw new Error(`choice must be allow, always or deny, not '${choice}'`);
  const state = loadState(stateFile);
  const picked = which === 'all' ? state.pending.map((_, i) => i) : [Number(which)];
  if (picked.some(i => !Number.isInteger(i) || i < 0 || i >= state.pending.length)) throw new Error(`no pending request '${which}'`);
  const repo = readJson(repoFile, {});
  const saved = Array.isArray(repo.allow) ? repo.allow : [];
  let isSaved = false;
  for (const i of picked) {
    const ask = state.pending[i];
    if (choice === 'deny') {
      state.denied.push({ tool: ask.tool, detail: ask.detail });
    } else if (ask.protected) {
      if (!state.bypass.includes(ask.stage)) state.bypass.push(ask.stage);
    } else {
      if (!state.allow.includes(ask.rule)) state.allow.push(ask.rule);
      if (choice === 'always' && !saved.includes(ask.rule)) { saved.push(ask.rule); isSaved = true; }
    }
  }
  state.pending = state.pending.filter((_, i) => !picked.includes(i));
  saveState(stateFile, state);
  if (isSaved && repoFile) {
    fs.mkdirSync(path.dirname(repoFile), { recursive: true });
    fs.writeFileSync(repoFile, `${JSON.stringify({ ...repo, allow: saved }, null, 2)}\n`);
  }

  return state.pending.length;
}

function main(argv) {
  const [cmd, ...a] = argv;
  switch (cmd) {
    case 'extract': {
      const [jsonFile, logFile, stateFile, stage, cwd, errFile] = a;
      if (!jsonFile || !logFile || !stateFile || !stage || !cwd) throw new Error('extract: <agent.json> <log> <state.json> <stage> <cwd> [<stderr file>]');
      // SDLC_ALLOWED: the agent's allow rules, one per line (set by scripts/sdlc.sh).
      const allowed = (process.env.SDLC_ALLOWED || '').split('\n').filter(Boolean);
      console.log(String(extract({ jsonFile, logFile, stateFile, stage, cwd, errFile, allowed })));
      break;
    }
    case 'args':
      for (const r of rulesFor(a[0], a[2] || REPO_RULES)) console.log(r);
      break;
    case 'mode':
      console.log(modeFor(a[0], a[1]));
      break;
    case 'list':
      console.log(JSON.stringify(loadState(a[0]).pending));
      break;
    case 'decide':
      console.log(String(decide(a[0], a[1], a[2], a[3] || REPO_RULES)));
      break;
    default:
      throw new Error('Usage: sdlc-permissions.cjs extract|args|mode|list|decide ...');
  }
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(1); }
}

module.exports = { extract, rulesFor, modeFor, decide, ruleFor, commandParts, detailFor, isProtected, loadState };
