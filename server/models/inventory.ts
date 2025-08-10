import db from './db';
import { PoolClient, QueryResult } from 'pg';

export interface InventoryItem {
  id: number;
  product_id: number;
  location: string; // Assuming location is a string, adjust if needed
  quantity: number;
  // created_at?: Date;
  // updated_at?: Date;
}

export async function transfer(
  product_id: number,
  from_location: string,
  to_location: string,
  quantity: number
): Promise<InventoryItem> {
  return db.transaction(async (client: PoolClient): Promise<InventoryItem> => {
    // Decrease quantity from the source location
    await client.query(
      'UPDATE inventory SET quantity = quantity - $1 WHERE product_id=$2 AND location=$3',
      [quantity, product_id, from_location]
    );

    // Increase quantity or insert new record for the destination location
    const { rows }: QueryResult<InventoryItem> = await client.query(
      'INSERT INTO inventory(product_id, location, quantity) VALUES($1,$2,$3) ON CONFLICT (product_id, location) DO UPDATE SET quantity = inventory.quantity + EXCLUDED.quantity RETURNING *',
      [product_id, to_location, quantity]
    );
    return rows[0];
  });
}

interface GetAllInventoryOptions {
  limit?: number;
  offset?: number;
}

export async function getAll({ limit = 10, offset = 0 }: GetAllInventoryOptions = {}): Promise<InventoryItem[]> {
  const { rows }: QueryResult<InventoryItem> = await db.query(
    'SELECT * FROM inventory ORDER BY id LIMIT $1 OFFSET $2', // Assuming 'id' column exists for ordering
    [limit, offset]
  );
  return rows;
}
