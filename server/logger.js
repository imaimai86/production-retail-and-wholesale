const pino = require('pino');
const { createGcpLoggingPinoConfig } = require('@google-cloud/pino-logging-gcp-config');

const SERVICE = 'production-retail-and-wholesale';
const VERSION = require('./package.json').version;
const LEVELS = ['trace', 'debug', 'info', 'warn'];
const REDACT_PATHS = [
  'password', '*.password',
  'token', '*.token',
  'authorization', '*.authorization',
  'cookie', '*.cookie',
  'headers', '*.headers',
  '["x-auth-token"]', '*["x-auth-token"]',
  'DATABASE_URL', 'ADMIN_TOKEN'
];

function resolveLogFormat(env) {
  const f = String(env.LOG_FORMAT ?? '').trim().toLowerCase();
  if (f === 'json' || f === 'pretty') return f;
  if (String(env.KUBERNETES_SERVICE_HOST ?? '') !== '' || env.NODE_ENV === 'production') return 'json';
  return 'pretty';
}

function resolveLogLevel(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === '') return 'info';
  return LEVELS.includes(v) ? v : 'warn';
}

function safeString(v) {
  try {
    return String(v);
  } catch {
    return '[unprintable]';
  }
}

function pickError(err) {
  try {
    const out = {};
    if (!err || typeof err !== 'object') return out;
    for (const key of ['name', 'message', 'code', 'constraint', 'table', 'column']) {
      const value = err[key];
      if (typeof value === 'string' || typeof value === 'number') out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function logMethod(inputArgs, method, level) {
  let args = inputArgs;
  if (level >= 50) {
    const first = inputArgs[0];
    const extra = typeof inputArgs[1] === 'string' ? inputArgs[1] : undefined;
    if (first instanceof Error) {
      const fields = { error: pickError(first) };
      if (extra !== undefined) fields.context = extra;
      args = [fields, first.stack ?? String(first.message)];
    } else if (first && typeof first === 'object' && first.err instanceof Error) {
      const { err, ...rest } = first;
      const fields = { ...rest, error: pickError(err) };
      if (extra !== undefined) fields.context = extra;
      args = [fields, err.stack ?? String(err.message)];
    }
  }
  return method.apply(this, args);
}

function baseOptions(env) {
  return {
    level: resolveLogLevel(env.LOG_LEVEL),
    base: null,
    hooks: { logMethod },
    redact: { paths: REDACT_PATHS, censor: '[Redacted]' }
  };
}

function jsonOptions(env) {
  const opts = createGcpLoggingPinoConfig(
    {
      serviceContext: { service: SERVICE, version: VERSION },
      traceGoogleCloudProjectId: '',
      inihibitDiagnosticMessage: true
    },
    baseOptions(env)
  );
  opts.timestamp = () => `,"timestamp":"${new Date().toISOString()}"`;
  return opts;
}

function loadPretty() {
  return require('pino-pretty');
}

function prettyMessage(log, messageKey) {
  const parts = [];
  const labels = log['logging.googleapis.com/labels'];
  if (labels && labels.requestId) parts.push(`[${labels.requestId}]`);
  const req = log.httpRequest;
  if (req) {
    if (req.requestMethod) parts.push(req.requestMethod);
    if (req.requestUrl) parts.push(req.requestUrl);
    if (req.status !== undefined) parts.push(String(req.status));
    if (req.latency) parts.push(req.latency);
  }
  const message = log[messageKey];
  if (message !== undefined) parts.push(String(message));
  return parts.join(' ');
}

function buildLogger({ format, destination, env = process.env }) {
  if (format === 'pretty') {
    try {
      const pretty = loadPretty();
      const stream = pretty({
        destination,
        sync: true,
        colorize: destination && destination.isTTY === true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname',
        errorLikeObjectKeys: ['err', 'error'],
        messageFormat: prettyMessage
      });
      return pino(baseOptions(env), stream);
    } catch {
      const l = pino(jsonOptions(env), destination);
      l.warn('pino-pretty could not be loaded; using JSON output instead');
      return l;
    }
  }
  return pino(jsonOptions(env), destination);
}

function createLogger(destination) {
  return buildLogger({ format: 'json', destination });
}

// A stream without flush (pino-pretty's transform pipeline) calls back at once, before the line has passed
// through it, so the exit waits one more turn of the event loop.
function exitAfterFlush(log) {
  const exit = () => setImmediate(() => process.exit(1));
  try {
    log.flush(exit);
  } catch {
    exit();
  }
}

function attachProcessHandlers(log) {
  const handler = (event) => (reason) => {
    try {
      const isErr = reason instanceof Error;
      log.fatal(
        { event, error: isErr ? pickError(reason) : { value: safeString(reason) } },
        isErr && reason.stack ? reason.stack : `${event}: ${safeString(reason)}`
      );
    } catch {
      // a failing logger must not stop the exit
    }
    exitAfterFlush(log);
  };
  process.on('uncaughtException', handler('uncaughtException'));
  process.on('unhandledRejection', handler('unhandledRejection'));
}

const discard = process.env.JEST_WORKER_ID !== undefined && process.env.LOG_IN_TESTS !== '1';
const NULL_STREAM = { write() {} };

module.exports.logger = buildLogger({
  // Discarded output needs no pretty printer, so pino-pretty is not even loaded.
  format: discard ? 'json' : resolveLogFormat(process.env),
  destination: discard ? NULL_STREAM : process.stdout
});
module.exports.createLogger = createLogger;
module.exports.resolveLogFormat = resolveLogFormat;
module.exports.attachProcessHandlers = attachProcessHandlers;
module.exports.resolveLogLevel = resolveLogLevel;
module.exports.buildLogger = buildLogger;
module.exports.pickError = pickError;
module.exports.safeString = safeString;
