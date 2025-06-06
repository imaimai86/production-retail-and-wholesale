const db = require('./db');

async function getAll({ limit = 10, offset = 0 } = {}, dbClient = null) {
  const client = dbClient || db;
  const { rows } = await client.query(
    'SELECT id, name, role FROM users ORDER BY id LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  return rows;
}

async function create(user, dbClient = null) {
  const client = dbClient || db;
  const { name, role, email, password_hash } = user; // Added email and password_hash for completeness
  let queryText;
  let queryParams;

  // Ensure all required fields are handled, adjust query based on provided fields
  // This example prioritizes role being present, but a more robust solution
  // might involve dynamic query building or separate functions for different creation scenarios.
  if (role && email && password_hash) {
    queryText = 'INSERT INTO users(name, email, password_hash, role) VALUES($1, $2, $3, $4) RETURNING *';
    queryParams = [name, email, password_hash, role];
  } else if (email && password_hash) { // Create user with default role
    queryText = 'INSERT INTO users(name, email, password_hash) VALUES($1, $2, $3) RETURNING *';
    queryParams = [name, email, password_hash];
  } else if (role) { // Original logic if only name and role are primary concern (might be incomplete for DB constraints)
    queryText = 'INSERT INTO users(name, role) VALUES($1, $2) RETURNING *';
    queryParams = [name, role];
  }
  else { // Original fallback logic (might be incomplete for DB constraints)
    queryText = 'INSERT INTO users(name) VALUES($1) RETURNING *';
    queryParams = [name];
  }

  const { rows } = await client.query(queryText, queryParams);
  return rows[0];
}

async function findById(id, dbClient = null) {
  const client = dbClient || db;
  const { rows } = await client.query(
    'SELECT id, name, role, email FROM users WHERE id = $1', // Added email to selection
    [id]
  );
  return rows[0] || null;
}

module.exports = { getAll, create, findById };
