const express = require('express');
const request = require('supertest');
const loggerModule = require('../../logger');
const requestLogger = require('../../middleware/requestLogger');

const lines = [];
const sink = { write: (s) => { lines.push(s); } };
const entries = () => lines.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const LABELS = 'logging.googleapis.com/labels';
const TRACE = 'logging.googleapis.com/trace';
const SPAN = 'logging.googleapis.com/spanId';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function makeApp(rootStatus = 200) {
  const app = express();
  app.use(requestLogger);
  app.get('/', (req, res) => res.status(rootStatus).json({ ok: true }));
  app.post('/', (req, res) => res.json({ ok: true }));
  app.get('/health', (req, res) => res.status(rootStatus).json({ ok: true }));
  app.get('/items', (req, res) => res.json({ ok: true }));
  app.get('/missing', (req, res) => res.status(404).json({ error: 'nf' }));
  app.get('/boom', (req, res) => res.status(500).json({ error: 'x' }));
  return app;
}

const settle = () => new Promise(setImmediate);
let savedLogger;
let savedProject;

beforeEach(() => {
  lines.length = 0;
  savedLogger = loggerModule.logger;
  savedProject = process.env.GOOGLE_CLOUD_PROJECT;
  delete process.env.GOOGLE_CLOUD_PROJECT;
  loggerModule.logger = loggerModule.createLogger(sink);
});

afterEach(() => {
  loggerModule.logger = savedLogger;
  if (savedProject === undefined) delete process.env.GOOGLE_CLOUD_PROJECT;
  else process.env.GOOGLE_CLOUD_PROJECT = savedProject;
});

describe('requestLogger', () => {
  test('RL-1 httpRequest has method, path-only url, status, userAgent, remoteIp, protocol and latency', async () => {
    await request(makeApp()).get('/items?token=abc').set('User-Agent', 'jest-agent/1.0');
    await settle();
    const all = entries();
    expect(all).toHaveLength(1);
    const h = all[0].httpRequest;
    expect(h.requestMethod).toBe('GET');
    expect(h.requestUrl).toBe('/items');
    expect(h.status).toBe(200);
    expect(h.userAgent).toBe('jest-agent/1.0');
    expect(typeof h.remoteIp).toBe('string');
    expect(h.remoteIp).not.toBe('');
    expect(h.protocol).toBe('HTTP/1.1');
    expect(h.latency).toMatch(/^\d+(\.\d+)?s$/);
    expect(all[0].message).toBeTruthy();
  });

  test('RL-2 200 is INFO, 404 WARNING, 500 ERROR', async () => {
    const app = makeApp();
    for (const [path, severity] of [['/items', 'INFO'], ['/missing', 'WARNING'], ['/boom', 'ERROR']]) {
      lines.length = 0;
      await request(app).get(path);
      await settle();
      expect([path, entries().map((e) => e.severity)]).toEqual([path, [severity]]);
    }
  });

  test('RL-3 GET / and GET /health are skipped below 400 but logged at 400 and above; POST / is logged', async () => {
    const ok = makeApp(200);
    await request(ok).get('/');
    await request(ok).get('/health');
    await settle();
    expect(entries()).toHaveLength(0);

    await request(ok).post('/');
    await settle();
    expect(entries()).toHaveLength(1);

    lines.length = 0;
    const failing = makeApp(500);
    await request(failing).get('/');
    await request(failing).get('/health');
    await settle();
    const got = entries();
    expect(got.map((e) => e.httpRequest.requestUrl)).toEqual(['/', '/health']);
    expect(got.every((e) => e.severity === 'ERROR')).toBe(true);
  });

  test('RL-4 a valid X-Request-Id is reused; an absent or invalid one is replaced by a UUID and never logged', async () => {
    const app = makeApp();
    let res = await request(app).get('/items').set('X-Request-Id', 'abc-123:x.y_z');
    await settle();
    expect(res.headers['x-request-id']).toBe('abc-123:x.y_z');
    expect(entries()[0][LABELS]).toEqual({ requestId: 'abc-123:x.y_z' });

    lines.length = 0;
    res = await request(app).get('/items');
    await settle();
    expect(res.headers['x-request-id']).toMatch(UUID);
    expect(entries()[0][LABELS].requestId).toBe(res.headers['x-request-id']);

    const invalid = {
      empty: '',
      tooLong: 'a'.repeat(129),
      badChars: 'bad id!',
      duplicated: ['dup-one', 'dup-two'],
    };
    for (const [name, value] of Object.entries(invalid)) {
      lines.length = 0;
      res = await request(app).get('/items').set('X-Request-Id', value);
      await settle();
      const out = lines.join('');
      expect([name, res.headers['x-request-id']]).toEqual([name, expect.stringMatching(UUID)]);
      expect([name, entries()[0][LABELS].requestId]).toEqual([name, res.headers['x-request-id']]);
      for (const raw of [].concat(value).filter(Boolean)) {
        expect([name, out.includes(raw)]).toEqual([name, false]);
        expect([name, String(res.headers['x-request-id']).includes(raw)]).toEqual([name, false]);
      }
    }

    // exactly 128 characters is accepted
    const max = 'a'.repeat(128);
    res = await request(app).get('/items').set('X-Request-Id', max);
    expect(res.headers['x-request-id']).toBe(max);
  });

  test('RL-5 trace fields need both the header and GOOGLE_CLOUD_PROJECT', async () => {
    const app = makeApp();
    const run = async (header) => {
      lines.length = 0;
      const r = request(app).get('/items');
      if (header !== undefined) r.set('X-Cloud-Trace-Context', header);
      const res = await r;
      await settle();
      return { res, entry: entries()[0] };
    };

    process.env.GOOGLE_CLOUD_PROJECT = 'proj';
    let { entry } = await run('abc123/456;o=1');
    expect(entry[TRACE]).toBe('projects/proj/traces/abc123');
    expect(entry[SPAN]).toBe('456');

    ({ entry } = await run('abc123/456'));
    expect(entry[TRACE]).toBe('projects/proj/traces/abc123');
    expect(entry[SPAN]).toBe('456');

    ({ entry } = await run('abc123'));
    expect(entry[TRACE]).toBe('projects/proj/traces/abc123');
    expect(entry).not.toHaveProperty([SPAN]);

    for (const bad of [undefined, '/123', '', ';o=1']) {
      const r = await run(bad);
      expect([bad, r.res.statusCode]).toEqual([bad, 200]);
      expect([bad, r.entry[TRACE]]).toEqual([bad, undefined]);
      expect([bad, r.entry[SPAN]]).toEqual([bad, undefined]);
    }

    delete process.env.GOOGLE_CLOUD_PROJECT;
    ({ entry } = await run('abc123/456;o=1'));
    expect(entry[TRACE]).toBeUndefined();
    expect(entry[SPAN]).toBeUndefined();
  });

  test('RL-6 never logs the x-auth-token value, cookie values or the query string', async () => {
    await request(makeApp())
      .get('/items?q=QUERY-SECRET')
      .set('x-auth-token', 'tok-SECRET')
      .set('Cookie', 'sid=COOKIE-SECRET');
    await settle();
    const out = lines.join('');
    expect(out).not.toBe('');
    for (const secret of ['tok-SECRET', 'COOKIE-SECRET', 'QUERY-SECRET']) {
      expect([secret, out.includes(secret)]).toEqual([secret, false]);
    }
  });

  test('exports resolveRequestId and parseTraceContext as pure helpers', () => {
    expect(requestLogger.resolveRequestId('ok-1')).toBe('ok-1');
    expect(requestLogger.resolveRequestId('a, b')).toMatch(UUID);
    expect(requestLogger.parseTraceContext('t/s;o=1', 'p')).toEqual({ [TRACE]: 'projects/p/traces/t', [SPAN]: 's' });
    expect(requestLogger.parseTraceContext('t/s', '')).toEqual({});
  });
});
