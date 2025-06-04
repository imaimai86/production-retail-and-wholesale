const db = require('../db');
const Inventory = require('../inventory');

jest.mock('../db');

describe('Inventory model', () => {
  afterEach(() => jest.clearAllMocks());

  test('transfer', async () => {
    db.query.mockResolvedValueOnce({});
    db.query.mockResolvedValueOnce({ rows: [{}] });
    await Inventory.transfer(1, 'A', 'B', 5);
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  test('getAll default', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await Inventory.getAll();
    expect(db.query).toHaveBeenCalledWith(
      'SELECT * FROM inventory ORDER BY id LIMIT $1 OFFSET $2',
      [10, 0]
    );
  });

  test('getAll with params', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await Inventory.getAll({ limit: 3, offset: 6 });
    expect(db.query).toHaveBeenCalledWith(
      'SELECT * FROM inventory ORDER BY id LIMIT $1 OFFSET $2',
      [3, 6]
    );
  });
});
