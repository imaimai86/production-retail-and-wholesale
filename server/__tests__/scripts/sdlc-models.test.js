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
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-models-'));
  file = path.join(dir, 'sub', 'models.json');
});

function cliEnv(extra = {}) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(SDLC_|XDG_|APPDATA|GW_KEY)/.test(k)));
  return { ...clean, SDLC_MODELS_FILE: file, ...extra };
}
function cli(args, { env = {}, cwd = dir } = {}) {
  return spawnSync('node', [helper, ...args], { cwd, env: cliEnv(env), encoding: 'utf8' });
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

describe('resolvePath (AC1-AC5)', () => {
  const { resolvePath } = lib();
  test('AC1 SDLC_MODELS_FILE wins on any platform', () => {
    for (const platform of ['linux', 'darwin', 'win32']) {
      expect(resolvePath({ env: { SDLC_MODELS_FILE: '/x/y.json', XDG_CONFIG_HOME: '/xdg', APPDATA: 'C:\\A' }, platform, home: '/h' })).toBe('/x/y.json');
    }
  });
  test('AC2 XDG_CONFIG_HOME when not win32', () => {
    expect(resolvePath({ env: { XDG_CONFIG_HOME: '/xdg' }, platform: 'linux', home: '/h' })).toBe('/xdg/sdlc/models.json');
    expect(resolvePath({ env: { XDG_CONFIG_HOME: '/xdg' }, platform: 'darwin', home: '/h' })).toBe('/xdg/sdlc/models.json');
  });
  test('AC3 APPDATA on win32, also when XDG_CONFIG_HOME is set', () => {
    expect(resolvePath({ env: { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, platform: 'win32', home: 'C:\\h' })).toBe('C:\\Users\\a\\AppData\\Roaming\\sdlc\\models.json');
    expect(resolvePath({ env: { APPDATA: 'C:\\R', XDG_CONFIG_HOME: '/xdg' }, platform: 'win32', home: 'C:\\h' })).toBe('C:\\R\\sdlc\\models.json');
  });
  test('AC4 win32 without APPDATA falls back to home, even with XDG_CONFIG_HOME', () => {
    expect(resolvePath({ env: {}, platform: 'win32', home: '/h' })).toBe('/h/.config/sdlc/models.json');
    expect(resolvePath({ env: { XDG_CONFIG_HOME: '/xdg' }, platform: 'win32', home: '/h' })).toBe('/h/.config/sdlc/models.json');
  });
  test('AC5 nothing set gives home/.config', () => {
    expect(resolvePath({ env: {}, platform: 'linux', home: '/h' })).toBe('/h/.config/sdlc/models.json');
  });
  test('empty strings count as not set', () => {
    expect(resolvePath({ env: { SDLC_MODELS_FILE: '', XDG_CONFIG_HOME: '' }, platform: 'linux', home: '/h' })).toBe('/h/.config/sdlc/models.json');
    expect(resolvePath({ env: { APPDATA: '' }, platform: 'win32', home: '/h' })).toBe('/h/.config/sdlc/models.json');
  });
});

describe('exports', () => {
  test('TEST_TIMEOUT_MS is 10 seconds (AC31 seam)', () => {
    expect(lib().TEST_TIMEOUT_MS).toBe(10000);
  });
  test('parseModels trims, and a blank text gives no models', () => {
    const { parseModels } = lib();
    expect(parseModels(' a , b,c ')).toEqual(['a', 'b', 'c']);
    expect(parseModels('   ')).toEqual([]);
  });
});

describe('path (AC6)', () => {
  test('prints the path, exit 0, for a missing file', () => {
    const r = cli(['path']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(file);
    expect(fs.existsSync(file)).toBe(false);
  });
  test('works on a corrupt file and leaves it', () => {
    seed('{ nope');
    const r = cli(['path']);
    expect(r.status).toBe(0);
    expect(fs.readFileSync(file, 'utf8')).toBe('{ nope');
  });
});

describe('writing commands', () => {
  test('AC7 add creates folder and file and prints the line', () => {
    const r = cli(ADD);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('added gw (2 models)');
    expect(read().providers.gw).toMatchObject({ endpoint: 'https://gw.example/api', api_key_env: 'GW_KEY', models: ['m1', 'm2'] });
  });
  test('add trims whitespace around models', () => {
    cli(withArgs({ models: ' a , b ' }));
    expect(read().providers.gw.models).toEqual(['a', 'b']);
  });
  test('AC8 add on an existing provider replaces every field, effort included', () => {
    seed({ providers: { gw: { ...GOOD.providers.gw, effort: true }, other: { endpoint: 'https://o.example', api_key_env: 'O', models: ['x'] } } });
    const r = cli(['add', 'gw', '--endpoint', 'http://localhost:9', '--key-env', 'NEW_KEY', '--models', 'z']);
    expect(r.status).toBe(0);
    const d = read();
    expect(d.providers.gw).toMatchObject({ endpoint: 'http://localhost:9', api_key_env: 'NEW_KEY', models: ['z'], effort: false });
    expect(d.providers.other.models).toEqual(['x']);
  });
  test('add --effort sets effort true', () => {
    cli([...ADD, '--effort']);
    expect(read().providers.gw.effort).toBe(true);
  });
  test.each(['--endpoint', '--key-env', '--models'])('AC9 add without %s exits 1, names it and writes nothing', (opt) => {
    const args = [...ADD];
    const i = args.indexOf(opt);
    args.splice(i, 2);
    const r = cli(args);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(opt.replace(/^--/, ''));
    expect(fs.existsSync(path.dirname(file))).toBe(false);
  });
  test('AC10 add-model, remove-model and remove', () => {
    seed();
    let r = cli(['add-model', 'gw', 'm3']);
    expect([r.status, r.stdout.trim()]).toEqual([0, 'added gw/m3']);
    expect(read().providers.gw.models).toEqual(['m1', 'm2', 'm3']);
    r = cli(['remove-model', 'gw', 'm1']);
    expect([r.status, r.stdout.trim()]).toEqual([0, 'removed gw/m1']);
    expect(read().providers.gw.models).toEqual(['m2', 'm3']);
    r = cli(['remove', 'gw']);
    expect([r.status, r.stdout.trim()]).toEqual([0, 'removed gw']);
    expect(read().providers).toEqual({});
  });
  test('AC14 unknown keys survive a rewrite', () => {
    seed({ extra: { a: 1 }, providers: { gw: { ...GOOD.providers.gw, note: 'keep' } } });
    expect(cli(['add-model', 'gw', 'm3']).status).toBe(0);
    const d = read();
    expect(d.extra).toEqual({ a: 1 });
    expect(d.providers.gw.note).toBe('keep');
    expect(cli(ADD).status).toBe(0);
    expect(read().extra).toEqual({ a: 1 });
    expect(read().providers.gw.note).toBe('keep');
  });
});

describe('reading commands', () => {
  test('AC11 list --json one line with key_set and boolean effort', () => {
    seed({ providers: { gw: { endpoint: 'https://gw.example/api', api_key_env: 'GW_KEY', models: ['m1'] } } });
    const r = cli(['list', '--json'], { env: { GW_KEY: KEY } });
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(r.stdout)).toEqual({ providers: { gw: { endpoint: 'https://gw.example/api', api_key_env: 'GW_KEY', models: ['m1'], effort: false, key_set: true } } });
  });
  test('AC11 no file prints {"providers":{}} and creates nothing', () => {
    const r = cli(['list', '--json']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('{"providers":{}}');
    expect(fs.existsSync(path.dirname(file))).toBe(false);
  });
  test('AC12 list text format, effort suffix and key NOT set', () => {
    seed({ providers: {
      gw: { endpoint: 'https://gw.example/api', api_key_env: 'GW_KEY', models: ['m1', 'm2'], effort: true },
      lo: { endpoint: 'http://localhost:1', api_key_env: 'LO_KEY', models: ['a'] },
    } });
    const r = cli(['list'], { env: { GW_KEY: KEY } });
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split('\n')).toEqual([
      'gw  https://gw.example/api  GW_KEY (key set)  m1,m2  effort',
      'lo  http://localhost:1  LO_KEY (key NOT set)  a',
    ]);
  });
  test('AC12 empty list prints no providers (<path>)', () => {
    const r = cli(['list']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(`no providers (${file})`);
  });
  test('AC13 get prints the four lines in order', () => {
    seed({ providers: { gw: { ...GOOD.providers.gw, effort: true } } });
    const r = cli(['get', 'gw']);
    expect(r.status).toBe(0);
    expect(r.stdout.trimEnd().split('\n')).toEqual(['endpoint=https://gw.example/api', 'api_key_env=GW_KEY', 'models=m1,m2', 'effort=true']);
  });
  test('AC13 get with effort absent prints effort=false', () => {
    seed({ providers: { gw: { endpoint: 'https://e.example', api_key_env: 'K', models: ['m'] } } });
    expect(cli(['get', 'gw']).stdout.trimEnd().split('\n')[3]).toBe('effort=false');
  });
  test('AC13 get of an unknown provider (or no file) exits 1 with the fixed message', () => {
    let r = cli(['get', 'nope']);
    expect(r.status).toBe(1);
    expect(r.stderr.trim()).toBe("unknown provider 'nope'");
    seed();
    r = cli(['get', 'nope']);
    expect(r.status).toBe(1);
    expect(r.stderr.trim()).toBe("unknown provider 'nope'");
  });
  test('prototype names are not providers', () => {
    seed();
    for (const n of ['constructor', 'toString']) {
      const r = cli(['get', n]);
      expect(r.status).toBe(1);
      expect(r.stderr.trim()).toBe(`unknown provider '${n}'`);
    }
  });
});

describe('validation (AC15-AC20)', () => {
  const bytes = () => (fs.existsSync(file) ? fs.readFileSync(file) : null);
  function rejects(args, mention) {
    const before = bytes();
    const r = cli(args);
    expect(r.status).toBe(1);
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

  test.each(['Gw', '-gw', 'g_w', 'g w', 'gw.x', 'anthropic'])('AC15 provider name %s is rejected', (name) => {
    rejects(withArgs({ name }), /name|anthropic/i);
  });
  test.each(['a', '0a', 'a-b-1'])('provider name %s is accepted', (name) => {
    expect(cli(withArgs({ name })).status).toBe(0);
  });
  test.each(['/relative', 'gw.example/api', 'ftp://gw.example', 'file:///etc/passwd', 'http://gw.example', 'http://10.0.0.1', 'http://localhost.evil.com'])('AC16 endpoint %s is rejected', (endpoint) => {
    rejects(withArgs({ endpoint }), /endpoint/);
  });
  test.each(['http://localhost', 'http://localhost:4000/x', 'http://127.0.0.1:8080', 'http://[::1]:3000', 'https://anything.example', 'https://10.0.0.1'])('AC16 endpoint %s is accepted', (endpoint) => {
    expect(cli(withArgs({ endpoint })).status).toBe(0);
  });
  test.each(['gw_key', '1KEY', 'MY-KEY', 'MY KEY', 'K$'])('AC17 api_key_env %s is rejected', (v) => {
    rejects(withArgs({ 'key-env': v }), /api_key_env/);
  });
  test.each(['_KEY', 'A1_B2', 'K'])('api_key_env %s is accepted', (v) => {
    expect(cli(withArgs({ 'key-env': v })).status).toBe(0);
  });
  test('AC18 model with a space, a bad character or empty entry is rejected', () => {
    rejects(withArgs({ models: 'ok,bad model' }), /model/);
    rejects(withArgs({ models: 'ok,b@d' }), /model/);
    rejects(withArgs({ models: 'a,,b' }), /model/);
  });
  test('AC18 an empty model list is rejected', () => {
    rejects(withArgs({ models: '' }), /model/);
    rejects(withArgs({ models: '  ' }), /model/);
  });
  test('AC18 50 models accepted, 51 rejected', () => {
    const many = n => Array.from({ length: n }, (_, i) => `m${i}`).join(',');
    rejects(withArgs({ models: many(51) }), /model|50/);
    expect(cli(withArgs({ models: many(50) })).status).toBe(0);
  });
  test('AC18 duplicate model is rejected', () => {
    rejects(withArgs({ models: 'a,b,a' }), /duplicate|model/);
  });
  test('model names with . : / - _ are accepted', () => {
    expect(cli(withArgs({ models: 'openai/gpt-5,llama3:8b,v1.2_x' })).status).toBe(0);
  });

  test('AC19 unknown provider for add-model, remove-model, remove', () => {
    seed();
    rejects(['add-model', 'nope', 'm'], /nope/);
    rejects(['remove-model', 'nope', 'm'], /nope/);
    rejects(['remove', 'nope'], /nope/);
  });
  test('AC19 add-model of a listed model, an invalid model, the 51st model', () => {
    seed();
    rejects(['add-model', 'gw', 'm1'], /m1/);
    rejects(['add-model', 'gw', 'bad model'], /model/);
    seed({ providers: { gw: { ...GOOD.providers.gw, models: Array.from({ length: 50 }, (_, i) => `m${i}`) } } });
    rejects(['add-model', 'gw', 'extra'], /50|model/);
  });
  test('AC19 remove-model of an unlisted model', () => {
    seed();
    rejects(['remove-model', 'gw', 'zzz'], /zzz/);
  });
  test('AC20 remove-model of the last model points to remove <provider>', () => {
    seed({ providers: { gw: { ...GOOD.providers.gw, models: ['only'] } } });
    rejects(['remove-model', 'gw', 'only'], /remove gw/);
    expect(read().providers.gw.models).toEqual(['only']);
  });
  test('usage errors exit 1: unknown command, unknown option, missing argument', () => {
    expect(cli(['bogus']).status).toBe(1);
    expect(cli([]).status).toBe(1);
    seed();
    expect(cli(['list', '--bogus']).status).toBe(1);
    expect(cli(['get']).status).toBe(1);
    expect(cli(['add-model', 'gw']).status).toBe(1);
    expect(cli([...ADD, '--bogus']).status).toBe(1);
  });
});

describe('file integrity (AC21-AC24)', () => {
  test('AC21 no .tmp after success or rejection', () => {
    cli(ADD);
    expect(fs.readdirSync(path.dirname(file)).sort()).toEqual(['models.json']);
    cli(withArgs({ name: 'Bad' }));
    cli(['remove-model', 'gw', 'nope']);
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
  describe.each(Object.entries(broken))('%s', (_label, content) => {
    test.each(ALL)('%s exits 1 naming the file and leaves it unchanged', (_n, args) => {
      seed(content);
      const r = cli(args, { env: { GW_KEY: KEY } });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(file);
      expect(fs.readFileSync(file, 'utf8')).toBe(content);
      expect(fs.existsSync(`${file}.tmp`)).toBe(false);
    });
  });
  test('AC24 the message names the provider and the rule', () => {
    seed({ providers: { ok: { endpoint: 'https://a.example', api_key_env: 'K', models: ['m'] }, gw: { ...GOOD.providers.gw, endpoint: 'http://gw.example' } } });
    const r = cli(['list']);
    expect(r.stderr).toContain('gw');
    expect(r.stderr).toMatch(/endpoint/);
  });
});

describe('key handling (AC25-AC27)', () => {
  const keySet = (env, cwd) => JSON.parse(cli(['list', '--json'], { env, cwd }).stdout).providers.gw.key_set;
  test('AC25 true when set, false when unset or empty', () => {
    seed();
    expect(keySet({ GW_KEY: KEY })).toBe(true);
    expect(keySet({})).toBe(false);
    expect(keySet({ GW_KEY: '' })).toBe(false);
  });
  test('AC26 a key only in .env of the working directory is not set', () => {
    seed();
    fs.writeFileSync(path.join(dir, '.env'), `GW_KEY=${KEY}\n`);
    expect(keySet({}, dir)).toBe(false);
  });
  test('AC27 the key value appears in no output of list, list --json, get and error paths', () => {
    seed({ providers: { gw: { ...GOOD.providers.gw, effort: true } } });
    const env = { GW_KEY: KEY };
    const runs = [['list'], ['list', '--json'], ['get', 'gw'], ['get', 'nope'], ['test', 'nope/m'], ['test', 'gw/unlisted'], ['add-model', 'gw', 'm1'], ['path']];
    for (const a of runs) {
      const r = cli(a, { env });
      expect(r.stdout + r.stderr).not.toContain(KEY);
    }
  });
});

describe('test command (AC28-AC33)', () => {
  const { main } = lib();
  let server;
  let reqs;
  let handler;

  beforeEach(async () => {
    reqs = [];
    handler = (req, res) => { res.statusCode = 200; res.end('{}'); };
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

  test('AC28 200 prints ok and sends the documented request', async () => {
    seedServer();
    const r = await run(['test', 'gw/m1']);
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
  });
  test('a 2xx other than 200 is ok', async () => {
    seedServer();
    handler = (req, res) => { res.statusCode = 204; res.end(); };
    expect((await run(['test', 'gw/m1'])).code).toBe(0);
  });
  test('model names containing a slash split at the first slash', async () => {
    seed({ providers: { gw: { endpoint: url(), api_key_env: 'GW_KEY', models: ['openai/gpt-5'] } } });
    const r = await run(['test', 'gw/openai/gpt-5']);
    expect(r.code).toBe(0);
    expect(JSON.parse(reqs[0].body).model).toBe('openai/gpt-5');
  });
  test('AC29 trailing slashes on the endpoint do not double up, and the stored value is unchanged', async () => {
    seedServer(`${url()}///`);
    const r = await run(['test', 'gw/m1']);
    expect(r.code).toBe(0);
    expect(reqs[0].url).toBe('/v1/messages');
    expect(read().providers.gw.endpoint).toBe(`${url()}///`);
  });
  test('AC30 401 prints HTTP 401 and at most 200 characters of the body', async () => {
    seedServer();
    handler = (req, res) => { res.statusCode = 401; res.end('x'.repeat(500)); };
    const r = await run(['test', 'gw/m1']);
    expect(r.code).toBe(1);
    expect(`${r.out}${r.err}`.trim()).toBe(`HTTP 401: ${'x'.repeat(200)}`);
  });
  test('AC30 a 500 is also a failure', async () => {
    seedServer();
    handler = (req, res) => { res.statusCode = 500; res.end('boom'); };
    const r = await run(['test', 'gw/m1']);
    expect(r.code).toBe(1);
    expect(`${r.out}${r.err}`.trim()).toBe('HTTP 500: boom');
  });
  test('AC27 a gateway that echoes the key does not leak it', async () => {
    seedServer();
    handler = (req, res) => { res.statusCode = 401; res.end(`bad token ${KEY}`); };
    const r = await run(['test', 'gw/m1']);
    expect(r.code).toBe(1);
    expect(`${r.out}${r.err}`).not.toContain(KEY);
  });
  test('AC31 no answer within the timeout prints timeout after <n>s', async () => {
    seedServer();
    handler = () => {};
    const r = await run(['test', 'gw/m1'], { timeoutMs: 200 });
    expect(r.code).toBe(1);
    expect(`${r.out}${r.err}`.trim()).toBe('timeout after 0.2s');
  });
  test('AC32 nothing listening prints connection failed: <code>', async () => {
    const ep = url();
    await new Promise(r => server.close(() => r()));
    seedServer(ep);
    const r = await run(['test', 'gw/m1']);
    expect(r.code).toBe(1);
    expect(`${r.out}${r.err}`.trim()).toBe('connection failed: ECONNREFUSED');
    server = http.createServer();
  });
  test('AC33 unknown provider, unlisted model, key unset: exit 1, nothing sent', async () => {
    seedServer();
    let r = await run(['test', 'nope/m1']);
    expect([r.code, r.err]).toEqual([1, expect.stringContaining('nope')]);
    r = await run(['test', 'gw/zzz']);
    expect([r.code, r.err]).toEqual([1, expect.stringContaining('zzz')]);
    r = await run(['test', 'gw/m1'], { env: {} });
    expect([r.code, r.err]).toEqual([1, expect.stringContaining('GW_KEY')]);
    r = await run(['test', 'gw/m1'], { env: { GW_KEY: '' } });
    expect([r.code, r.err]).toEqual([1, expect.stringContaining('GW_KEY')]);
    expect(reqs).toHaveLength(0);
  });
  test('AC33 a key only in .env of the working directory is not used (CLI)', async () => {
    seedServer();
    fs.writeFileSync(path.join(dir, '.env'), `GW_KEY=${KEY}\n`);
    const r = cli(['test', 'gw/m1'], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('GW_KEY');
    expect(reqs).toHaveLength(0);
  });
  test('test on a missing file is an unknown provider', async () => {
    const r = await run(['test', 'gw/m1']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('gw');
  });
});
