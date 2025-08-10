import db from '../db';
import * as Inventory from '../inventory'; // Import all exports as Inventory
import { InventoryItem } from '../inventory';
import { PoolClient, QueryResult } from 'pg';

jest.mock('../db');

const mockedDb = db as jest.Mocked<typeof db>;

describe('Inventory model', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('transfer', async () => {
    const mockClient = { query: jest.fn() } as unknown as PoolClient; // Mock PoolClient

    // Setup mock implementations for client.query
    // First call (UPDATE)
    (mockClient.query as jest.Mock).mockResolvedValueOnce({} as QueryResult);
    // Second call (INSERT ... RETURNING)
    const expectedItem: InventoryItem = { id: 1, product_id: 1, location: 'B', quantity: 5 };
    (mockClient.query as jest.Mock).mockResolvedValueOnce({ rows: [expectedItem] } as QueryResult<InventoryItem>);

    // Mock db.transaction to call the callback with mockClient
    mockedDb.transaction.mockImplementation(async (callback: (client: PoolClient) => Promise<InventoryItem>) => {
      return callback(mockClient);
    });

    const transferredItem = await Inventory.transfer(1, 'A', 'B', 5);

    expect(mockedDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockClient.query).toHaveBeenCalledTimes(2);
    expect(mockClient.query).toHaveBeenNthCalledWith(1,
      'UPDATE inventory SET quantity = quantity - $1 WHERE product_id=$2 AND location=$3',
      [5, 1, 'A']
    );
    expect(mockClient.query).toHaveBeenNthCalledWith(2,
      'INSERT INTO inventory(product_id, location, quantity) VALUES($1,$2,$3) ON CONFLICT (product_id, location) DO UPDATE SET quantity = inventory.quantity + EXCLUDED.quantity RETURNING *',
      [1, 'B', 5]
    );
    expect(transferredItem).toEqual(expectedItem);
  });

  test('getAll default', async () => {
    const mockQueryResult: Partial<QueryResult<InventoryItem>> = { rows: [] };
    mockedDb.query.mockResolvedValue(mockQueryResult as QueryResult<InventoryItem>);

    await Inventory.getAll();

    expect(mockedDb.query).toHaveBeenCalledWith(
      'SELECT * FROM inventory ORDER BY id LIMIT $1 OFFSET $2',
      [10, 0]
    );
  });

  test('getAll with params', async () => {
    const mockQueryResult: Partial<QueryResult<InventoryItem>> = { rows: [] };
    mockedDb.query.mockResolvedValue(mockQueryResult as QueryResult<InventoryItem>);

    await Inventory.getAll({ limit: 3, offset: 6 });

    expect(mockedDb.query).toHaveBeenCalledWith(
      'SELECT * FROM inventory ORDER BY id LIMIT $1 OFFSET $2',
      [3, 6]
    );
  });
});
