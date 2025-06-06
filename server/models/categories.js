const db = require('./db');

async function getAll({ limit = 10, offset = 0 } = {}, dbClient = null) {
  const client = dbClient || db;
  const { rows } = await client.query(
    'SELECT * FROM categories ORDER BY id LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  return rows;
}

async function create(category, dbClient = null) {
  const client = dbClient || db;
  const { name, gst_percent } = category; // Assuming field name is gst_percent based on schema
  const { rows } = await client.query(
    'INSERT INTO categories(name, gst_percent) VALUES($1,$2) RETURNING *',
    [name, gst_percent]
  );
  return rows[0];
}

module.exports = { getAll, create };
