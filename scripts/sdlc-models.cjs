#!/usr/bin/env node
// The user-level model registry (models.json): the only reader and writer of that file.
// Usage: node scripts/sdlc-models.cjs path | list [--json] | get <p> | add <p> --endpoint <url> --key-env <VAR> --models a,b [--effort]
//        | add-model <p> <m> | remove-model <p> <m> | remove <p> | test <p>/<m>
// The file holds the NAME of the variable that carries each provider's key, never the key. Exit 0 ok, 1 on any error.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');

const TEST_TIMEOUT_MS = 10000;
const TEST_BODY_MAX = 65536;
const MAX_MODELS = 50;

class RegistryError extends Error {}
class UsageError extends Error {}

const set = v => typeof v === 'string' && v !== '';
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// First match wins (spec S3). Branches 2 and 4 use '/', branch 3 uses win32 separators, on every OS.
function resolvePath({ env, platform, home }) {
  if (set(env.SDLC_MODELS_FILE)) return env.SDLC_MODELS_FILE;
  if (platform !== 'win32' && set(env.XDG_CONFIG_HOME)) return `${env.XDG_CONFIG_HOME}/sdlc/models.json`;
  if (platform === 'win32' && set(env.APPDATA)) return path.win32.join(env.APPDATA, 'sdlc', 'models.json');
  return `${home}/.config/sdlc/models.json`;
}

// Whitespace and control characters are refused although URL() would strip them: get and list print the stored text as one line.
// A user:password part is refused because the file must hold no secret (spec S4.1).
function validEndpoint(s) {
  if (/[\s\x00-\x1f\x7f]/.test(s)) return false;
  let u;
  try { u = new URL(s); } catch (e) { return false; }
  if (u.username !== '' || u.password !== '') return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
}

// Returns null or '<field>: <rule>'.
function validateProvider(name, p) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return 'provider name: must match ^[a-z0-9][a-z0-9-]*$';
  if (name === 'anthropic') return "provider name: 'anthropic' is reserved";
  if (!isObject(p)) return 'provider: must be an object';
  if (typeof p.endpoint !== 'string') return 'endpoint: must be a string';
  if (typeof p.api_key_env !== 'string') return 'api_key_env: must be a string';
  if (!Array.isArray(p.models) || p.models.some(m => typeof m !== 'string')) return 'models: must be a list of strings';
  if (p.effort !== undefined && typeof p.effort !== 'boolean') return 'effort: must be true or false';
  if (!validEndpoint(p.endpoint)) return 'endpoint: must be https, or http to localhost, 127.0.0.1 or [::1]';
  if (!/^[A-Z_][A-Z0-9_]*$/.test(p.api_key_env)) return 'api_key_env: must match ^[A-Z_][A-Z0-9_]*$';
  if (p.models.length < 1) return 'models: at least 1 model';
  if (p.models.length > MAX_MODELS) return `models: at most ${MAX_MODELS} models`;
  for (const m of p.models) {
    if (!/^[A-Za-z0-9._:/-]+$/.test(m)) return `models: '${m}' must match ^[A-Za-z0-9._:/-]+$`;
  }
  const seen = new Set();
  for (const m of p.models) {
    if (seen.has(m)) return `models: duplicate '${m}'`;
    seen.add(m);
  }
  return null;
}

function validateRegistry(data) {
  if (!isObject(data) || !isObject(data.providers)) return 'providers: must be an object';
  for (const [name, p] of Object.entries(data.providers)) {
    const msg = validateProvider(name, p);
    if (msg) return `provider '${name}': ${msg}`;
  }
  return null;
}

function load(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { providers: {} };
    throw new RegistryError(`${file}: ${e.message}`);
  }
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new RegistryError(`${file}: not valid JSON`); }
  const msg = validateRegistry(data);
  if (msg) throw new RegistryError(`${file}: ${msg}`);
  return data;
}

// The caller has already validated `data`.
function save(file, data) {
  const tmp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
    fs.renameSync(tmp, file);
  } finally {
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
  }
}

function parseModels(text) {
  if (text.trim() === '') return [];
  return text.split(',').map(s => s.trim());
}

const SPEC = {
  path: { pos: 0, opts: {}, flags: [] },
  list: { pos: 0, opts: {}, flags: ['json'] },
  get: { pos: 1, opts: {}, flags: [] },
  add: { pos: 1, opts: { endpoint: 1, 'key-env': 1, models: 1 }, flags: ['effort'] },
  'add-model': { pos: 2, opts: {}, flags: [] },
  'remove-model': { pos: 2, opts: {}, flags: [] },
  remove: { pos: 1, opts: {}, flags: [] },
  test: { pos: 1, opts: {}, flags: [] },
};

function parseArgs(cmd, argv) {
  const spec = SPEC[cmd];
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      if (has(spec.opts, name)) {
        if (i + 1 >= argv.length) throw new UsageError(`missing value for ${a}`);
        opts[name] = argv[++i];
      } else if (spec.flags.includes(name)) {
        opts[name] = true;
      } else {
        throw new UsageError(`unknown option ${a}`);
      }
    } else {
      pos.push(a);
    }
  }
  if (pos.length !== spec.pos) throw new UsageError(`${cmd}: expected ${spec.pos} argument(s), got ${pos.length}`);
  return { pos, opts };
}

const keyValue = (env, name) => (set(env[name]) ? env[name] : '');

function probe({ endpoint, model, key, timeoutMs }) {
  return new Promise(resolve => {
    let finished = false;
    let req;
    let timer;
    const finish = (ok, line) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ ok, line: line.split(key).join('***') });
    };
    let url;
    try {
      url = new URL(`${endpoint.replace(/\/+$/, '')}/v1/messages`);
    } catch (e) {
      finish(false, 'connection failed: ERROR');
      return;
    }
    const body = JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] });
    const lib = url.protocol === 'https:' ? https : http;
    timer = setTimeout(() => {
      finish(false, `timeout after ${timeoutMs / 1000}s`);
      if (req) req.destroy();
    }, timeoutMs);
    // A key that cannot be a header value makes request() throw: report it instead of leaving the timer running.
    try {
      req = lib.request(url, {
        method: 'POST',
        agent: false,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
          'anthropic-version': '2023-06-01',
          'content-length': Buffer.byteLength(body),
        },
      }, res => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', c => { if (text.length < TEST_BODY_MAX) text += c; });
        res.on('error', err => finish(false, `connection failed: ${err.code || 'ERROR'}`));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) finish(true, 'ok');
          // The key is masked before the cut, so the cut can never leave part of an echoed key in the line.
          else finish(false, `HTTP ${res.statusCode}: ${text.split(key).join('***').replace(/[\r\n]+/g, ' ').slice(0, 200)}`);
        });
      });
    } catch (e) {
      finish(false, `connection failed: ${e.code || 'ERROR'}`);
      return;
    }
    req.on('error', err => finish(false, `connection failed: ${err.code || 'ERROR'}`));
    req.end(body);
  });
}

const unknownProvider = p => new RegistryError(`unknown provider '${p}'`);

function commit(file, data) {
  const msg = validateRegistry(data);
  if (msg) throw new RegistryError(msg);
  save(file, data);
}

async function main(argv, io = {}) {
  const env = io.env || process.env;
  const platform = io.platform || process.platform;
  const home = io.home || os.homedir();
  const out = io.out || (l => process.stdout.write(`${l}\n`));
  const err = io.err || (l => process.stderr.write(`${l}\n`));
  const timeoutMs = io.timeoutMs || TEST_TIMEOUT_MS;
  try {
    const [cmd, ...rest] = argv;
    if (!cmd || !has(SPEC, cmd)) throw new UsageError(`unknown command '${cmd || ''}' (path, list, get, add, add-model, remove-model, remove, test)`);
    const { pos, opts } = parseArgs(cmd, rest);
    const file = resolvePath({ env, platform, home });
    if (cmd === 'path') { out(file); return 0; }
    if (cmd === 'add') {
      for (const o of ['endpoint', 'key-env', 'models']) if (opts[o] === undefined) throw new UsageError(`missing --${o}`);
    }
    const data = load(file);
    const providers = data.providers;
    const [p, m] = pos;
    const need = () => { if (!has(providers, p)) throw unknownProvider(p); return providers[p]; };

    switch (cmd) {
      case 'list': {
        const view = {};
        for (const [name, v] of Object.entries(providers)) {
          view[name] = { endpoint: v.endpoint, api_key_env: v.api_key_env, models: v.models, effort: v.effort === true, key_set: keyValue(env, v.api_key_env) !== '' };
        }
        if (opts.json) { out(JSON.stringify({ providers: view })); break; }
        const names = Object.keys(view);
        if (!names.length) { out(`no providers (${file})`); break; }
        for (const name of names) {
          const v = view[name];
          out(`${name}  ${v.endpoint}  ${v.api_key_env} (${v.key_set ? 'key set' : 'key NOT set'})  ${v.models.join(',')}${v.effort ? '  effort' : ''}`);
        }
        break;
      }
      case 'get': {
        const v = need();
        out(`endpoint=${v.endpoint}`);
        out(`api_key_env=${v.api_key_env}`);
        out(`models=${v.models.join(',')}`);
        out(`effort=${v.effort === true}`);
        break;
      }
      case 'add': {
        const existing = has(providers, p) ? providers[p] : {};
        providers[p] = { ...existing, endpoint: opts.endpoint, api_key_env: opts['key-env'], models: parseModels(opts.models), effort: Boolean(opts.effort) };
        commit(file, data);
        out(`added ${p} (${providers[p].models.length} models)`);
        break;
      }
      case 'add-model': {
        const v = need();
        if (v.models.includes(m)) throw new RegistryError(`model '${m}' is already listed`);
        v.models.push(m);
        commit(file, data);
        out(`added ${p}/${m}`);
        break;
      }
      case 'remove-model': {
        const v = need();
        if (!v.models.includes(m)) throw new RegistryError(`model '${m}' is not listed`);
        if (v.models.length === 1) throw new RegistryError(`provider '${p}' would have no model left: use remove ${p}`);
        v.models = v.models.filter(x => x !== m);
        commit(file, data);
        out(`removed ${p}/${m}`);
        break;
      }
      case 'remove': {
        need();
        delete providers[p];
        commit(file, data);
        out(`removed ${p}`);
        break;
      }
      case 'test': {
        const slash = p.indexOf('/');
        if (slash < 1) throw new UsageError('test: expected <provider>/<model>');
        const name = p.slice(0, slash);
        const model = p.slice(slash + 1);
        if (!has(providers, name)) throw unknownProvider(name);
        const v = providers[name];
        if (!v.models.includes(model)) throw new RegistryError(`model '${model}' is not listed for provider '${name}'`);
        const key = keyValue(env, v.api_key_env);
        if (key === '') throw new RegistryError(`key variable ${v.api_key_env} is not set`);
        const r = await probe({ endpoint: v.endpoint, model, key, timeoutMs });
        out(r.line);
        return r.ok ? 0 : 1;
      }
    }
    return 0;
  } catch (e) {
    err(e.message);
    return 1;
  }
}

module.exports = { resolvePath, validateProvider, validateRegistry, parseModels, main, TEST_TIMEOUT_MS };
if (require.main === module) main(process.argv.slice(2)).then(code => { process.exitCode = code; });
