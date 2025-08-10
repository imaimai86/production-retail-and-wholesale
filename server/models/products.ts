import db from './db';
import { QueryResult } from 'pg';

export interface Product {
  id: number;
  name: string;
  price_retail: number;
  price_wholesale: number;
  category_id: number;
  // created_at?: Date;
  // updated_at?: Date;
}

interface GetAllProductsOptions {
  limit?: number;
  offset?: number;
}

export async function getAll({ limit = 10, offset = 0 }: GetAllProductsOptions = {}): Promise<Product[]> {
  const { rows }: QueryResult<Product> = await db.query(
    'SELECT * FROM products ORDER BY id LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  return rows;
}

export async function getById(id: number | string): Promise<Product | undefined> {
  const { rows }: QueryResult<Product> = await db.query('SELECT * FROM products WHERE id=$1', [id]);
  return rows[0];
}

export interface ProductCreationData {
  name: string;
  price_retail: number;
  price_wholesale: number;
  category_id: number;
}

export async function create(product: ProductCreationData): Promise<Product> {
  const { name, price_retail, price_wholesale, category_id } = product;
  const { rows }: QueryResult<Product> = await db.query(
    'INSERT INTO products(name, price_retail, price_wholesale, category_id) VALUES($1,$2,$3,$4) RETURNING *',
    [name, price_retail, price_wholesale, category_id]
  );
  return rows[0];
}

// For updates, often all fields are optional, or you might have specific update DTOs
export interface ProductUpdateData {
  name?: string;
  price_retail?: number;
  price_wholesale?: number;
  category_id?: number;
}

export async function update(id: number | string, product: ProductUpdateData): Promise<Product | undefined> {
  const { name, price_retail, price_wholesale, category_id } = product;
  // Note: This query assumes all fields are provided.
  // A more robust update would dynamically build the SET clause based on provided fields.
  const { rows }: QueryResult<Product> = await db.query(
    'UPDATE products SET name=$1, price_retail=$2, price_wholesale=$3, category_id=$4 WHERE id=$5 RETURNING *',
    [name, price_retail, price_wholesale, category_id, id]
  );
  return rows[0];
}

export async function remove(id: number | string): Promise<void> {
  await db.query('DELETE FROM products WHERE id=$1', [id]);
}
