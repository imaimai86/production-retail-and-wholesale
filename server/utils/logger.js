const LOG_LEVELS = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
};

// Basic configuration - could be extended to read from ENV
const CURRENT_LOG_LEVEL = LOG_LEVELS.DEBUG; // Or INFO for production

function log(level, message, ...optionalParams) {
  // Simple check to filter logs by level - can be made more sophisticated
  // if (Object.values(LOG_LEVELS).indexOf(level) < Object.values(LOG_LEVELS).indexOf(CURRENT_LOG_LEVEL)) {
    // return; // Uncomment to actually filter by level
  // }

  const timestamp = new Date().toISOString();
  let formattedMessage = `[${timestamp}] [${level}] - ${message}`;

  // Handle additional parameters (e.g., error objects, additional data)
  if (optionalParams.length > 0) {
    const paramsStr = optionalParams.map(param => {
      if (param instanceof Error) {
        return param.stack || param.message;
      }
      if (typeof param === 'object') {
        try {
          return JSON.stringify(param);
        } catch (e) {
          return '[Unserializable Object]';
        }
      }
      return param;
    }).join(' ');
    formattedMessage += ` ${paramsStr}`;
  }

  if (level === LOG_LEVELS.ERROR) {
    console.error(formattedMessage);
  } else if (level === LOG_LEVELS.WARN) {
    console.warn(formattedMessage);
  } else {
    console.log(formattedMessage); // INFO, DEBUG
  }
}

const logger = {
  debug: (message, ...optionalParams) => log(LOG_LEVELS.DEBUG, message, ...optionalParams),
  info: (message, ...optionalParams) => log(LOG_LEVELS.INFO, message, ...optionalParams),
  warn: (message, ...optionalParams) => log(LOG_LEVELS.WARN, message, ...optionalParams),
  error: (message, ...optionalParams) => log(LOG_LEVELS.ERROR, message, ...optionalParams),
};

module.exports = logger;
