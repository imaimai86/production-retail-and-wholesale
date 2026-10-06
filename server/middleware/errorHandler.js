const http = require('http');

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

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error(err);
  if (res.headersSent) return next(err);
  const status = resolveStatus(err);
  const message = status >= 500 ? 'Internal server error' : http.STATUS_CODES[status];
  return res.status(status).json({ error: message });
}

module.exports = errorHandler;
module.exports.resolveStatus = resolveStatus;
