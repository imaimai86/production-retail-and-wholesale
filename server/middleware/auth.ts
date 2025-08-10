import { Request, Response, NextFunction } from 'express';

// Define a custom request type that includes userId
interface AuthenticatedRequest extends Request {
  userId?: string | number; // Or number if your userId is specifically a number
}

class AuthMiddleware {
  static verify(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    const token: string | undefined = req.header('x-auth-token');
    if (!token) {
      res.status(401).json({ error: 'Unauthorized' });
      return; // Explicitly return void
    }
    // In a real app, you would verify the token (e.g. JWT) and decode it to get the user ID
    // For this example, we're treating the token itself as the userId for simplicity
    req.userId = token;
    next();
  }

  static requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    const token: string | undefined = req.header('x-auth-token');
    // This is a simplified admin check, in a real app you'd have roles or permissions
    if (token !== process.env.ADMIN_TOKEN) {
      res.status(403).json({ error: 'Forbidden' });
      return; // Explicitly return void
    }
    next();
  }
}

export default AuthMiddleware;
