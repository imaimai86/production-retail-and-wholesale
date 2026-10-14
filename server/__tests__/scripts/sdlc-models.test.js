const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const helper = path.join(root, 'scripts/sdlc-models.cjs');
const lib = () => require(helper);

const KEY = 'sk-test-secret-9876';
const GOOD = {
  providers: {
    gw: { endpoint: 'https://gw.example/api', api_key_env: 'GW_KEY', models: ['m1', 'm2'], effort: false },
  },
};

let dir;
let file;
// A new, empty registry location. Every test starts with one; a test that checks several cases calls it between them.
function fresh() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-models-'));
  file = path.join(dir, 'sub', 'models.json');
}
beforeEach(fresh);

function cliEnv(extra = {}) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(SDLC_|XDG_|APPDATA|GW_KEY)/.test(k)));
  return { ...clean, SDLC_MODELS_FILE: file, ...extra };
}
// In process: a new `node` per call costs far more than the command. Only a call that names a working directory starts a real process,
// because only a real process has one of its own (the tests about a .env file there).
async function cli(args, { env = {}, cwd } = {}) {
  if (cwd) {
    const r = spawnSync('node', [helper, ...args], { cwd, env: cliEnv(env), encoding: 'utf8' });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  }
  let stdout = '';
  let stderr = '';
  const status = await lib().main(args, { env: cliEnv(env), out: l => { stdout += `${l}\n`; }, err: l => { stderr += `${l}\n`; } });
  return { status, stdout, stderr };
}
function seed(data = GOOD, f = file) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}
const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
const ADD = ['add', 'gw', '--endpoint', 'https://gw.example/api', '--key-env', 'GW_KEY', '--models', 'm1,m2'];
const withArgs = (over) => {
  const a = { endpoint: 'https://gw.example/api', 'key-env': 'GW_KEY', models: 'm1,m2', ...over };
  return ['add', over.name === undefined ? 'gw' : over.name, '--endpoint', a.endpoint, '--key-env', a['key-env'], '--models', a.models];
};

describe('resolvePath and exports', () => {
  test('AC1-AC5 the file comes from SDLC_MODELS_FILE, then XDG_CONFIG_HOME or APPDATA, then home', async () => {
    const { resolvePath } = lib();
    // AC1 SDLC_MODELS_FILE wins on any platform
    for (const platform of ['linux', 'darwin', 'win32']) {
      expect(resolvePath({ env: { SDLC_MODELS_FILE: '/x/y.json', XDG_CONFIG_HOME: '/xdg', APPDATA: 'C:\\A' }, platform, home: '/h' })).toBe('/x/y.json');
    }
    // AC2 XDG_CONFIG_HOME when not win32
    expect(resolvePath({ env: { XDG_CONFIG_HOME: '/xdg' }, platform: 'linux', home: '/h' })).toBe('/xdg/sdlc/models.json');
    expect(resolvePath({ env: { XDG_CONFIG_HOME: '/xdg' }, platform: 'darwin', home: '/h' })).toBe('/xdg/sdlc/models.json');
    // AC3 APPDATA on win32, also when XDG_CONFIG_HOME is set
    expect(resolvePath({ env: { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, platform: 'win32', home: 'C:\\h' })).toBe('C:\\Users\\a\\AppData\\Roaming\\sdlc\\models.json');
    expect(resolvePath({ env: { APPDATA: 'C:\\R', XDG_CONFIG_HOME: '/xdg' }, platform: 'win32', home: 'C:\\h' })).toBe('C:\\R\\sdlc\\models.json');
    // AC4 win32 without APPDATA falls back to home, even with XDG_CONFIG_HOME
    expect(resolvePath({ env: {}, platform: 'win32', home: '/h' })).toBe('/h/.config/sdlc/models.json');
    expect(resolvePath({ env: { XDG_CONFIG_HOME: '/xdg' }, platform: 'win32', home: '/h' })).toBe('/h/.config/sdlc/models.json');
    // AC5 nothing set gives home/.config
    expect(resolvePath({ env: {}, platform: 'linux', home: '/h' })).toBe('/h/.config/sdlc/models.json');
    // empty strings count as not set
    expect(resolvePath({ env: { SDLC_MODELS_FILE: '', XDG_CONFIG_HOME: '' }, platform: 'linux', home: '/h' })).toBe('/h/.config/sdlc/models.json');
    expect(resolvePath({ env: { APPDATA: '' }, platform: 'win32', home: '/h' })).toBe('/h/.config/sdlc/models.json');
  });

  test('TEST_TIMEOUT_MS is 10 seconds (AC31 seam); parseModels trims and a blank text gives no models', async () => {
    expect(lib().TEST_TIMEOUT_MS).toBe(10000);
    const { parseModels } = lib();
    expect(parseModels(' a , b,c ')).toEqual(['a', 'b', 'c']);
    expect(parseModels('   ')).toEqual([]);
  });

  test('AC6 path prints the path, exit 0, for a missing file and for a corrupt one, which it leaves', async () => {
    let r = await cli(['path']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(file);
    expect(fs.existsSync(file)).toBe(false);

    seed('{ nope');
    r = await cli(['path']);
    expect(r.status).toBe(0);
    expect(fs.readFileSync(file, 'utf8')).toBe('{ nope');
  });
});

describe('writing commands', () => {
  test('AC7 AC8 add creates folder and file, trims models, sets effort, and replaces every field of an existing provider', async () => {
    const r = await cli(ADD);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('added gw (2 models)');
    expect(read().providers.gw).toMatchObject({ endpoint: 'https://gw.example/api', api_key_env: 'GW_KEY', models: ['m1', 'm2'] });

    fresh();
    await cli(withArgs({ models: ' a , b ' }));
    expect(read().providers.gw.models).toEqual(['a', 'b']);

    fresh();
    await cli([...ADD, '--effort']);
    expect(read().providers.gw.effort).toBe(true);

    fresh();
    seed({ providers: { gw: { ...GOOD.providers.gw, effort: true }, other: { endpoint: 'https://o.example', api_key_env: 'O', models: ['x'] } } });
    const rep = await cli(['add', 'gw', '--endpoint', 'http://localhost:9', '--key-env', 'NEW_KEY', '--models', 'z']);
    expect(rep.status).toBe(0);
    const d = read();
    expect(d.providers.gw).toMatchObject({ endpoint: 'http://localhost:9', api_key_env: 'NEW_KEY', models: ['z'], effort: false });
    expect(d.providers.other.models).toEqual(['x']);
  });

  test('AC9 add without a required option exits 1, names it and writes nothing', async () => {
    for (const opt of ['--endpoint', '--key-env', '--models']) {
      const args = [...ADD];
      args.splice(args.indexOf(opt), 2);
      const r = await cli(args);
      expect([opt, r.status]).toEqual([opt, 1]);
      expect(r.stderr).toContain(opt.replace(/^--/, ''));
      expect(fs.existsSync(path.dirname(file))).toBe(false);
    }
  });

  test('AC10 AC14 add-model, remove-model and remove; unknown keys survive a rewrite', async () => {
    seed();
    let r = await cli(['add-model', 'gw', 'm3']);
    expect([r.status, r.stdout.trim()]).toEqual([0, 'added gw/m3']);
    expect(read().providers.gw.models).toEqual(['m1', 'm2', 'm3']);
    r = await cli(['remove-model', 'gw', 'm1']);
    expect([r.status, r.stdout.trim()]).toEqual([0, 'removed gw/m1']);
    expect(read().providers.gw.models).toEqual(['m2', 'm3']);
    r = await cli(['remove', 'gw']);
    expect([r.status, r.stdout.trim()]).toEqual([0, 'removed gw']);
    expect(read().providers).toEqual({});

    fresh();
    seed({ extra: { a: 1 }, providers: { gw: { ...GOOD.providers.gw, note: 'keep' } } });
    expect((await cli(['add-model', 'gw', 'm3'])).status).toBe(0);
    const d = read();
    expect(d.extra).toEqual({ a: 1 });
    expect(d.providers.gw.note).toBe('keep');
    expect((await cli(ADD)).status).toBe(0);
    expect(read().extra).toEqual({ a: 1 });
    expect(read().providers.gw.note).toBe('keep');
  });
});

describe('reading commands', () => {
  test('AC11 list --json is one line with key_set and a boolean effort; no file prints {"providers":{}} and creates nothing', async () => {
    let r = await cli(['list', '--json']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('{"providers":{}}');
    expect(fs.existsSync(path.dirname(file))).toBe(false);

    seed({ providers: { gw: { endpoint: 'https://gw.example/api', api_key_env: 'GW_KEY', models: ['m1'] } } });
    r = await cli(['list', '--json'], { env: { GW_KEY: KEY } });
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(r.stdout)).toEqual({ providers: { gw: { endpoint: 'https://gw.example/api', api_key_env: 'GW_KEY', models: ['m1'], effort: false, key_set: true } } });
  });

  test('AC12 list text format, effort suffix and key NOT set; an empty list prints no providers (<path>)', async () => {
    let r = await cli(['list']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(`no providers (${file})`);

    seed({ providers: {
      gw: { endpoint: 'https://gw.example/api', api_key_env: 'GW_KEY', models: ['m1', 'm2'], effort: true },
      lo: { endpoint: 'http://localhost:1', api_key_env: 'LO_KEY', models: ['a'] },
    } });
    r = await cli(['list'], { env: { GW_KEY: KEY } });
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split('\n')).toEqual([
      'gw  https://gw.example/api  GW_KEY (key set)  m1,m2  effort',
      'lo  http://localhost:1  LO_KEY (key NOT set)  a',
    ]);
  });

  test('AC13 get prints the four lines in order; an unknown provider, no file or a prototype name exits 1', async () => {
    // no file
    let r = await cli(['get', 'nope']);
    expect(r.status).toBe(1);
    expect(r.stderr.trim()).toBe("unknown provider 'nope'");

    seed({ providers: { gw: { ...GOOD.providers.gw, effort: true } } });
    r = await cli(['get', 'gw']);
    expect(r.status).toBe(0);
    expect(r.stdout.trimEnd().split('\n')).toEqual(['endpoint=https://gw.example/api', 'api_key_env=GW_KEY', 'models=m1,m2', 'effort=true']);

    // effort absent prints effort=false
    seed({ providers: { gw: { endpoint: 'https://e.example', api_key_env: 'K', models: ['m'] } } });
    expect((await cli(['get', 'gw'])).stdout.trimEnd().split('\n')[3]).toBe('effort=false');

    seed();
    for (const n of ['nope', 'constructor', 'toString']) {
      r = await cli(['get', n]);
      expect(r.status).toBe(1);
      expect(r.stderr.trim()).toBe(`unknown provider '${n}'`);
    }
  });
});

describe('validation (AC15-AC20)', () => {
  const bytes = () => (fs.existsSync(file) ? fs.readFileSync(file) : null);
  async function rejects(args, mention) {
    const before = bytes();
    const r = await cli(args);
    expect([args, r.status]).toEqual([args, 1]);
    expect(r.stderr.trim().split('\n')).toHaveLength(1);
    if (mention) expect(r.stderr).toMatch(mention);
    const after = bytes();
    if (before === null) {
      expect(after).toBeNull();
      expect(fs.existsSync(path.dirname(file))).toBe(false);
    } else {
      expect(after.equals(before)).toBe(true);
    }
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  }
  async function accepts(over) {
    fresh();
    expect([over, (await cli(withArgs(over))).status]).toEqual([over, 0]);
  }

  test('AC15 AC16 AC17 provider name, endpoint and api_key_env rules', async () => {
    for (const name of ['Gw', '-gw', 'g_w', 'g w', 'gw.x', 'anthropic']) await rejects(withArgs({ name }), /name|anthropic/i);
    for (const endpoint of ['/relative', 'gw.example/api', 'ftp://gw.example', 'file:///etc/passwd', 'http://gw.example', 'http://10.0.0.1', 'http://localhost.evil.com']) {
      await rejects(withArgs({ endpoint }), /endpoint/);
    }
    for (const v of ['gw_key', '1KEY', 'MY-KEY', 'MY KEY', 'K$']) await rejects(withArgs({ 'key-env': v }), /api_key_env/);

    for (const name of ['a', '0a', 'a-b-1']) await accepts({ name });
    for (const endpoint of ['http://localhost', 'http://localhost:4000/x', 'http://127.0.0.1:8080', 'http://[::1]:3000', 'https://anything.example', 'https://10.0.0.1']) {
      await accepts({ endpoint });
    }
    for (const v of ['_KEY', 'A1_B2', 'K']) await accepts({ 'key-env': v });
  });

  test('AC18 model rules: no space, bad character, empty entry, empty list, duplicate or 51st model', async () => {
    const many = n => Array.from({ length: n }, (_, i) => `m${i}`).join(',');
    await rejects(withArgs({ models: 'ok,bad model' }), /model/);
    await rejects(withArgs({ models: 'ok,b@d' }), /model/);
    await rejects(withArgs({ models: 'a,,b' }), /model/);
    await rejects(withArgs({ models: '' }), /model/);
    await rejects(withArgs({ models: '  ' }), /model/);
    await rejects(withArgs({ models: many(51) }), /model|50/);
    await rejects(withArgs({ models: 'a,b,a' }), /duplicate|model/);

    await accepts({ models: many(50) });
    // . : / - _ are allowed
    await accepts({ models: 'openai/gpt-5,llama3:8b,v1.2_x' });
  });

  test('AC19 AC20 add-model, remove-model and remove reject an unknown provider or model, and the last model', async () => {
    seed();
    await rejects(['add-model', 'nope', 'm'], /nope/);
    await rejects(['remove-model', 'nope', 'm'], /nope/);
    await rejects(['remove', 'nope'], /nope/);
    await rejects(['add-model', 'gw', 'm1'], /m1/);
    await rejects(['add-model', 'gw', 'bad model'], /model/);
    await rejects(['remove-model', 'gw', 'zzz'], /zzz/);

    seed({ providers: { gw: { ...GOOD.providers.gw, models: Array.from({ length: 50 }, (_, i) => `m${i}`) } } });
    await rejects(['add-model', 'gw', 'extra'], /50|model/);

    // AC20 the message points to remove <provider>
    seed({ providers: { gw: { ...GOOD.providers.gw, models: ['only'] } } });
    await rejects(['remove-model', 'gw', 'only'], /remove gw/);
    expect(read().providers.gw.models).toEqual(['only']);
  });

  test('usage errors exit 1: unknown command, unknown option, missing argument', async () => {
    expect((await cli(['bogus'])).status).toBe(1);
    expect((await cli([])).status).toBe(1);
    seed();
    expect((await cli(['list', '--bogus'])).status).toBe(1);
    expect((await cli(['get'])).status).toBe(1);
    expect((await cli(['add-model', 'gw'])).status).toBe(1);
    expect((await cli([...ADD, '--bogus'])).status).toBe(1);
  });
});

describe('file integrity (AC21-AC24)', () => {
  test('AC21 no .tmp after success or rejection', async () => {
    await cli(ADD);
    expect(fs.readdirSync(path.dirname(file)).sort()).toEqual(['models.json']);
    await cli(withArgs({ name: 'Bad' }));
    await cli(['remove-model', 'gw', 'nope']);
    expect(fs.readdirSync(path.dirname(file)).sort()).toEqual(['models.json']);
  });

  const ALL = [
    ['list'], ['list --json', 'list', '--json'], ['add', ...ADD], ['add-model', 'add-model', 'gw', 'x'],
    ['remove-model', 'remove-model', 'gw', 'm1'], ['remove', 'remove', 'gw'], ['get', 'get', 'gw'], ['test', 'test', 'gw/m1'],
  ].map(([label, ...args]) => [label, args.length ? args : [label]]);
  const broken = {
    'AC22 invalid JSON': '{ not json',
    'AC23 no providers object': JSON.stringify({ models: [] }),
    'AC23 providers is an array': JSON.stringify({ providers: [] }),
    'AC23 models not an array': JSON.stringify({ providers: { gw: { ...GOOD.providers.gw, models: 'm1' } } }),
    'AC23 endpoint not a string': JSON.stringify({ providers: { gw: { ...GOOD.providers.gw, endpoint: 5 } } }),
    'AC23 effort not a boolean': JSON.stringify({ providers: { gw: { ...GOOD.providers.gw, effort: 'yes' } } }),
    'AC24 http endpoint on a remote host': JSON.stringify({ providers: { gw: { ...GOOD.providers.gw, endpoint: 'http://gw.example' } } }),
    'AC24 provider name anthropic': JSON.stringify({ providers: { anthropic: GOOD.providers.gw } }),
    'AC24 duplicate models': JSON.stringify({ providers: { gw: { ...GOOD.providers.gw, models: ['a', 'a'] } } }),
  };
  // One test per broken file: every command must refuse it.
  test.each(Object.entries(broken))('%s: every command exits 1 naming the file and leaves it unchanged', async (label, content) => {
    for (const [name, args] of ALL) {
      seed(content);
      const r = await cli(args, { env: { GW_KEY: KEY } });
      expect([name, r.status]).toEqual([name, 1]);
      expect(r.stderr).toContain(file);
      expect(fs.readFileSync(file, 'utf8')).toBe(content);
      expect(fs.existsSync(`${file}.tmp`)).toBe(false);
    }
  });

  test('AC24 the message names the provider and the rule', async () => {
    seed({ providers: { ok: { endpoint: 'https://a.example', api_key_env: 'K', models: ['m'] }, gw: { ...GOOD.providers.gw, endpoint: 'http://gw.example' } } });
    const r = await cli(['list']);
    expect(r.stderr).toContain('gw');
    expect(r.stderr).toMatch(/endpoint/);
  });
});

describe('key handling (AC25-AC27)', () => {
  const keySet = async (env, cwd) => JSON.parse((await cli(['list', '--json'], { env, cwd })).stdout).providers.gw.key_set;
  test('AC25 AC26 key_set is true only for a non-empty key in the environment, not one in .env of the working directory', async () => {
    seed();
    expect(await keySet({ GW_KEY: KEY })).toBe(true);
    expect(await keySet({})).toBe(false);
    expect(await keySet({ GW_KEY: '' })).toBe(false);

    fs.writeFileSync(path.join(dir, '.env'), `GW_KEY=${KEY}\n`);
    expect(await keySet({}, dir)).toBe(false);
  });
  test('AC27 the key value appears in no output of list, list --json, get and error paths', async () => {
    seed({ providers: { gw: { ...GOOD.providers.gw, effort: true } } });
    const env = { GW_KEY: KEY };
    const runs = [['list'], ['list', '--json'], ['get', 'gw'], ['get', 'nope'], ['test', 'nope/m'], ['test', 'gw/unlisted'], ['add-model', 'gw', 'm1'], ['path']];
    for (const a of runs) {
      const r = await cli(a, { env });
      expect(r.stdout + r.stderr).not.toContain(KEY);
    }
  });
});

describe('test command (AC28-AC33)', () => {
  const { main } = lib();
  let server;
  let reqs;
  let handler;
  const ok = (req, res) => { res.statusCode = 200; res.end('{}'); };

  beforeEach(async () => {
    reqs = [];
    handler = ok;
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => { reqs.push({ method: req.method, url: req.url, headers: req.headers, body }); handler(req, res); });
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
  });
  afterEach(async () => {
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise(r => server.close(() => r()));
  });

  const url = () => `http://127.0.0.1:${server.address().port}`;
  async function run(args, { env = { GW_KEY: KEY }, timeoutMs } = {}) {
    const out = [];
    const err = [];
    const code = await main(args, { env: { SDLC_MODELS_FILE: file, ...env }, out: l => out.push(l), err: l => err.push(l), timeoutMs, home: dir, platform: 'linux' });
    return { code, out: out.join('\n'), err: err.join('\n') };
  }
  const seedServer = (endpoint = url()) => seed({ providers: { gw: { endpoint, api_key_env: 'GW_KEY', models: ['m1'] } } });

  test('AC28 AC29 a 2xx prints ok; the request is the documented one, whatever slashes the endpoint or the model has', async () => {
    seedServer();
    let r = await run(['test', 'gw/m1']);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe('ok');
    expect(reqs).toHaveLength(1);
    expect(reqs[0].method).toBe('POST');
    expect(reqs[0].url).toBe('/v1/messages');
    expect(reqs[0].headers.authorization).toBe(`Bearer ${KEY}`);
    expect(reqs[0].headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(reqs[0].body);
    expect(body.model).toBe('m1');
    expect(body.max_tokens).toBe(1);

    // a 2xx other than 200 is ok
    handler = (req, res) => { res.statusCode = 204; res.end(); };
    expect((await run(['test', 'gw/m1'])).code).toBe(0);
    handler = ok;

    // a model name containing a slash splits at the first slash
    reqs = [];
    seed({ providers: { gw: { endpoint: url(), api_key_env: 'GW_KEY', models: ['openai/gpt-5'] } } });
    r = await run(['test', 'gw/openai/gpt-5']);
    expect(r.code).toBe(0);
    expect(JSON.parse(reqs[0].body).model).toBe('openai/gpt-5');

    // AC29 trailing slashes do not double up, and the stored value is unchanged
    reqs = [];
    seedServer(`${url()}///`);
    r = await run(['test', 'gw/m1']);
    expect(r.code).toBe(0);
    expect(reqs[0].url).toBe('/v1/messages');
    expect(read().providers.gw.endpoint).toBe(`${url()}///`);
  });

  test('AC30 AC27 a 401 or 500 prints HTTP <code> and at most 200 characters of the body, never the key', async () => {
    seedServer();
    handler = (req, res) => { res.statusCode = 401; res.end('x'.repeat(500)); };
    let r = await run(['test', 'gw/m1']);
    expect(r.code).toBe(1);
    expect(`${r.out}${r.err}`.trim()).toBe(`HTTP 401: ${'x'.repeat(200)}`);

    handler = (req, res) => { res.statusCode = 500; res.end('boom'); };
    r = await run(['test', 'gw/m1']);
    expect(r.code).toBe(1);
    expect(`${r.out}${r.err}`.trim()).toBe('HTTP 500: boom');

    handler = (req, res) => { res.statusCode = 401; res.end(`bad token ${KEY}`); };
    r = await run(['test', 'gw/m1']);
    expect(r.code).toBe(1);
    expect(`${r.out}${r.err}`).not.toContain(KEY);
  });

  test('AC31 AC32 no answer within the timeout prints timeout after <n>s; nothing listening prints connection failed: <code>', async () => {
    seedServer();
    handler = () => {};
    let r = await run(['test', 'gw/m1'], { timeoutMs: 200 });
    expect(r.code).toBe(1);
    expect(`${r.out}${r.err}`.trim()).toBe('timeout after 0.2s');

    const ep = url();
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise(res => server.close(() => res()));
    seedServer(ep);
    r = await run(['test', 'gw/m1']);
    expect(r.code).toBe(1);
    expect(`${r.out}${r.err}`.trim()).toBe('connection failed: ECONNREFUSED');
    server = http.createServer();
  });

  test('AC33 unknown provider, unlisted model, missing file, key unset or only in .env: exit 1, nothing sent', async () => {
    // a missing file is an unknown provider
    let r = await run(['test', 'gw/m1']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('gw');

    seedServer();
    r = await run(['test', 'nope/m1']);
    expect([r.code, r.err]).toEqual([1, expect.stringContaining('nope')]);
    r = await run(['test', 'gw/zzz']);
    expect([r.code, r.err]).toEqual([1, expect.stringContaining('zzz')]);
    r = await run(['test', 'gw/m1'], { env: {} });
    expect([r.code, r.err]).toEqual([1, expect.stringContaining('GW_KEY')]);
    r = await run(['test', 'gw/m1'], { env: { GW_KEY: '' } });
    expect([r.code, r.err]).toEqual([1, expect.stringContaining('GW_KEY')]);

    // a key only in .env of the working directory is not used (CLI)
    fs.writeFileSync(path.join(dir, '.env'), `GW_KEY=${KEY}\n`);
    const c = await cli(['test', 'gw/m1'], { cwd: dir });
    expect(c.status).toBe(1);
    expect(c.stderr).toContain('GW_KEY');
    expect(reqs).toHaveLength(0);
  });
});
