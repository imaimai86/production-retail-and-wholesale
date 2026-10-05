const db = require('./db');
const { insufficientStock, inventoryNotFound } = require('./errors');

const DECREMENT =
  'UPDATE inventory SET quantity = quantity - $1 WHERE product_id=$2 AND location=$3 AND quantity >= $1 RETURNING id';
const RESTORE =
  'INSERT INTO inventory(product_id, location, quantity) VALUES($1,$2,$3) ON CONFLICT (product_id, location) DO UPDATE SET quantity = inventory.quantity + EXCLUDED.quantity';

async function getAll({ limit = 10, offset = 0 } = {}) {
  const { rows } = await db.query(
    'SELECT * FROM sales ORDER BY id LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  return rows;
}

async function getById(id) {
  const { rows } = await db.query('SELECT * FROM sales WHERE id=$1', [id]);
  return rows[0];
}

async function create(sale) {
  const { product_id, location, quantity, price, discount, gst, status = 'sold', user_id } = sale;
  return db.transaction(async client => {
    const existing = await client.query(
      'SELECT * FROM inventory WHERE product_id=$1 AND location=$2',
      [product_id, location]
    );
    if (existing.rows.length === 0) throw inventoryNotFound();
    if (status === 'sold') {
      const dec = await client.query(DECREMENT, [quantity, product_id, location]);
      if (dec.rowCount === 0) throw insufficientStock();
    }
    const { rows } = await client.query(
      'INSERT INTO sales(product_id, location, quantity, price, discount, gst, status, user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [product_id, location, quantity, price, discount || 0, gst, status, user_id]
    );
    return rows[0];
  });
}

async function updateStatus(id, status) {
  return db.transaction(async client => {
    const { rows } = await client.query('SELECT * FROM sales WHERE id=$1 FOR UPDATE', [id]);
    const sale = rows[0];
    if (!sale) return null;
    if (sale.status === status) return sale;
    if (status === 'sold') {
      const dec = await client.query(DECREMENT, [sale.quantity, sale.product_id, sale.location]);
      if (dec.rowCount === 0) throw insufficientStock();
    } else if (sale.status === 'sold') {
      await client.query(RESTORE, [sale.product_id, sale.location, sale.quantity]);
    }
    await client.query('UPDATE sales SET status=$1 WHERE id=$2', [status, id]);
    return { ...sale, status };
  });
}

async function remove(id) {
  return db.transaction(async client => {
    const { rows } = await client.query('SELECT * FROM sales WHERE id=$1 FOR UPDATE', [id]);
    const sale = rows[0];
    if (!sale) return null;
    await client.query('DELETE FROM sales WHERE id=$1', [id]);
    if (sale.status === 'sold') {
      await client.query(RESTORE, [sale.product_id, sale.location, sale.quantity]);
    }
    return sale;
  });
}

module.exports = { getAll, getById, create, updateStatus, remove };
