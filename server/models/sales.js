const db = require('./db');

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
  const { product_id, quantity, price, discount, gst, status = 'sold', user_id } = sale;
  return db.transaction(async client => {
    const { rows } = await client.query(
      'INSERT INTO sales(product_id, quantity, price, discount, gst, status, user_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [product_id, quantity, price, discount || 0, gst, status, user_id]
    );
    const record = rows[0];
    if (status === 'sold') {
      await client.query(
        'UPDATE inventory SET quantity = quantity - $1 WHERE product_id=$2',
        [quantity, product_id]
      );
    }
    return record;
  });
}

async function updateStatus(id, status) {
  return db.transaction(async client => {
    const { rows } = await client.query('SELECT * FROM sales WHERE id=$1', [id]);
    const sale = rows[0];
    if (!sale) return null;
    await client.query('UPDATE sales SET status=$1 WHERE id=$2', [status, id]);
    if (sale.status !== 'sold' && status === 'sold') {
      await client.query(
        'UPDATE inventory SET quantity = quantity - $1 WHERE product_id=$2',
        [sale.quantity, sale.product_id]
      );
    }
    if (sale.status === 'sold' && status !== 'sold') {
      await client.query(
        'UPDATE inventory SET quantity = quantity + $1 WHERE product_id=$2',
        [sale.quantity, sale.product_id]
      );
    }
    return { ...sale, status };
  });
}

async function remove(id) {
  return db.transaction(async client => {
    const { rows } = await client.query('SELECT * FROM sales WHERE id=$1', [id]);
    const sale = rows[0];
    if (!sale) return null;
    await client.query('DELETE FROM sales WHERE id=$1', [id]);
    if (sale.status === 'sold' || sale.status === 'order_created') {
      await client.query(
        'UPDATE inventory SET quantity = quantity + $1 WHERE product_id=$2',
        [sale.quantity, sale.product_id]
      );
    }
    return sale;
  });
}

module.exports = { getAll, getById, create, updateStatus, remove };
