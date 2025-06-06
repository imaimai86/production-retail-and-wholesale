const db = require('./db');

async function getAll({ limit = 10, offset = 0 } = {}) {
  const { rows } = await db.query(
    'SELECT * FROM categories ORDER BY id LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  return rows;
}

async function create(category) {
  const { name, gst } = category;
  const { rows } = await db.query(
    'INSERT INTO categories(name, gst) VALUES($1,$2) RETURNING *',
    [name, gst]
  );
  return rows[0];
}

module.exports = { getAll, create };
