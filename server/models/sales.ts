import db from './db';
import { PoolClient, QueryResult } from 'pg';

export type SaleStatus = 'order_created' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'sold' | 'returned';

export interface Sale {
  id: number;
  product_id: number;
  quantity: number;
  price: number;
  discount: number;
  gst: number;
  status: SaleStatus;
  user_id: number; // Assuming user_id comes from AuthenticatedRequest, should be number
  // created_at?: Date;
  // updated_at?: Date;
}

interface GetAllSalesOptions {
  limit?: number;
  offset?: number;
}

export async function getAll({ limit = 10, offset = 0 }: GetAllSalesOptions = {}): Promise<Sale[]> {
  const { rows }: QueryResult<Sale> = await db.query(
    'SELECT * FROM sales ORDER BY id LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  return rows;
}

export async function getById(id: number | string): Promise<Sale | undefined> {
  const { rows }: QueryResult<Sale> = await db.query('SELECT * FROM sales WHERE id=$1', [id]);
  return rows[0];
}

export interface SaleCreationData {
  product_id: number;
  quantity: number;
  price: number;
  discount?: number;
  gst: number;
  status?: SaleStatus;
  user_id: number; // Ensure this is provided, e.g., from req.userId
}

export async function create(saleData: SaleCreationData): Promise<Sale> {
  const { product_id, quantity, price, discount, gst, status = 'sold', user_id } = saleData;
  return db.transaction(async (client: PoolClient): Promise<Sale> => {
    const { rows }: QueryResult<Sale> = await client.query(
      'INSERT INTO sales(product_id, quantity, price, discount, gst, status, user_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [product_id, quantity, price, discount || 0, gst, status, user_id]
    );
    const record: Sale = rows[0];
    if (status === 'sold') {
      // Assuming default location for inventory reduction, or this needs more complex logic
      await client.query(
        'UPDATE inventory SET quantity = quantity - $1 WHERE product_id=$2', // Might need AND location=$X
        [quantity, product_id]
      );
    }
    return record;
  });
}

export async function updateStatus(id: number | string, status: SaleStatus): Promise<Sale | null> {
  return db.transaction(async (client: PoolClient): Promise<Sale | null> => {
    const { rows } = await client.query<Sale>('SELECT * FROM sales WHERE id=$1', [id]);
    const sale: Sale | undefined = rows[0];
    if (!sale) return null;

    await client.query('UPDATE sales SET status=$1 WHERE id=$2', [status, id]);

    // Adjust inventory based on status change
    // This logic assumes inventory is reduced when 'sold' and restocked if moved from 'sold' to something else.
    // And if moved to 'sold' from something else, inventory is reduced.
    const oldStatusSold: boolean = sale.status === 'sold';
    const newStatusSold: boolean = status === 'sold';

    if (!oldStatusSold && newStatusSold) {
      // Transitioning to 'sold'
      await client.query(
        'UPDATE inventory SET quantity = quantity - $1 WHERE product_id=$2', // Might need AND location=$X
        [sale.quantity, sale.product_id]
      );
    } else if (oldStatusSold && !newStatusSold) {
      // Transitioning away from 'sold'
      await client.query(
        'UPDATE inventory SET quantity = quantity + $1 WHERE product_id=$2', // Might need AND location=$X
        [sale.quantity, sale.product_id]
      );
    }
    return { ...sale, status };
  });
}

export async function remove(id: number | string): Promise<Sale | null> {
  return db.transaction(async (client: PoolClient): Promise<Sale | null> => {
    const { rows } = await client.query<Sale>('SELECT * FROM sales WHERE id=$1', [id]);
    const sale: Sale | undefined = rows[0];
    if (!sale) return null;

    await client.query('DELETE FROM sales WHERE id=$1', [id]);

    // If the sale was 'sold' or 'order_created' (and potentially affected inventory), restock inventory.
    // This logic might need adjustment based on exact status definitions and inventory rules.
    if (sale.status === 'sold' || sale.status === 'order_created') {
      await client.query(
        'UPDATE inventory SET quantity = quantity + $1 WHERE product_id=$2', // Might need AND location=$X
        [sale.quantity, sale.product_id]
      );
    }
    return sale;
  });
}
