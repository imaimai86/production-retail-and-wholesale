import db from './db';
import { QueryResult } from 'pg';

export interface Batch {
  id: number;
  product_id: number;
  quantity: number;
  completed: boolean;
  // created_at?: Date;
  // updated_at?: Date;
  // mfg_date?: Date;
  // exp_date?: Date;
}

interface GetAllBatchesOptions {
  limit?: number;
  offset?: number;
}

export async function getAll({ limit = 10, offset = 0 }: GetAllBatchesOptions = {}): Promise<Batch[]> {
  const { rows }: QueryResult<Batch> = await db.query(
    'SELECT * FROM batches ORDER BY id LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  return rows;
}

export interface BatchCreationData {
  product_id: number;
  quantity: number;
  completed?: boolean; // completed is optional, defaults to false in the query
  // mfg_date?: Date | string;
  // exp_date?: Date | string;
}

export async function create(batch: BatchCreationData): Promise<Batch> {
  const { product_id, quantity, completed } = batch;
  const { rows }: QueryResult<Batch> = await db.query(
    'INSERT INTO batches(product_id, quantity, completed) VALUES($1,$2,$3) RETURNING *',
    [product_id, quantity, completed || false]
  );
  return rows[0];
}
