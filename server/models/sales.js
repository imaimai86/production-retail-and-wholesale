const db = require('./db');

async function getAll({ limit = 10, offset = 0 } = {}) {
  const { rows } = await db.query(
    'SELECT * FROM sales ORDER BY id LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  return rows;
}

async function create(sale) {
  const { product_id, quantity, price, discount, gst, user_id } = sale;
  const { rows } = await db.query(
    'INSERT INTO sales(product_id, quantity, price, discount, gst, user_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
    [product_id, quantity, price, discount || 0, gst, user_id]
  );
  return rows[0];
}

module.exports = { getAll, create };
