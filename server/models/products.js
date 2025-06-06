const db = require('./db');

async function getAll({ limit = 10, offset = 0 } = {}, dbClient = null) {
  const client = dbClient || db;
  const { rows } = await client.query(
    'SELECT * FROM products ORDER BY id LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  return rows;
}

async function getById(id, dbClient = null) {
  const client = dbClient || db;
  const { rows } = await client.query('SELECT * FROM products WHERE id=$1', [id]);
  return rows[0];
}

async function create(product, dbClient = null) {
  const client = dbClient || db;
  const { name, price_retail, price_wholesale, category_id } = product;
  const { rows } = await client.query(
    'INSERT INTO products(name, price_retail, price_wholesale, category_id) VALUES($1,$2,$3,$4) RETURNING *',
    [name, price_retail, price_wholesale, category_id]
  );
  return rows[0];
}

async function update(id, product, dbClient = null) {
  const client = dbClient || db;
  const { name, price_retail, price_wholesale, category_id } = product;
  const { rows } = await client.query(
    'UPDATE products SET name=$1, price_retail=$2, price_wholesale=$3, category_id=$4 WHERE id=$5 RETURNING *',
    [name, price_retail, price_wholesale, category_id, id]
  );
  return rows[0];
}

async function remove(id, dbClient = null) {
  const client = dbClient || db;
  await client.query('DELETE FROM products WHERE id=$1', [id]);
}

module.exports = { getAll, getById, create, update, remove };
