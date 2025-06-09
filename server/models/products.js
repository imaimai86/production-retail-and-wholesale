const db = require('./db'); // For db.getClient() and direct use by getAll/getById if needed
const { logAction } = require('../utils/auditLog');
const logger = require('../utils/logger');

async function getAll({ limit = 10, offset = 0 } = {}, dbClient = null) {
  const currentClient = dbClient || db; // Use passed-in client or global pool for reads
  const { rows } = await currentClient.query(
    'SELECT * FROM products ORDER BY id LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  return rows;
}

async function getById(id, dbClient = null) {
  const currentClient = dbClient || db; // Use passed-in client or global pool for reads
  const { rows } = await currentClient.query('SELECT * FROM products WHERE id=$1', [id]);
  return rows[0];
}

async function create(productData, performingUserId = null) {
  const { name, price_retail, price_wholesale, category_id } = productData;
  if (!name || price_retail === undefined || price_wholesale === undefined || !category_id) {
    throw new Error('Product creation requires name, prices, and category_id.');
  }

  let dbClient;
  try {
    dbClient = await db.getClient();
    await dbClient.query('BEGIN');

    const { rows } = await dbClient.query(
      'INSERT INTO products(name, price_retail, price_wholesale, category_id) VALUES($1,$2,$3,$4) RETURNING *',
      [name, price_retail, price_wholesale, category_id]
    );
    const newProduct = rows[0];

    if (newProduct && performingUserId) {
      await logAction(dbClient, performingUserId, 'CREATE_PRODUCT', 'PRODUCT', newProduct.id);
    } else if (!performingUserId) {
      logger.warn(`CREATE_PRODUCT action for product ID ${newProduct.id} performed without a performingUserId.`);
    }

    await dbClient.query('COMMIT');
    return newProduct;
  } catch (error) {
    if (dbClient) await dbClient.query('ROLLBACK');
    logger.error('Failed to create product in model:', error);
    throw error;
  } finally {
    if (dbClient) dbClient.release();
  }
}

async function update(id, productData, performingUserId = null) {
  const { name, price_retail, price_wholesale, category_id } = productData;
   if (!name || price_retail === undefined || price_wholesale === undefined || !category_id) {
    throw new Error('Product update requires name, prices, and category_id.');
  }

  let dbClient;
  try {
    dbClient = await db.getClient();
    await dbClient.query('BEGIN');

    const { rows } = await dbClient.query(
      'UPDATE products SET name=$1, price_retail=$2, price_wholesale=$3, category_id=$4 WHERE id=$5 RETURNING *',
      [name, price_retail, price_wholesale, category_id, id]
    );
    const updatedProduct = rows[0];

    if (!updatedProduct) {
      // No product found to update, perhaps throw an error or return null after commit/rollback
      // Depending on desired behavior for "update non-existent".
      // For now, assume route handler checks this or it's an error if it gets here.
      await dbClient.query('ROLLBACK'); // Rollback if product not found, as it's unexpected here
      return null; // Or throw new Error('Product not found for update');
    }

    if (performingUserId) {
      await logAction(dbClient, performingUserId, 'UPDATE_PRODUCT', 'PRODUCT', id);
    } else {
      logger.warn(`UPDATE_PRODUCT action for product ID ${id} performed without a performingUserId.`);
    }

    await dbClient.query('COMMIT');
    return updatedProduct;
  } catch (error) {
    if (dbClient) await dbClient.query('ROLLBACK');
    logger.error(`Failed to update product ID ${id} in model:`, error);
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

    // Optional: Check existence first if you want to return a specific value like true/false or the deleted row.
    // For now, just attempt delete. If row doesn't exist, it's a no-op.
    const result = await dbClient.query('DELETE FROM products WHERE id=$1 RETURNING id', [id]);

    if (result.rowCount === 0) {
        // Product not found, or already deleted.
        await dbClient.query('ROLLBACK'); // Or COMMIT if "not found" is not an error for delete.
        return null; // Indicate product not found or no action taken.
    }

    if (performingUserId) {
      await logAction(dbClient, performingUserId, 'DELETE_PRODUCT', 'PRODUCT', id);
    } else {
      logger.warn(`DELETE_PRODUCT action for product ID ${id} performed without a performingUserId.`);
    }

    await dbClient.query('COMMIT');
    return { id: id, deleted: true }; // Indicate success
  } catch (error) {
    if (dbClient) await dbClient.query('ROLLBACK');
    logger.error(`Failed to delete product ID ${id} in model:`, error);
    throw error;
  } finally {
    if (dbClient) dbClient.release();
  }
}

module.exports = { getAll, getById, create, update, remove };
