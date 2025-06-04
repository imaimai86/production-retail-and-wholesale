const db = require('./db');

async function getAll({ limit = 10, offset = 0 } = {}) {
  const { rows } = await db.query(
    'SELECT * FROM batches ORDER BY id LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  return rows;
}

async function create(batch) {
  const { product_id, quantity, completed } = batch;
  const { rows } = await db.query(
    'INSERT INTO batches(product_id, quantity, completed) VALUES($1,$2,$3) RETURNING *',
    [product_id, quantity, completed || false]
  );
  return rows[0];
}

module.exports = { getAll, create };
