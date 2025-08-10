import { Pool, PoolClient, QueryResult, QueryConfig } from 'pg';

const pool = new Pool();

interface DB {
  query: (text: string | QueryConfig, params?: unknown[]) => Promise<QueryResult<Record<string, unknown>>>;
  transaction: <T>(callback: (client: PoolClient) => Promise<T>) => Promise<T>;
}

const db: DB = {
  query: (text: string | QueryConfig, params?: unknown[]): Promise<QueryResult<Record<string, unknown>>> => pool.query(text, params),
  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      const result: T = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
};

export default db;
