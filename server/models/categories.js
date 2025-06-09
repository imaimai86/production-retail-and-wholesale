const db = require('./db');
const { logAction } = require('../utils/auditLog');
const logger = require('../utils/logger');

async function getAll({ limit = 10, offset = 0 } = {}, dbClient = null) {
  const client = dbClient || db; // Use passed-in client or global pool for reads
  const { rows } = await client.query(
    'SELECT * FROM categories ORDER BY id LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  return rows;
}

async function create(categoryData, performingUserId = null) {
  const { name, gst_percent } = categoryData;
  if (!name || gst_percent === undefined) {
    throw new Error('Category creation requires name and gst_percent.');
  }

  let dbClient;
  try {
    dbClient = await db.getClient();
    await dbClient.query('BEGIN');

    const { rows } = await dbClient.query(
      'INSERT INTO categories(name, gst_percent) VALUES($1,$2) RETURNING *',
      [name, gst_percent]
    );
    const newCategory = rows[0];

    if (newCategory && performingUserId) {
      await logAction(dbClient, performingUserId, 'CREATE_CATEGORY', 'CATEGORY', newCategory.id);
    } else if (!performingUserId) {
      logger.warn(`CREATE_CATEGORY action for category ID ${newCategory.id} performed without a performingUserId.`);
    }

    await dbClient.query('COMMIT');
    return newCategory;
  } catch (error) {
    if (dbClient) await dbClient.query('ROLLBACK');
    logger.error('Failed to create category in model:', error);
    throw error;
  } finally {
    if (dbClient) dbClient.release();
  }
}

module.exports = { getAll, create };
