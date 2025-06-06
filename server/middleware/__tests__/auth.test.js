const AuthMiddleware = require('../auth');
const { findById } = require('../../models/users');
const logger = require('../../utils/logger');

jest.mock('../../models/users', () => ({
  findById: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
}));

describe('AuthMiddleware', () => {
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    mockReq = {
      header: jest.fn(),
      user: undefined, // Ensure req.user is reset
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockNext = jest.fn();
    findById.mockClear(); // Clear mock usage history
    logger.error.mockClear(); // Clear logger mock
  });

  describe('loadUserAndAuthenticate', () => {
    it('should return 401 if no x-auth-token is provided', async () => {
      mockReq.header.mockReturnValue(null);
      await AuthMiddleware.loadUserAndAuthenticate(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Access denied. No token provided.' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 if token is not a valid number', async () => {
      mockReq.header.mockReturnValue('abc');
      await AuthMiddleware.loadUserAndAuthenticate(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid token format.' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 if user is not found by findById', async () => {
      mockReq.header.mockReturnValue('1');
      findById.mockResolvedValue(null);
      await AuthMiddleware.loadUserAndAuthenticate(mockReq, mockRes, mockNext);
      expect(findById).toHaveBeenCalledWith(1);
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Unauthorized. User not found for token.' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should populate req.user and call next if user is found', async () => {
      const mockUser = { id: 1, name: 'Test User', role: 'user' };
      mockReq.header.mockReturnValue('1');
      findById.mockResolvedValue(mockUser);
      await AuthMiddleware.loadUserAndAuthenticate(mockReq, mockRes, mockNext);
      expect(findById).toHaveBeenCalledWith(1);
      expect(mockReq.user).toEqual(mockUser);
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockRes.status).not.toHaveBeenCalled();
    });

     it('should handle errors during findById and return 500', async () => {
      mockReq.header.mockReturnValue('1');
      const dbError = new Error('DB Error');
      findById.mockRejectedValue(dbError);
      await AuthMiddleware.loadUserAndAuthenticate(mockReq, mockRes, mockNext);
      expect(findById).toHaveBeenCalledWith(1);
      expect(logger.error).toHaveBeenCalledWith('Error in loadUserAndAuthenticate:', dbError);
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Internal server error during authentication.' });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('requireAdmin', () => {
    it('should return 401 if req.user is undefined', () => {
      AuthMiddleware.requireAdmin(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Authentication required. Please login.' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 403 if req.user.role is "user"', () => {
      mockReq.user = { id: 1, name: 'Test User', role: 'user' };
      AuthMiddleware.requireAdmin(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Forbidden. Admin access required.' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should call next if req.user.role is "admin"', () => {
      mockReq.user = { id: 1, name: 'Admin User', role: 'admin' };
      AuthMiddleware.requireAdmin(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should call next if req.user.role is "super_admin"', () => {
      mockReq.user = { id: 1, name: 'Super Admin', role: 'super_admin' };
      AuthMiddleware.requireAdmin(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });

  describe('requireSuperAdmin', () => {
    it('should return 401 if req.user is undefined', () => {
      AuthMiddleware.requireSuperAdmin(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Authentication required. Please login.' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 403 if req.user.role is "user"', () => {
      mockReq.user = { id: 1, name: 'Test User', role: 'user' };
      AuthMiddleware.requireSuperAdmin(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Forbidden. Super admin access required.' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 403 if req.user.role is "admin"', () => {
      mockReq.user = { id: 1, name: 'Admin User', role: 'admin' };
      AuthMiddleware.requireSuperAdmin(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Forbidden. Super admin access required.' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should call next if req.user.role is "super_admin"', () => {
      mockReq.user = { id: 1, name: 'Super Admin', role: 'super_admin' };
      AuthMiddleware.requireSuperAdmin(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });
});
