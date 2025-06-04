const db = require('../db');
const Users = require('../users');

jest.mock('../db');

describe('Users model', () => {
  afterEach(() => jest.clearAllMocks());

  test('getAll default', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await Users.getAll();
    expect(db.query).toHaveBeenCalledWith(
      'SELECT * FROM users ORDER BY id LIMIT $1 OFFSET $2',
      [10, 0]
    );
  });

  test('create', async () => {
    const user = { name: 'Alice' };
    db.query.mockResolvedValue({ rows: [user] });
    await Users.create(user);
    expect(db.query).toHaveBeenCalled();
  });
});
