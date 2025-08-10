import db from '../db';
import * as Products from '../products'; // Import all exports as Products
import { Product, ProductCreationData } from '../products';
import { QueryResult } from 'pg';

jest.mock('../db');

const mockedDb = db as jest.Mocked<typeof db>;

describe('Products model', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('getAll default', async () => {
    const mockQueryResult: Partial<QueryResult<Product>> = { rows: [] };
    mockedDb.query.mockResolvedValue(mockQueryResult as QueryResult<Product>);

    await Products.getAll();

    expect(mockedDb.query).toHaveBeenCalledWith(
      'SELECT * FROM products ORDER BY id LIMIT $1 OFFSET $2',
      [10, 0]
    );
  });

  test('getAll with params', async () => {
    const mockQueryResult: Partial<QueryResult<Product>> = { rows: [] };
    mockedDb.query.mockResolvedValue(mockQueryResult as QueryResult<Product>);

    await Products.getAll({ limit: 5, offset: 5 });

    expect(mockedDb.query).toHaveBeenCalledWith(
      'SELECT * FROM products ORDER BY id LIMIT $1 OFFSET $2',
      [5, 5]
    );
  });

  test('getById', async () => {
    const mockProduct: Product = { id: 1, name: 'Test Product', price_retail: 10, price_wholesale: 8, category_id: 1 };
    const mockQueryResult: Partial<QueryResult<Product>> = { rows: [mockProduct] };
    mockedDb.query.mockResolvedValue(mockQueryResult as QueryResult<Product>);

    const product = await Products.getById(1);

    expect(mockedDb.query).toHaveBeenCalledWith('SELECT * FROM products WHERE id=$1', [1]);
    expect(product).toEqual(mockProduct);
  });

  test('create', async () => {
    const productData: ProductCreationData = { name: 'New Product', price_retail: 20, price_wholesale: 15, category_id: 2 };
    const expectedProduct: Product = { id: 1, ...productData }; // Assuming id is 1 for the test

    const mockQueryResult: Partial<QueryResult<Product>> = { rows: [expectedProduct] };
    mockedDb.query.mockResolvedValue(mockQueryResult as QueryResult<Product>);

    const createdProduct = await Products.create(productData);

    expect(mockedDb.query).toHaveBeenCalledWith(
      'INSERT INTO products(name, price_retail, price_wholesale, category_id) VALUES($1,$2,$3,$4) RETURNING *',
      [productData.name, productData.price_retail, productData.price_wholesale, productData.category_id]
    );
    expect(createdProduct).toEqual(expectedProduct);
  });
});
