jest.mock('../db', () => ({
  query: jest.fn(),
  transaction: jest.fn()
}));
const db = require('../db');
const Sales = require('../sales');

describe('Sales model', () => {
  afterEach(() => jest.clearAllMocks());

  test('getAll default', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await Sales.getAll();
    expect(db.query).toHaveBeenCalledWith(
      'SELECT * FROM sales ORDER BY id LIMIT $1 OFFSET $2',
      [10, 0]
    );
  });

  test('getAll with params', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await Sales.getAll({ limit: 2, offset: 2 });
    expect(db.query).toHaveBeenCalledWith(
      'SELECT * FROM sales ORDER BY id LIMIT $1 OFFSET $2',
      [2, 2]
    );
  });

  test('create', async () => {
    const sale = { product_id: 1, quantity: 1, price: 10, gst: 1, user_id: 1 };
    const mockClient = { query: jest.fn() };
    mockClient.query.mockResolvedValueOnce({ rows: [sale] });
    mockClient.query.mockResolvedValueOnce({});
    db.transaction.mockImplementation(async cb => cb(mockClient));
    await Sales.create(sale);
    expect(db.transaction).toHaveBeenCalled();
    expect(mockClient.query).toHaveBeenCalledTimes(2);
  });
});
