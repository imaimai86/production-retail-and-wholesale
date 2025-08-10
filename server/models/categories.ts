import db from './db';
import { QueryResult } from 'pg';

export interface Category {
  id: number;
  name: string;
  gst: number; // Assuming gst is a number, adjust if it's a string or other type
  // created_at?: Date;
  // updated_at?: Date;
}

interface GetAllCategoriesOptions {
  limit?: number;
  offset?: number;
}

export async function getAll({ limit = 10, offset = 0 }: GetAllCategoriesOptions = {}): Promise<Category[]> {
  const { rows }: QueryResult<Category> = await db.query(
    'SELECT * FROM categories ORDER BY id LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  return rows;
}

export interface CategoryCreationData {
  name: string;
  gst: number;
}

export async function create(category: CategoryCreationData): Promise<Category> {
  const { name, gst } = category;
  const { rows }: QueryResult<Category> = await db.query(
    'INSERT INTO categories(name, gst) VALUES($1,$2) RETURNING *',
    [name, gst]
  );
  return rows[0];
}
