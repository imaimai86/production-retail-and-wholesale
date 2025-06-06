const db = require('./db');

async function getAll({ limit = 10, offset = 0 } = {}, dbClient = null) {
  const client = dbClient || db;
  const { rows } = await client.query(
    'SELECT * FROM sales ORDER BY id LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  return rows;
}

async function getById(id, dbClient = null) {
  const client = dbClient || db;
  const { rows } = await client.query('SELECT * FROM sales WHERE id=$1', [id]);
  return rows[0];
}

async function create(sale, dbClient = null) {
  const { product_id, quantity, price, discount, gst, status = 'sold', user_id } = sale;

  const operation = async (client) => {
    const { rows } = await client.query(
      'INSERT INTO sales(product_id, quantity, price, discount, gst, status, user_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [product_id, quantity, price, discount || 0, gst, status, user_id]
    );
    const record = rows[0];
    if (status === 'sold') {
      await client.query(
        'UPDATE inventory SET quantity = quantity - $1 WHERE product_id=$2 AND location_id = (SELECT id FROM locations WHERE is_default_source_for_sales = TRUE LIMIT 1)', // Assuming a default source location for sales
        [quantity, product_id]
      );
    }
    return record;
  };

  if (dbClient) {
    return operation(dbClient);
  } else {
    return db.transaction(operation);
  }
}

async function updateStatus(id, status, dbClient = null) {
  const operation = async (client) => {
    const { rows } = await client.query('SELECT * FROM sales WHERE id=$1', [id]);
    const sale = rows[0];
    if (!sale) return null;
    await client.query('UPDATE sales SET status=$1 WHERE id=$2', [status, id]);

    // Assuming inventory adjustments are tied to a default sales location
    const defaultSalesLocationQuery = 'SELECT id FROM locations WHERE is_default_source_for_sales = TRUE LIMIT 1';

    if (sale.status !== 'sold' && status === 'sold') {
      await client.query(
        `UPDATE inventory SET quantity = quantity - $1 WHERE product_id=$2 AND location_id = (${defaultSalesLocationQuery})`,
        [sale.quantity, sale.product_id]
      );
    }
    if (sale.status === 'sold' && status !== 'sold') {
      await client.query(
        `UPDATE inventory SET quantity = quantity + $1 WHERE product_id=$2 AND location_id = (${defaultSalesLocationQuery})`,
        [sale.quantity, sale.product_id]
      );
    }
    return { ...sale, status };
  };

  if (dbClient) {
    return operation(dbClient);
  } else {
    return db.transaction(operation);
  }
}

async function remove(id, dbClient = null) {
  const operation = async (client) => {
    const { rows } = await client.query('SELECT * FROM sales WHERE id=$1', [id]);
    const sale = rows[0];
    if (!sale) return null;
    await client.query('DELETE FROM sales WHERE id=$1', [id]);

    // Assuming inventory adjustments are tied to a default sales location
    const defaultSalesLocationQuery = 'SELECT id FROM locations WHERE is_default_source_for_sales = TRUE LIMIT 1';

    if (sale.status === 'sold' || sale.status === 'order_created') { // 'order_created' might also reserve stock
      await client.query(
        `UPDATE inventory SET quantity = quantity + $1 WHERE product_id=$2 AND location_id = (${defaultSalesLocationQuery})`,
        [sale.quantity, sale.product_id]
      );
    }
    return sale;
  };

  if (dbClient) {
    return operation(dbClient);
  } else {
    return db.transaction(operation);
  }
}

module.exports = { getAll, getById, create, updateStatus, remove };
