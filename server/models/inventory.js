const db = require('./db');
const { logAction } = require('../utils/auditLog');
const logger = require('../utils/logger');

async function transfer(product_id, from_location_id, to_location_id, quantity, performingUserId = null) {
  if (!product_id || from_location_id === undefined || to_location_id === undefined || quantity === undefined) {
    throw new Error('Inventory transfer requires product_id, from_location_id, to_location_id, and quantity.');
  }
  if (from_location_id === to_location_id) {
    throw new Error('Source and destination locations cannot be the same for an inventory transfer.');
  }
  if (quantity <= 0) {
    throw new Error('Transfer quantity must be positive.');
  }

  let dbClient;
  try {
    dbClient = await db.getClient();
    await dbClient.query('BEGIN');

    // Decrease quantity from source location
    const decreaseResult = await dbClient.query(
      'UPDATE inventory SET quantity = quantity - $1 WHERE product_id = $2 AND location_id = $3 RETURNING quantity',
      [quantity, product_id, from_location_id]
    );

    if (decreaseResult.rowCount === 0) {
      throw new Error(`Product ID ${product_id} not found at source location ID ${from_location_id}.`);
    }
    if (decreaseResult.rows[0].quantity < 0) {
      // This should ideally be caught by a DB constraint (CHECK quantity >= 0)
      throw new Error(`Insufficient quantity for product ID ${product_id} at source location ID ${from_location_id}.`);
    }

    // Increase quantity in destination location or insert new record
    const { rows } = await dbClient.query(
      'INSERT INTO inventory(product_id, location_id, quantity) VALUES($1, $2, $3) ON CONFLICT (product_id, location_id) DO UPDATE SET quantity = inventory.quantity + EXCLUDED.quantity RETURNING *',
      [product_id, to_location_id, quantity]
    );
    const updatedInventoryItem = rows[0];

    if (performingUserId) {
      // For inventory transfer, entityId could be product_id. Or more complex if transfers have their own ID.
      // Storing product_id provides good context.
      await logAction(dbClient, performingUserId, 'TRANSFER_INVENTORY', 'INVENTORY', product_id);
    } else {
      logger.warn(`TRANSFER_INVENTORY action for product ID ${product_id} performed without a performingUserId.`);
    }

    await dbClient.query('COMMIT');
    return updatedInventoryItem; // Return the state of the destination inventory item
  } catch (error) {
    if (dbClient) await dbClient.query('ROLLBACK');
    logger.error(`Failed to transfer inventory for product ID ${product_id}:`, error);
    throw error;
  } finally {
    if (dbClient) dbClient.release();
  }
}

async function getAll({ limit = 10, offset = 0 } = {}, dbClient = null) {
  const client = dbClient || db;
  const { rows } = await client.query(
    'SELECT * FROM inventory ORDER BY id LIMIT $1 OFFSET $2', // Assuming 'id' is the primary key for ordering
    [limit, offset]
  );
  return rows;
}

module.exports = { transfer, getAll };
