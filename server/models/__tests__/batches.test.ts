import db from '../db';
import * as Batches from '../batches'; // Import all exports as Batches
import { Batch, BatchCreationData } from '../batches';
import { QueryResult } from 'pg';

jest.mock('../db');

const mockedDb = db as jest.Mocked<typeof db>;

describe('Batches model', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('getAll default', async () => {
    const mockQueryResult: Partial<QueryResult<Batch>> = { rows: [] };
    mockedDb.query.mockResolvedValue(mockQueryResult as QueryResult<Batch>);

    await Batches.getAll();

    expect(mockedDb.query).toHaveBeenCalledWith(
      'SELECT * FROM batches ORDER BY id LIMIT $1 OFFSET $2',
      [10, 0]
    );
  });

  test('getAll with params', async () => {
    const mockQueryResult: Partial<QueryResult<Batch>> = { rows: [] };
    mockedDb.query.mockResolvedValue(mockQueryResult as QueryResult<Batch>);

    await Batches.getAll({ limit: 2, offset: 4 });

    expect(mockedDb.query).toHaveBeenCalledWith(
      'SELECT * FROM batches ORDER BY id LIMIT $1 OFFSET $2',
      [2, 4]
    );
  });

  test('create', async () => {
    const batchData: BatchCreationData = { product_id: 1, quantity: 10, completed: false };
    const expectedBatch: Batch = { id: 1, ...batchData }; // Assuming id is 1 for the test

    const mockQueryResult: Partial<QueryResult<Batch>> = { rows: [expectedBatch] };
    mockedDb.query.mockResolvedValue(mockQueryResult as QueryResult<Batch>);

    const createdBatch = await Batches.create(batchData);

    expect(mockedDb.query).toHaveBeenCalledWith(
      'INSERT INTO batches(product_id, quantity, completed) VALUES($1,$2,$3) RETURNING *',
      [batchData.product_id, batchData.quantity, batchData.completed || false]
    );
    expect(createdBatch).toEqual(expectedBatch);
  });
});
