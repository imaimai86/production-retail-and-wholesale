const db = require('./db');

async function transfer(product_id, from, to, quantity) {
  return db.transaction(async client => {
    await client.query(
      'UPDATE inventory SET quantity = quantity - $1 WHERE product_id=$2 AND location=$3',
      [quantity, product_id, from]
    );
    const { rows } = await client.query(
      'INSERT INTO inventory(product_id, location, quantity) VALUES($1,$2,$3) ON CONFLICT (product_id, location) DO UPDATE SET quantity = inventory.quantity + EXCLUDED.quantity RETURNING *',
      [product_id, to, quantity]
    );
    return rows[0];
  });
}

async function getAll({ limit = 10, offset = 0 } = {}) {
  const { rows } = await db.query(
    'SELECT * FROM inventory ORDER BY id LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  return rows;
}

module.exports = { transfer, getAll };
