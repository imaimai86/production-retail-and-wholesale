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
    console.log('[AuthMiddleware.requireAdmin] Checking admin access. Received token:', token);
    console.log('[AuthMiddleware.requireAdmin] Expected ADMIN_TOKEN:', process.env.ADMIN_TOKEN);
    if (token !== process.env.ADMIN_TOKEN) {
      console.log('[AuthMiddleware.requireAdmin] Admin access denied.');
      return res.status(403).json({ error: 'Forbidden' });
    }
    console.log('[AuthMiddleware.requireAdmin] Admin access granted.');
    next();
  }
}

module.exports = AuthMiddleware;
