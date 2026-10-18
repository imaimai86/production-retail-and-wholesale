const crypto = require('crypto');
const loggerModule = require('../logger');

const VALID_ID = /^[A-Za-z0-9._\-:]{1,128}$/;

function resolveRequestId(header) {
  return typeof header === 'string' && VALID_ID.test(header) ? header : crypto.randomUUID();
}

function parseTraceContext(header, project) {
  if (typeof header !== 'string' || header === '' || typeof project !== 'string' || project === '') return {};
  try {
    const [ids] = header.split(';');
    const [trace, span] = ids.split('/');
    if (!trace || !trace.trim()) return {};
    const out = { 'logging.googleapis.com/trace': `projects/${project}/traces/${trace.trim()}` };
    if (span && span.trim()) out['logging.googleapis.com/spanId'] = span.trim();
    return out;
  } catch {
    return {};
  }
}

function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();
  const id = resolveRequestId(req.headers['x-request-id']);
  req.requestId = id;
  res.setHeader('X-Request-Id', id);

  res.on('finish', () => {
    try {
      const status = res.statusCode;
      const path = (req.originalUrl || req.url || '').split('?')[0];
      if (req.method === 'GET' && (path === '/' || path === '/health') && status < 400) return;
      const latency = `${(Number(process.hrtime.bigint() - start) / 1e9).toFixed(3)}s`;
      const entry = {
        httpRequest: {
          requestMethod: req.method,
          requestUrl: path,
          status,
          userAgent: req.get('user-agent'),
          remoteIp: req.ip,
          protocol: `HTTP/${req.httpVersion}`,
          latency
        },
        'logging.googleapis.com/labels': { requestId: id },
        ...parseTraceContext(req.headers['x-cloud-trace-context'], process.env.GOOGLE_CLOUD_PROJECT)
      };
      const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
      loggerModule.logger[level](entry, `${req.method} ${path} ${status}`);
    } catch {
      // logging must never affect the response
    }
  });
  next();
}

module.exports = requestLogger;
module.exports.resolveRequestId = resolveRequestId;
module.exports.parseTraceContext = parseTraceContext;
