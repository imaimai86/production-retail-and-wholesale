const http = require('http');
const errorHandler = require('../../middleware/errorHandler');
const loggerModule = require('../../logger');

const lines = [];
const sink = { write: (s) => { lines.push(s); } };
const entries = () => lines.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l));

function makeRes(overrides = {}) {
  const res = { headersSent: false, status: jest.fn(), json: jest.fn(), ...overrides };
  res.status.mockReturnValue(res);
  return res;
}

function run(err, resOverrides, req = {}) {
  const res = makeRes(resOverrides);
  const next = jest.fn();
  errorHandler(err, req, res, next);
  return { res, next };
}

// The response for `err`, as [status, body]; `label` names the case in a failure.
const answer = (label, err) => {
  const { res } = run(err);
  return [label, res.status.mock.calls, res.json.mock.calls];
};
const expected = (label, code, text) => [label, [[code]], [[{ error: text }]]];
const GENERIC = 'Internal server error';

describe('errorHandler middleware', () => {
  let savedLogger;

  beforeEach(() => {
    lines.length = 0;
    savedLogger = loggerModule.logger;
    loggerModule.logger = loggerModule.createLogger(sink);
  });

  afterEach(() => {
    loggerModule.logger = savedLogger;
  });

  test('EH-01..07 it takes four parameters; a valid 4xx status (then statusCode) is used with its http.STATUS_CODES text', () => {
    // EH-01 four parameters make Express treat it as an error handler
    expect(typeof errorHandler).toBe('function');
    expect(errorHandler.length).toBe(4);

    expect(answer('EH-02 plain Error', new Error('boom'))).toEqual(expected('EH-02 plain Error', 500, GENERIC));
    expect(answer('EH-03', Object.assign(new Error('x'), { status: 404 }))).toEqual(expected('EH-03', 404, 'Not Found'));
    expect(answer('EH-04 statusCode alone', Object.assign(new Error('x'), { statusCode: 422 })))
      .toEqual(expected('EH-04 statusCode alone', 422, 'Unprocessable Entity'));
    expect(answer('EH-05 status wins', { status: 400, statusCode: 404 })).toEqual(expected('EH-05 status wins', 400, 'Bad Request'));
    expect(answer('EH-06 invalid status falls through', { status: 'abc', statusCode: 403 }))
      .toEqual(expected('EH-06 invalid status falls through', 403, 'Forbidden'));
    for (const code of [400, 401, 403, 404, 409, 418, 422, 429, 499]) {
      expect(answer(`EH-07 ${code}`, { status: code })).toEqual(expected(`EH-07 ${code}`, code, http.STATUS_CODES[code]));
    }
  });

  test('EH-08..10 an invalid status or statusCode, or a non-object error, returns the 500 generic body', () => {
    const invalid = [
      ['302 (3xx)', 302],
      ['399 (just below range)', 399],
      ['500', 500],
      ['503', 503],
      ['600 (above range)', 600],
      ['0', 0],
      ['-404 (negative)', -404],
      ['"400" (string)', '400'],
      ['400.5 (non-integer)', 400.5],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['null', null],
      ['true', true],
      ['object', {}],
    ];
    for (const [label, value] of invalid) {
      expect(answer(`EH-08 ${label}`, { status: value })).toEqual(expected(`EH-08 ${label}`, 500, GENERIC));
    }
    expect(answer('EH-09 string statusCode', { statusCode: '422' })).toEqual(expected('EH-09 string statusCode', 500, GENERIC));
    for (const err of [null, undefined, 'a string', 42]) {
      expect(answer(`EH-10 ${String(err)}`, err)).toEqual(expected(`EH-10 ${String(err)}`, 500, GENERIC));
    }
  });

  test('EH-11..15 the body is exactly {error}, never the message, code, stack or SQL, whatever NODE_ENV; it responds once', () => {
    // EH-11 a 5xx
    let err = Object.assign(new Error('secret db detail'), {
      code: '23505',
      detail: 'Key (email)=(a@b.c) already exists',
      sql: 'SELECT * FROM users',
    });
    let payload = run(err).res.json.mock.calls[0][0];
    expect(payload).toEqual({ error: GENERIC });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('secret db detail');
    expect(serialized).not.toContain('23505');
    expect(serialized).not.toContain('SELECT');
    expect(serialized).not.toContain('already exists');
    expect(serialized).not.toContain(err.stack.split('\n')[1].trim());
    expect(serialized).not.toMatch(/\.js/);

    // EH-12 a 4xx
    err = Object.assign(new Error('relation "users" does not exist'), { status: 400, code: 'ABC123' });
    payload = run(err).res.json.mock.calls[0][0];
    expect(payload).toEqual({ error: 'Bad Request' });
    expect(JSON.stringify(payload)).not.toContain('relation');
    expect(JSON.stringify(payload)).not.toContain('ABC123');

    // EH-13 exactly one key
    expect(Object.keys(run(Object.assign(new Error('m'), { status: 404 })).res.json.mock.calls[0][0])).toEqual(['error']);

    // EH-14 the same generic body regardless of NODE_ENV
    const prev = process.env.NODE_ENV;
    try {
      for (const env of ['development', 'production', 'test', undefined]) {
        if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env;
        expect(run(new Error('secret db detail')).res.json).toHaveBeenCalledWith({ error: GENERIC });
      }
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev;
    }

    // EH-15 responds exactly once and does not call next
    const { res, next } = run(new Error('x'));
    expect(res.status).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });

  test('EH-16..20 every error is logged once; with headers already sent it delegates to next(err) and writes nothing', () => {
    const req = { requestId: 'rid-1', method: 'GET', originalUrl: '/x?y=1' };
    let err = Object.assign(new Error('secret db detail'), { code: 'E_DB' });
    run(err, undefined, req);
    let got = entries();
    expect(got).toHaveLength(1);
    expect(got[0].severity).toBe('ERROR');
    expect(got[0].message).toContain('secret db detail');
    expect(got[0].message).toContain('    at ');
    expect(got[0].error.code).toBe('E_DB');
    expect(got[0]['logging.googleapis.com/labels']).toEqual({ requestId: 'rid-1' });
    expect(got[0].httpRequest.requestMethod).toBe('GET');
    expect(got[0].httpRequest.requestUrl).toBe('/x');
    expect(JSON.stringify(got[0])).not.toContain('y=1');

    // EH-17 4xx errors are WARNING
    lines.length = 0;
    run(Object.assign(new Error('nope'), { status: 404 }), undefined, req);
    got = entries();
    expect(got).toHaveLength(1);
    expect(got[0].severity).toBe('WARNING');

    // EH-18 EH-19 headers already sent
    lines.length = 0;
    err = new Error('late failure');
    let { res, next } = run(err, { headersSent: true });
    expect(entries()).toHaveLength(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();

    // EH-20 also for a 4xx-status error; a thrown string is logged without throwing
    lines.length = 0;
    err = Object.assign(new Error('x'), { status: 404 });
    ({ res, next } = run(err, { headersSent: true }));
    expect(entries()).toHaveLength(1);
    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();

    lines.length = 0;
    let out;
    expect(() => { out = run('boom'); }).not.toThrow();
    expect(entries()).toHaveLength(1);
    expect(out.res.status).toHaveBeenCalledWith(500);
    expect(out.res.json).toHaveBeenCalledWith({ error: GENERIC });
  });

  test('EH-21 logs constraint, table and column but never detail or where', () => {
    const err = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'users_email_key',
      table: 'users',
      column: 'email',
      detail: 'Key (email)=(a@b.c) already exists.',
      where: 'SQL function "f"',
    });
    run(err);
    const got = entries();
    expect(got).toHaveLength(1);
    expect(got[0].error).toEqual(expect.objectContaining({
      code: '23505', constraint: 'users_email_key', table: 'users', column: 'email',
    }));
    const out = lines.join('');
    expect(out).not.toContain('a@b.c');
    expect(out).not.toContain('SQL function');
  });
});
