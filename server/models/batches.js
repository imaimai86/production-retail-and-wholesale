const db = require('./db');
const { logAction } = require('../utils/auditLog');
const logger = require('../utils/logger');

async function getAll({ limit = 10, offset = 0 } = {}, dbClient = null) {
  const client = dbClient || db; // Use passed-in client or global pool for reads
  const { rows } = await client.query(
    'SELECT * FROM batches ORDER BY id LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  return rows;
}

async function create(batchData, performingUserId = null) {
  const { product_id, quantity, manufacturing_date, expiry_date, completed_at } = batchData;
  // Basic validation
  if (!product_id || quantity === undefined) {
    throw new Error('Batch creation requires product_id and quantity.');
  }
  // manufacturing_date, expiry_date, completed_at can be optional depending on schema defaults or business logic

  let dbClient;
  try {
    dbClient = await db.getClient();
    await dbClient.query('BEGIN');

    const { rows } = await dbClient.query(
      'INSERT INTO batches(product_id, quantity, manufacturing_date, expiry_date, completed_at) VALUES($1, $2, $3, $4, $5) RETURNING *',
      [product_id, quantity, manufacturing_date, expiry_date, completed_at]
    );
    const newBatch = rows[0];

    if (newBatch && performingUserId) {
      await logAction(dbClient, performingUserId, 'CREATE_BATCH', 'BATCH', newBatch.id);
    } else if (!performingUserId) {
      logger.warn(`CREATE_BATCH action for batch ID ${newBatch.id} performed without a performingUserId.`);
    }

    await dbClient.query('COMMIT');
    return newBatch;
  } catch (error) {
    if (dbClient) await dbClient.query('ROLLBACK');
    logger.error('Failed to create batch in model:', error);
    throw error;
  } finally {
    if (dbClient) dbClient.release();
  }
}

module.exports = { getAll, create };
