const logger = require('../logger'); // Import logger

class AuthMiddleware {
  static verify(req, res, next) {
    const token = req.header('x-auth-token');
    if (!token) {
      logger.warn('Authentication token missing from x-auth-token header.');
      return res.status(401).json({ error: 'Unauthorized' });
    }
    // Assuming token is the user ID as per current logic
    req.userId = token;
    logger.info(`User pseudo-authenticated with token (User ID): ${token}`);
    next();
  }

  static requireAdmin(req, res, next) {
    const token = req.header('x-auth-token'); // Assuming this is how admin is checked
    if (!req.userId) { // Check if verify was successful (req.userId should be set)
      logger.error('requireAdmin called without prior successful user verification.');
      return res.status(401).json({ message: 'Unauthorized' });
    }
    if (token !== process.env.ADMIN_TOKEN) {
      logger.warn(`Admin access denied for user ID: ${req.userId}. Path: ${req.originalUrl}`);
      return res.status(403).json({ error: 'Forbidden' });
    }
    logger.info(`Admin access granted for user ID: ${req.userId}. Path: ${req.originalUrl}`);
    next();
  }
}

module.exports = AuthMiddleware;
