const db = require('./db');
const { logAction } = require('../utils/auditLog');
const logger = require('../utils/logger');

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

async function create(saleData, performingUserId = null) {
  // Note: The original saleData included 'user_id' which is the creator.
  // 'performingUserId' is for the audit log, which should be the same as saleData.user_id in this context.
  // If saleData.user_id is not provided, performingUserId might be the only indicator of who initiated.
  const { product_id, quantity, price, discount, gst_percent, status = 'sold', user_id } = saleData;

  if (!product_id || quantity === undefined || price === undefined || gst_percent === undefined || !user_id) {
    throw new Error('Sale creation requires product_id, quantity, price, gst_percent, and user_id.');
  }
  const actualPerformingUserId = performingUserId || user_id;


  let dbClient;
  try {
    dbClient = await db.getClient();
    await dbClient.query('BEGIN');

    const { rows } = await dbClient.query(
      'INSERT INTO sales(product_id, quantity, price, discount, gst_percent, status, user_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [product_id, quantity, price, discount || 0, gst_percent, status, user_id]
    );
    const newSale = rows[0];

    if (status === 'sold') {
      await dbClient.query(
        'UPDATE inventory SET quantity = quantity - $1 WHERE product_id=$2 AND location_id = (SELECT id FROM locations WHERE is_default_source_for_sales = TRUE LIMIT 1)',
        [quantity, product_id]
      );
    }

    if (newSale && actualPerformingUserId) {
      await logAction(dbClient, actualPerformingUserId, 'CREATE_SALE', 'SALE', newSale.id);
    } else if (!actualPerformingUserId) {
        logger.warn(`CREATE_SALE action for sale ID ${newSale.id} by user_id ${user_id} occurred without a separate performingUserId for audit.`);
    }

    await dbClient.query('COMMIT');
    return newSale;
  } catch (error) {
    if (dbClient) await dbClient.query('ROLLBACK');
    logger.error('Failed to create sale in model:', error);
    throw error;
  } finally {
    if (dbClient) dbClient.release();
  }
}

async function updateStatus(id, newStatus, performingUserId = null) {
  if (!newStatus) {
    throw new Error("New status must be provided for updateStatus.");
  }
  let dbClient;
  try {
    dbClient = await db.getClient();
    await dbClient.query('BEGIN');

    const { rows: saleRows } = await dbClient.query('SELECT * FROM sales WHERE id=$1', [id]);
    const sale = saleRows[0];

    if (!sale) {
      await dbClient.query('ROLLBACK');
      return null;
    }

    await dbClient.query('UPDATE sales SET status=$1 WHERE id=$2', [newStatus, id]);

    const defaultSalesLocationQuery = 'SELECT id FROM locations WHERE is_default_source_for_sales = TRUE LIMIT 1';

    if (sale.status !== 'sold' && newStatus === 'sold') {
      await dbClient.query(
        `UPDATE inventory SET quantity = quantity - $1 WHERE product_id=$2 AND location_id = (${defaultSalesLocationQuery})`,
        [sale.quantity, sale.product_id]
      );
    }
    if (sale.status === 'sold' && newStatus !== 'sold') {
      await dbClient.query(
        `UPDATE inventory SET quantity = quantity + $1 WHERE product_id=$2 AND location_id = (${defaultSalesLocationQuery})`,
        [sale.quantity, sale.product_id]
      );
    }

    if (performingUserId) {
      const auditAction = `UPDATE_SALE_STATUS_TO_${String(newStatus).toUpperCase()}`;
      await logAction(dbClient, performingUserId, auditAction, 'SALE', id);
    } else {
       logger.warn(`UPDATE_SALE_STATUS action for sale ID ${id} performed without a performingUserId.`);
    }

    await dbClient.query('COMMIT');
    return { ...sale, status: newStatus };
  } catch (error) {
    if (dbClient) await dbClient.query('ROLLBACK');
    logger.error(`Failed to update status for sale ID ${id} in model:`, error);
    throw error;
  } finally {
    if (dbClient) dbClient.release();
  }
}

async function remove(id, performingUserId = null) {
  let dbClient;
  try {
    dbClient = await db.getClient();
    await dbClient.query('BEGIN');

    const { rows } = await dbClient.query('SELECT * FROM sales WHERE id=$1', [id]);
    const sale = rows[0];

    if (!sale) {
      await dbClient.query('ROLLBACK');
      return null;
    }

    await dbClient.query('DELETE FROM sales WHERE id=$1', [id]);

    const defaultSalesLocationQuery = 'SELECT id FROM locations WHERE is_default_source_for_sales = TRUE LIMIT 1';
    if (sale.status === 'sold' || sale.status === 'order_created') {
      await dbClient.query(
        `UPDATE inventory SET quantity = quantity + $1 WHERE product_id=$2 AND location_id = (${defaultSalesLocationQuery})`,
        [sale.quantity, sale.product_id]
      );
    }

    if (performingUserId) {
      await logAction(dbClient, performingUserId, 'DELETE_SALE', 'SALE', id);
    } else {
      logger.warn(`DELETE_SALE action for sale ID ${id} performed without a performingUserId.`);
    }

    await dbClient.query('COMMIT');
    return sale; // Return the deleted sale object
  } catch (error) {
    if (dbClient) await dbClient.query('ROLLBACK');
    logger.error(`Failed to delete sale ID ${id} in model:`, error);
    throw error;
  } finally {
    if (dbClient) dbClient.release();
  }
}

module.exports = { getAll, getById, create, updateStatus, remove };
