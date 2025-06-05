jest.mock('../db', () => ({
  query: jest.fn(),
  transaction: jest.fn()
}));
const db = require('../db');
const Inventory = require('../inventory');

describe('Inventory model', () => {
  afterEach(() => jest.clearAllMocks());

  test('transfer', async () => {
    const mockClient = { query: jest.fn() };
    mockClient.query.mockResolvedValueOnce({});
    mockClient.query.mockResolvedValueOnce({ rows: [{}] });
    db.transaction.mockImplementation(async cb => cb(mockClient));
    await Inventory.transfer(1, 'A', 'B', 5);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(mockClient.query).toHaveBeenCalledTimes(2);
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
