const db = require('../../models/db');
const Products = require('../../models/products');

jest.mock('../../models/db');

describe('Products model', () => {
  afterEach(() => jest.clearAllMocks());

  test('getAll pages with LIMIT and OFFSET, 10 and 0 by default', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await Products.getAll();
    expect(db.query).toHaveBeenCalledWith(
      'SELECT * FROM products ORDER BY id LIMIT $1 OFFSET $2',
      [10, 0]
    );
    await Products.getAll({ limit: 5, offset: 5 });
    expect(db.query).toHaveBeenCalledWith(
      'SELECT * FROM products ORDER BY id LIMIT $1 OFFSET $2',
      [5, 5]
    );
  });

  test('getById selects by id, and create runs a query', async () => {
    db.query.mockResolvedValue({ rows: [{}] });
    await Products.getById(1);
    expect(db.query).toHaveBeenCalledWith('SELECT * FROM products WHERE id=$1', [1]);

    jest.clearAllMocks();
    const product = { name: 'a', price_retail: 1, price_wholesale: 2 };
    db.query.mockResolvedValue({ rows: [product] });
    await Products.create(product);
    expect(db.query).toHaveBeenCalled();
  });
});
