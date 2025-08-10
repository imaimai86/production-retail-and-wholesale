import db from '../db';
import * as Sales from '../sales'; // Import all exports as Sales
import { Sale, SaleCreationData, SaleStatus } from '../sales';
import { PoolClient, QueryResult } from 'pg';

jest.mock('../db');

const mockedDb = db as jest.Mocked<typeof db>;

describe('Sales model', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('getAll default', async () => {
    const mockQueryResult: Partial<QueryResult<Sale>> = { rows: [] };
    mockedDb.query.mockResolvedValue(mockQueryResult as QueryResult<Sale>);

    await Sales.getAll();

    expect(mockedDb.query).toHaveBeenCalledWith(
      'SELECT * FROM sales ORDER BY id LIMIT $1 OFFSET $2',
      [10, 0]
    );
  });

  test('getAll with params', async () => {
    const mockQueryResult: Partial<QueryResult<Sale>> = { rows: [] };
    mockedDb.query.mockResolvedValue(mockQueryResult as QueryResult<Sale>);

    await Sales.getAll({ limit: 2, offset: 2 });

    expect(mockedDb.query).toHaveBeenCalledWith(
      'SELECT * FROM sales ORDER BY id LIMIT $1 OFFSET $2',
      [2, 2]
    );
  });

  test('create', async () => {
    const saleData: SaleCreationData = { product_id: 1, quantity: 1, price: 10, gst: 1, user_id: 1, status: 'sold' };
    // Assuming id is auto-generated and discount defaults if not provided
    const expectedSale: Sale = { id: 1, discount: 0, ...saleData };

    const mockClient = { query: jest.fn() } as unknown as PoolClient;

    // First client.query (INSERT sale)
    (mockClient.query as jest.Mock).mockResolvedValueOnce({ rows: [expectedSale] } as QueryResult<Sale>);
    // Second client.query (UPDATE inventory) - assuming it doesn't return rows or we don't care for this test
    (mockClient.query as jest.Mock).mockResolvedValueOnce({} as QueryResult);

    mockedDb.transaction.mockImplementation(async (callback: (client: PoolClient) => Promise<Sale>) => {
      return callback(mockClient);
    });

    const createdSale = await Sales.create(saleData);

    expect(mockedDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockClient.query).toHaveBeenCalledTimes(2);
    expect(mockClient.query).toHaveBeenNthCalledWith(1,
      'INSERT INTO sales(product_id, quantity, price, discount, gst, status, user_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [saleData.product_id, saleData.quantity, saleData.price, saleData.discount || 0, saleData.gst, saleData.status, saleData.user_id]
    );
    expect(mockClient.query).toHaveBeenNthCalledWith(2,
      'UPDATE inventory SET quantity = quantity - $1 WHERE product_id=$2',
      [saleData.quantity, saleData.product_id]
    );
    expect(createdSale).toEqual(expectedSale);
  });
});
