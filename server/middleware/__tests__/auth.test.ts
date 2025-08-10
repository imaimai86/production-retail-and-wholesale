import Auth from '../auth'; // Assuming AuthMiddleware is default export from auth.ts
import { Request, Response, NextFunction } from 'express';

// Define a type for our mock request that includes a Jest mock function for 'header' and 'userId'
interface MockRequest extends Partial<Request> {
  header: jest.Mock<string | undefined, [string]>;
  userId?: string | number;
}

// Define a type for our mock response that includes Jest mock functions for 'status' and 'json'
interface MockResponse extends Partial<Response> {
  status: jest.Mock<this, [number]>;
  json: jest.Mock<this, [any]>;
}

describe('Auth middleware', () => {
  test('missing token', () => {
    const req: MockRequest = {
      header: jest.fn().mockReturnValue(undefined)
    };
    const res: MockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    const next: NextFunction = jest.fn();

    Auth.verify(req as any, res as Response, next); // Use 'as any' for req if type conflict with AuthMiddleware's AuthenticatedRequest

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('valid token', () => {
    const req: MockRequest = {
      header: jest.fn().mockReturnValue('1')
    };
    const res: MockResponse = {
      status: jest.fn(),
      json: jest.fn()
    };
    const next: NextFunction = jest.fn();

    Auth.verify(req as any, res as Response, next);

    expect(req.userId).toBe('1');
    expect(next).toHaveBeenCalled();
  });

  describe('requireAdmin', () => {
    beforeAll(() => {
      process.env.ADMIN_TOKEN = 'secret';
    });

    test('forbidden', () => {
      const req: MockRequest = {
        header: jest.fn().mockReturnValue('bad')
      };
      const res: MockResponse = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next: NextFunction = jest.fn();

      Auth.requireAdmin(req as any, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    test('allowed', () => {
      const req: MockRequest = {
        header: jest.fn().mockReturnValue('secret')
      };
      const res: MockResponse = {
        status: jest.fn(),
        json: jest.fn()
      };
      const next: NextFunction = jest.fn();

      Auth.requireAdmin(req as any, res as Response, next);

      expect(next).toHaveBeenCalled();
    });
  });
});
