const http = require('http');
const loggerModule = require('../logger');

const { pickError, safeString } = loggerModule;

function isClientError(value) {
  return Number.isInteger(value) && value >= 400 && value <= 499;
}

function resolveStatus(err) {
  if (err && typeof err === 'object') {
    if (isClientError(err.status)) return err.status;
    if (isClientError(err.statusCode)) return err.statusCode;
  }
  return 500;
}

// body-parser and raw-body errors (all carry a string `type`) can quote request data: V8's JSON.parse message
// quotes part of the body (`Unexpected token 'h', "{"password": hunter2}" is not valid JSON`), and
// charset.unsupported / encoding.unsupported quote the Content-Type / Content-Encoding header value.
// Their message is not logged.
function quotesRequest(err) {
  return typeof err.type === 'string' || 'body' in err;
}

function logError(err, req, status) {
  try {
    const errorLike = err instanceof Error || (err && typeof err === 'object');
    const fields = errorLike ? pickError(err) : {};
    let stack = errorLike && typeof err.stack === 'string' ? err.stack : undefined;
    if (errorLike && quotesRequest(err)) {
      fields.message = `request body could not be read (${typeof err.type === 'string' ? err.type : 'unknown'})`;
      // Keep only the frames: the stack's first part repeats the original message, which may span lines.
      const header = `${safeString(err.name)}: ${safeString(err.message)}`;
      let frames = -1;
      if (stack) frames = stack.startsWith(header) ? header.length : stack.indexOf('\n    at ');
      stack = `${fields.name || 'Error'}: ${fields.message}${frames >= 0 ? stack.slice(frames) : ''}`;
    }
    const path = String((req && (req.originalUrl || req.url)) || '').split('?')[0];
    const entry = {
      error: errorLike ? { ...fields, ...(stack ? { stack } : {}) } : { value: safeString(err) },
      httpRequest: { requestMethod: req && req.method, requestUrl: path }
    };
    if (req && req.requestId) entry['logging.googleapis.com/labels'] = { requestId: req.requestId };
    const message = stack || safeString(errorLike ? fields.message ?? err.message : err);
    loggerModule.logger[status >= 500 ? 'error' : 'warn'](entry, message);
  } catch {
    // logging must never change the response
  }
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = resolveStatus(err);
  logError(err, req, status);
  if (res.headersSent) return next(err);
  const message = status >= 500 ? 'Internal server error' : http.STATUS_CODES[status];
  return res.status(status).json({ error: message });
}

module.exports = errorHandler;
module.exports.resolveStatus = resolveStatus;
