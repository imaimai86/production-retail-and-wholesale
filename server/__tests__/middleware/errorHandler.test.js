const http = require('http');
const errorHandler = require('../../middleware/errorHandler');

function makeRes(overrides = {}) {
  const res = { headersSent: false, status: jest.fn(), json: jest.fn(), ...overrides };
  res.status.mockReturnValue(res);
  return res;
}

function run(err, resOverrides) {
  const res = makeRes(resOverrides);
  const next = jest.fn();
  errorHandler(err, {}, res, next);
  return { res, next };
}

describe('errorHandler middleware', () => {
  let errorSpy;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  test('EH-01 declares four parameters so Express treats it as an error handler', () => {
    expect(typeof errorHandler).toBe('function');
    expect(errorHandler.length).toBe(4);
  });

  describe('status selection', () => {
    test('EH-02 plain Error returns 500 generic body', () => {
      const { res } = run(new Error('boom'));
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    });

    test('EH-03 err.status 404 returns 404 Not Found', () => {
      const { res } = run(Object.assign(new Error('x'), { status: 404 }));
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Not Found' });
    });

    test('EH-04 err.statusCode 422 without status returns 422', () => {
      const { res } = run(Object.assign(new Error('x'), { statusCode: 422 }));
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unprocessable Entity' });
    });

    test('EH-05 status takes precedence over statusCode', () => {
      const { res } = run({ status: 400, statusCode: 404 });
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Bad Request' });
    });

    test('EH-06 invalid status falls through to a valid statusCode', () => {
      const { res } = run({ status: 'abc', statusCode: 403 });
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden' });
    });

    test.each([400, 401, 403, 404, 409, 418, 422, 429, 499])(
      'EH-07 valid 4xx status %i uses http.STATUS_CODES text',
      (code) => {
        const { res } = run({ status: code });
        expect(res.status).toHaveBeenCalledWith(code);
        expect(res.json).toHaveBeenCalledWith({ error: http.STATUS_CODES[code] });
      }
    );

    test.each([
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
    ])('EH-08 invalid status %s returns 500 generic body', (_label, value) => {
      const { res } = run({ status: value });
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    });

    test('EH-09 invalid statusCode (string) with no status returns 500', () => {
      const { res } = run({ statusCode: '422' });
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    });

    test.each([null, undefined, 'a string', 42])(
      'EH-10 non-object error %p returns 500 without throwing',
      (err) => {
        const { res } = run(err);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
      }
    );
  });

  describe('response body', () => {
    test('EH-11 5xx body never includes message, code, stack or SQL text', () => {
      const err = Object.assign(new Error('secret db detail'), {
        code: '23505',
        detail: 'Key (email)=(a@b.c) already exists',
        sql: 'SELECT * FROM users',
      });
      const { res } = run(err);
      const payload = res.json.mock.calls[0][0];
      expect(payload).toEqual({ error: 'Internal server error' });
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain('secret db detail');
      expect(serialized).not.toContain('23505');
      expect(serialized).not.toContain('SELECT');
      expect(serialized).not.toContain('already exists');
      expect(serialized).not.toContain(err.stack.split('\n')[1].trim());
      expect(serialized).not.toMatch(/\.js/);
    });

    test('EH-12 4xx body never includes err.message or err.code', () => {
      const err = Object.assign(new Error('relation "users" does not exist'), { status: 400, code: 'ABC123' });
      const { res } = run(err);
      const payload = res.json.mock.calls[0][0];
      expect(payload).toEqual({ error: 'Bad Request' });
      expect(JSON.stringify(payload)).not.toContain('relation');
      expect(JSON.stringify(payload)).not.toContain('ABC123');
    });

    test('EH-13 body has exactly one key, "error"', () => {
      const { res } = run(Object.assign(new Error('m'), { status: 404 }));
      expect(Object.keys(res.json.mock.calls[0][0])).toEqual(['error']);
    });

    test('EH-14 same generic body regardless of NODE_ENV', () => {
      const prev = process.env.NODE_ENV;
      try {
        for (const env of ['development', 'production', 'test', undefined]) {
          if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env;
          const { res } = run(new Error('secret db detail'));
          expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
        }
      } finally {
        if (prev === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev;
      }
    });

    test('EH-15 responds exactly once and does not call next', () => {
      const { res, next } = run(new Error('x'));
      expect(res.status).toHaveBeenCalledTimes(1);
      expect(res.json).toHaveBeenCalledTimes(1);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('logging', () => {
    test('EH-16 logs the error via console.error', () => {
      const err = new Error('secret db detail');
      run(err);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(err);
    });

    test('EH-17 logs 4xx errors too', () => {
      const err = Object.assign(new Error('nope'), { status: 404 });
      run(err);
      expect(errorSpy).toHaveBeenCalledWith(err);
    });

    test('EH-18 logs even when headers were already sent', () => {
      const err = new Error('late');
      run(err, { headersSent: true });
      expect(errorSpy).toHaveBeenCalledWith(err);
    });
  });

  describe('headers already sent', () => {
    test('EH-19 delegates to next(err) and writes nothing', () => {
      const err = new Error('late failure');
      const { res, next } = run(err, { headersSent: true });
      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(err);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    test('EH-20 delegates even for a 4xx-status error', () => {
      const err = Object.assign(new Error('x'), { status: 404 });
      const { res, next } = run(err, { headersSent: true });
      expect(next).toHaveBeenCalledWith(err);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });
});
