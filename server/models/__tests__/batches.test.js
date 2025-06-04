const db = require('../db');
const Batches = require('../batches');

jest.mock('../db');

describe('Batches model', () => {
  afterEach(() => jest.clearAllMocks());

  test('getAll default', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await Batches.getAll();
    expect(db.query).toHaveBeenCalledWith(
      'SELECT * FROM batches ORDER BY id LIMIT $1 OFFSET $2',
      [10, 0]
    );
  });

  test('getAll with params', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await Batches.getAll({ limit: 2, offset: 4 });
    expect(db.query).toHaveBeenCalledWith(
      'SELECT * FROM batches ORDER BY id LIMIT $1 OFFSET $2',
      [2, 4]
    );
  });

  test('create', async () => {
    const batch = { product_id: 1, quantity: 10 };
    db.query.mockResolvedValue({ rows: [batch] });
    await Batches.create(batch);
    expect(db.query).toHaveBeenCalled();
  });
});
