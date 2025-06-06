const db = require('./db');

async function getAll({ limit = 10, offset = 0 } = {}, dbClient = null) {
  const client = dbClient || db;
  const { rows } = await client.query(
    'SELECT * FROM batches ORDER BY id LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  return rows;
}

async function create(batch, dbClient = null) {
  const client = dbClient || db;
  const { product_id, quantity, manufacturing_date, expiry_date, completed_at } = batch; // Added more fields based on typical batch properties
  const { rows } = await client.query(
    'INSERT INTO batches(product_id, quantity, manufacturing_date, expiry_date, completed_at) VALUES($1, $2, $3, $4, $5) RETURNING *',
    [product_id, quantity, manufacturing_date, expiry_date, completed_at]
  );
  return rows[0];
}

module.exports = { getAll, create };
