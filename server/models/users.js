const db = require('./db');

async function getAll({ limit = 10, offset = 0 } = {}) {
  const { rows } = await db.query(
    'SELECT * FROM users ORDER BY id LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  return rows;
}

async function create(user) {
  const { name } = user;
  const { rows } = await db.query(
    'INSERT INTO users(name) VALUES($1) RETURNING *',
    [name]
  );
  return rows[0];
}

module.exports = { getAll, create };
