const Auth = require('../../middleware/auth');

describe('Auth middleware', () => {
  const call = (fn, token) => {
    const req = { header: jest.fn().mockReturnValue(token) };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    fn(req, res, next);
    return { req, res, next };
  };

  test('verify answers 401 without a token, and sets userId and continues with one', () => {
    const missing = call(Auth.verify, undefined);
    expect(missing.res.status).toHaveBeenCalledWith(401);
    expect(missing.next).not.toHaveBeenCalled();

    const valid = call(Auth.verify, '1');
    expect(valid.req.userId).toBe('1');
    expect(valid.next).toHaveBeenCalled();
  });

  test('requireAdmin answers 403 for another token and continues with the admin token', () => {
    process.env.ADMIN_TOKEN = 'secret';

    const forbidden = call(Auth.requireAdmin, 'bad');
    expect(forbidden.res.status).toHaveBeenCalledWith(403);
    expect(forbidden.next).not.toHaveBeenCalled();

    expect(call(Auth.requireAdmin, 'secret').next).toHaveBeenCalled();
  });
});
