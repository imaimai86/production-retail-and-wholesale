const { Pool } = require('pg');

const url = process.env.DATABASE_URL;
const pool = url && url.trim() !== ''
  ? new Pool({ connectionString: url })
  : new Pool();

module.exports = {
  query: (text, params) => pool.query(text, params),
  async transaction(callback) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
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
