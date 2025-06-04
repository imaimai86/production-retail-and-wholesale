class AuthMiddleware {
  static verify(req, res, next) {
    const token = req.header('x-auth-token');
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.userId = token;
    next();
  }

  static requireAdmin(req, res, next) {
    const token = req.header('x-auth-token');
    if (token !== process.env.ADMIN_TOKEN) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  }
}

module.exports = AuthMiddleware;
