const { findById } = require('../models/users');
const logger = require('../utils/logger');

class AuthMiddleware {
  static async loadUserAndAuthenticate(req, res, next) {
    const token = req.header('x-auth-token');
    if (!token) {
      return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    try {
      // Assuming the token is the user ID directly, as per current setup
      const userId = parseInt(token, 10);
      if (isNaN(userId)) {
        return res.status(401).json({ error: 'Invalid token format.' });
      }

      const user = await findById(userId);
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized. User not found for token.' });
      }
      req.user = user; // Store the full user object
      next();
    } catch (error) {
      logger.error('Error in loadUserAndAuthenticate:', error);
      res.status(500).json({ error: 'Internal server error during authentication.' });
    }
  }

  static requireAdmin(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required. Please login.' });
    }
    const { role } = req.user;
    if (role !== 'admin' && role !== 'super_admin') {
      return res.status(403).json({ error: 'Forbidden. Admin access required.' });
    }
    next();
  }

  static requireSuperAdmin(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required. Please login.' });
    }
    const { role } = req.user;
    if (role !== 'super_admin') {
      return res.status(403).json({ error: 'Forbidden. Super admin access required.' });
    }
    next();
  }
}

module.exports = AuthMiddleware;
