const db = require('./db'); // db.getClient, db.query (for non-transactional functions if any)
const { logAction } = require('../utils/auditLog');
const logger = require('../utils/logger');

async function getAll({ limit = 10, offset = 0 } = {}, dbClient = null) {
  const client = dbClient || db;
  const { rows } = await client.query(
    'SELECT id, name, role FROM users ORDER BY id LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  return rows;
}

async function create(userData, performingUserId = null) {
  const { name, email, password_hash, role } = userData;
  // Ensure all necessary fields are present
  if (!name || !email || !password_hash) {
    // Role can be optional if DB has a default, but name, email, password_hash are typically required.
    throw new Error('User creation requires name, email, and password_hash.');
  }

  let dbClient;
  try {
    dbClient = await db.getClient();
    await dbClient.query('BEGIN');

    let queryText;
    let queryParams;

    if (role) {
      queryText = 'INSERT INTO users(name, email, password_hash, role) VALUES($1, $2, $3, $4) RETURNING *';
      queryParams = [name, email, password_hash, role];
    } else {
      // Assumes DB has a default for role or role is nullable
      queryText = 'INSERT INTO users(name, email, password_hash) VALUES($1, $2, $3) RETURNING *';
      queryParams = [name, email, password_hash];
    }

    const { rows } = await dbClient.query(queryText, queryParams);
    const newUser = rows[0];

    if (newUser && performingUserId) {
      await logAction(dbClient, performingUserId, 'CREATE_USER', 'USER', newUser.id);
    }

    await dbClient.query('COMMIT');
    return newUser;
  } catch (error) {
    if (dbClient) {
      await dbClient.query('ROLLBACK');
    }
    logger.error('Failed to create user in model:', error);
    throw error; // Re-throw for the route handler to catch
  } finally {
    if (dbClient) {
      dbClient.release();
    }
  }
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
