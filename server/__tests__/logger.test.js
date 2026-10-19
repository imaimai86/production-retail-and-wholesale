const {
  createLogger,
  resolveLogFormat,
  resolveLogLevel,
  buildLogger,
  attachProcessHandlers,
} = require('../logger');
const pkg = require('../package.json');

function makeSink() {
  const lines = [];
  return {
    lines,
    sink: { write: (s) => { lines.push(s); } },
    entries: () => lines.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
  };
}

describe('resolveLogFormat', () => {
  test('LG-1 follows the §4.2 table; LOG_FORMAT wins and invalid values fall through', () => {
    const cases = [
      [{ LOG_FORMAT: 'pretty', KUBERNETES_SERVICE_HOST: '10.0.0.1', NODE_ENV: 'production' }, 'pretty'],
      [{ LOG_FORMAT: 'JSON' }, 'json'],
      [{ LOG_FORMAT: ' Pretty ' }, 'pretty'],
      [{ LOG_FORMAT: 'json', NODE_ENV: 'development' }, 'json'],
      [{ KUBERNETES_SERVICE_HOST: '10.0.0.1' }, 'json'],
      [{ NODE_ENV: 'production' }, 'json'],
      [{}, 'pretty'],
      [{ NODE_ENV: 'development' }, 'pretty'],
      [{ KUBERNETES_SERVICE_HOST: '' }, 'pretty'],
      [{ LOG_FORMAT: '' }, 'pretty'],
      [{ LOG_FORMAT: 'xml', KUBERNETES_SERVICE_HOST: '10.0.0.1' }, 'json'],
      [{ LOG_FORMAT: 'xml' }, 'pretty'],
    ];
    for (const [env, expected] of cases) {
      expect([JSON.stringify(env), resolveLogFormat(env)]).toEqual([JSON.stringify(env), expected]);
    }
  });
});

describe('pretty mode and fallback', () => {
  test('LG-2 pretty mode asks for pino-pretty; when loading throws it falls back to json with exactly one WARNING', () => {
    const raw = [];
    const prettyFactory = jest.fn(() => ({ write: (s) => { raw.push(s); } }));
    const out = makeSink();

    jest.isolateModules(() => {
      jest.doMock('pino-pretty', () => prettyFactory, { virtual: true });
      const { buildLogger: build } = require('../logger');
      const log = build({ format: 'pretty', destination: out.sink, env: {} });
      log.info('hello');
    });
    expect(prettyFactory).toHaveBeenCalledTimes(1);
    expect(prettyFactory.mock.calls[0][0]).toEqual(expect.objectContaining({ sync: true }));
    expect(raw.length).toBe(1);
    expect(out.lines).toEqual([]);

    jest.isolateModules(() => {
      jest.doMock('pino-pretty', () => { throw new Error('cannot load'); }, { virtual: true });
      const { buildLogger: build } = require('../logger');
      let log;
      expect(() => { log = build({ format: 'pretty', destination: out.sink, env: {} }); }).not.toThrow();
      log.info('after fallback');
    });
    const entries = out.entries();
    const warnings = entries.filter((e) => e.severity === 'WARNING');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/pino-pretty/);
    expect(entries[entries.length - 1].message).toBe('after fallback');
    jest.dontMock('pino-pretty');
  });

  test('LG-3 pretty and json modes emit the same events at the same levels', () => {
    const raw = [];
    const out = makeSink();
    jest.isolateModules(() => {
      jest.doMock('pino-pretty', () => () => ({ write: (s) => { raw.push(s); } }), { virtual: true });
      const { buildLogger: build } = require('../logger');
      const pretty = build({ format: 'pretty', destination: { isTTY: false, write() {} }, env: {} });
      for (const log of [pretty, createLogger(out.sink)]) {
        log.info('a');
        log.warn('b');
        log.error(new Error('x'));
      }
    });
    jest.dontMock('pino-pretty');
    const prettyLevels = raw.map((l) => JSON.parse(l).level);
    const toNum = { INFO: 30, WARNING: 40, ERROR: 50 };
    const jsonLevels = out.entries().map((e) => toNum[e.severity]);
    expect(prettyLevels).toEqual([30, 40, 50]);
    expect(jsonLevels).toEqual(prettyLevels);
  });
});

describe('json output', () => {
  test('LG-4 every line is one JSON object with severity, message and an ISO timestamp', () => {
    const { sink, lines, entries } = makeSink();
    const log = createLogger(sink);
    log.info('i');
    log.warn('w');
    log.error('e');
    log.fatal('f');
    expect(lines.join('').split('\n').filter(Boolean)).toHaveLength(4);
    const got = entries();
    expect(got.map((e) => e.severity)).toEqual(['INFO', 'WARNING', 'ERROR', 'CRITICAL']);
    for (const e of got) {
      expect(typeof e.message).toBe('string');
      expect(typeof e.timestamp).toBe('string');
      expect(new Date(e.timestamp).toISOString()).toBe(e.timestamp);
    }
    expect(got.map((e) => e.message)).toEqual(['i', 'w', 'e', 'f']);
  });

  test('LG-5 error entries carry serviceContext and the stack inside message', () => {
    const { sink, entries } = makeSink();
    const log = createLogger(sink);
    log.error(new Error('secret db detail'));
    log.error({ err: new Error('secret db detail') }, 'ctx');
    for (const e of entries()) {
      expect(e.serviceContext.service).toBe('production-retail-and-wholesale');
      expect(e.serviceContext.version).toBe(pkg.version);
      expect(e.message).toContain('Error: secret db detail\n    at ');
    }
  });

  test('LG-6 LOG_LEVEL never goes below warn; info is the default; case and spaces are ignored', () => {
    const emitted = (level, method) => {
      const { sink, entries } = makeSink();
      const log = buildLogger({ format: 'json', destination: sink, env: level === undefined ? {} : { LOG_LEVEL: level } });
      log[method]('m');
      return entries().length;
    };
    for (const v of ['error', 'silent', 'bogus', 'FATAL']) {
      expect([v, emitted(v, 'warn')]).toEqual([v, 1]);
      expect([v, emitted(v, 'info')]).toEqual([v, 0]);
    }
    for (const v of ['info', 'INFO', undefined, '', '  ']) {
      expect([String(v), emitted(v, 'info')]).toEqual([String(v), 1]);
      expect([String(v), emitted(v, 'debug')]).toEqual([String(v), 0]);
    }
    expect(emitted('debug', 'debug')).toBe(1);
    expect(resolveLogLevel(' Debug ')).toBe('debug');
    expect(resolveLogLevel('bogus')).toBe('warn');
    expect(resolveLogLevel(undefined)).toBe('info');
  });

  test('createLogger writes under Jest even though the default logger is silent', () => {
    const { sink, entries } = makeSink();
    createLogger(sink).info('visible');
    expect(entries()).toHaveLength(1);
  });
});

describe('default logger under Jest', () => {
  const saved = { LOG_IN_TESTS: process.env.LOG_IN_TESTS, LOG_FORMAT: process.env.LOG_FORMAT };
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    jest.restoreAllMocks();
  });

  test('LG-7 writes nothing to stdout unless LOG_IN_TESTS=1', () => {
    expect(process.env.JEST_WORKER_ID).toBeDefined();
    process.env.LOG_FORMAT = 'json';
    delete process.env.LOG_IN_TESTS;
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.isolateModules(() => {
      require('../logger').logger.warn('silent please');
    });
    expect(spy).not.toHaveBeenCalled();

    process.env.LOG_IN_TESTS = '1';
    jest.isolateModules(() => {
      require('../logger').logger.warn('now visible');
    });
    const written = spy.mock.calls.map((c) => String(c[0])).join('');
    const lines = written.split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).message).toBe('now visible');
  });
});

describe('attachProcessHandlers', () => {
  afterEach(() => jest.restoreAllMocks());

  test('LG-8 registers both handlers; each logs CRITICAL and exits with 1', async () => {
    const handlers = {};
    jest.spyOn(process, 'on').mockImplementation((event, fn) => { handlers[event] = fn; return process; });
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => undefined);
    const { sink, entries } = makeSink();

    attachProcessHandlers(createLogger(sink));
    expect(typeof handlers.uncaughtException).toBe('function');
    expect(typeof handlers.unhandledRejection).toBe('function');

    for (const event of ['uncaughtException', 'unhandledRejection']) {
      for (const reason of [new Error('boom'), 'plain string', undefined]) {
        exit.mockClear();
        const before = entries().length;
        handlers[event](reason);
        await new Promise(setImmediate);
        const added = entries().slice(before);
        expect(added).toHaveLength(1);
        expect(added[0].severity).toBe('CRITICAL');
        if (reason instanceof Error) expect(added[0].message).toContain('Error: boom\n    at ');
        expect(exit).toHaveBeenCalledWith(1);
      }
    }
  });
});
