const db = require('../db');
const Products = require('../products');

jest.mock('../db');

describe('Products model', () => {
  afterEach(() => jest.clearAllMocks());

  test('getAll default', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await Products.getAll();
    expect(db.query).toHaveBeenCalledWith(
      'SELECT * FROM products ORDER BY id LIMIT $1 OFFSET $2',
      [10, 0]
    );
  });

  test('getAll with params', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await Products.getAll({ limit: 5, offset: 5 });
    expect(db.query).toHaveBeenCalledWith(
      'SELECT * FROM products ORDER BY id LIMIT $1 OFFSET $2',
      [5, 5]
    );
  });

  test('getById', async () => {
    db.query.mockResolvedValue({ rows: [{}] });
    await Products.getById(1);
    expect(db.query).toHaveBeenCalledWith('SELECT * FROM products WHERE id=$1', [1]);
  });

  test('create', async () => {
    const product = { name: 'a', price_retail: 1, price_wholesale: 2 };
    db.query.mockResolvedValue({ rows: [product] });
    await Products.create(product);
    expect(db.query).toHaveBeenCalled();
  });
});
