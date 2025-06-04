const Auth = require('../auth');

describe('Auth middleware', () => {
  test('missing token', () => {
    const req = { header: jest.fn().mockReturnValue(undefined) };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    Auth.verify(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('valid token', () => {
    const req = { header: jest.fn().mockReturnValue('1') };
    const res = { status: jest.fn(), json: jest.fn() };
    const next = jest.fn();
    Auth.verify(req, res, next);
    expect(req.userId).toBe('1');
    expect(next).toHaveBeenCalled();
  });

  describe('requireAdmin', () => {
    beforeAll(() => {
      process.env.ADMIN_TOKEN = 'secret';
    });

    test('forbidden', () => {
      const req = { header: jest.fn().mockReturnValue('bad') };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();
      Auth.requireAdmin(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    test('allowed', () => {
      const req = { header: jest.fn().mockReturnValue('secret') };
      const res = { status: jest.fn(), json: jest.fn() };
      const next = jest.fn();
      Auth.requireAdmin(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });
});
