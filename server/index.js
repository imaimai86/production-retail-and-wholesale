const path = require('path');
// Load environment variables from .env using dotenv
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const Products = require('./models/products');
const Batches = require('./models/batches');
const Inventory = require('./models/inventory');
const Sales = require('./models/sales');
const Users = require('./models/users');
const Categories = require('./models/categories');
const db = require('./models/db'); // Import db for getClient
const AuthMiddleware = require('./middleware/auth'); // Renamed for clarity if preferred, or use Auth
const { logAction } = require('./utils/auditLog');
const logger = require('./utils/logger'); // Import the new logger

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

// app.use(Auth.verify); // Removed global middleware

app.post('/users', AuthMiddleware.loadUserAndAuthenticate, AuthMiddleware.requireAdmin, async (req, res) => {
  let dbClient;
  try {
    dbClient = await db.getClient();
    await dbClient.query('BEGIN');

    // Ensure password_hash is handled if not done by Users.create. For now, assume Users.create handles it or it's passed in req.body.
    // const { name, email, role, password } = req.body;
    // const password_hash = await bcrypt.hash(password, 10); // Example if hashing here
    // const newUser = await Users.create({ name, email, password_hash, role }, dbClient);
    const newUser = await Users.create(req.body, dbClient);


    if (req.user && req.user.id && newUser && newUser.id) {
      await logAction(dbClient, req.user.id, 'CREATE_USER', 'USER', newUser.id);
    } else {
      throw new Error('User information or newUser ID missing for audit logging in POST /users.');
    }

    await dbClient.query('COMMIT');
    res.status(201).json(newUser);
  } catch (err) {
    if (dbClient) await dbClient.query('ROLLBACK');
    logger.error('Transaction failed for POST /users:', err);
    res.status(500).json({ error: 'Failed to create user.' });
  } finally {
    if (dbClient) dbClient.release();
  }
});

app.get('/users', AuthMiddleware.loadUserAndAuthenticate, AuthMiddleware.requireAdmin, async (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  try {
    const users = await Users.getAll({ limit, offset });
    res.json(users);
  } catch (err) {
    next(err);
  }
});

app.get('/categories', AuthMiddleware.loadUserAndAuthenticate, async (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  try {
    const cats = await Categories.getAll({ limit, offset });
    res.json(cats);
  } catch (err) {
    next(err);
  }
});

app.post('/categories', AuthMiddleware.loadUserAndAuthenticate, async (req, res) => {
  let dbClient;
  try {
    dbClient = await db.getClient();
    await dbClient.query('BEGIN');

    const newCategory = await Categories.create(req.body, dbClient);

    if (req.user && req.user.id && newCategory && newCategory.id) {
      await logAction(dbClient, req.user.id, 'CREATE_CATEGORY', 'CATEGORY', newCategory.id);
    } else {
      throw new Error('User information or newCategory ID missing for audit logging in POST /categories.');
    }

    await dbClient.query('COMMIT');
    res.status(201).json(newCategory);
  } catch (err) {
    if (dbClient) await dbClient.query('ROLLBACK');
    logger.error('Transaction failed for POST /categories:', err);
    res.status(500).json({ error: 'Failed to create category.' });
  } finally {
    if (dbClient) dbClient.release();
  }
});

app.get('/products', AuthMiddleware.loadUserAndAuthenticate, async (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  try {
    const products = await Products.getAll({ limit, offset });
    res.json(products);
  } catch (err) {
    next(err);
  }
});

app.post('/products', AuthMiddleware.loadUserAndAuthenticate, async (req, res) => {
  let dbClient;
  try {
    dbClient = await db.getClient();
    await dbClient.query('BEGIN');

    const newProduct = await Products.create(req.body, dbClient);

    if (req.user && req.user.id && newProduct && newProduct.id) {
      await logAction(dbClient, req.user.id, 'CREATE_PRODUCT', 'PRODUCT', newProduct.id);
    } else {
      throw new Error('User information or newProduct ID missing for audit logging in POST /products.');
    }

    await dbClient.query('COMMIT');
    res.status(201).json(newProduct);
  } catch (err) {
    if (dbClient) await dbClient.query('ROLLBACK');
    logger.error('Transaction failed for POST /products:', err);
    res.status(500).json({ error: 'Failed to create product.' });
  } finally {
    if (dbClient) dbClient.release();
  }
});

app.get('/products/:id', AuthMiddleware.loadUserAndAuthenticate, async (req, res, next) => {
  try {
    const product = await Products.getById(req.params.id);
    if (!product) return res.status(404).end();
    res.json(product);
  } catch (err) {
    next(err);
  }
});

app.put('/products/:id', AuthMiddleware.loadUserAndAuthenticate, async (req, res) => {
  let dbClient;
  try {
    dbClient = await db.getClient();
    await dbClient.query('BEGIN');

    const updatedProduct = await Products.update(req.params.id, req.body, dbClient);
    if (!updatedProduct) {
      // If product not found, commit transaction (as nothing changed) and send 404
      await dbClient.query('COMMIT'); // or ROLLBACK, depending on philosophy for 404s
      return res.status(404).json({ error: 'Product not found.'});
    }

    if (req.user && req.user.id) {
      await logAction(dbClient, req.user.id, 'UPDATE_PRODUCT', 'PRODUCT', parseInt(req.params.id));
    } else {
      throw new Error('User information missing for audit logging in PUT /products/:id.');
    }

    await dbClient.query('COMMIT');
    res.json(updatedProduct);
  } catch (err) {
    if (dbClient) await dbClient.query('ROLLBACK');
    logger.error(`Transaction failed for PUT /products/${req.params.id}:`, err);
    res.status(500).json({ error: 'Failed to update product.' });
  } finally {
    if (dbClient) dbClient.release();
  }
});

app.delete('/products/:id', AuthMiddleware.loadUserAndAuthenticate, async (req, res) => {
  let dbClient;
  try {
    dbClient = await db.getClient();
    await dbClient.query('BEGIN');

    // Optional: Check if product exists before attempting delete if Products.remove doesn't indicate this.
    // const existingProduct = await Products.getById(req.params.id, dbClient);
    // if (!existingProduct) {
    //   await dbClient.query('COMMIT'); // or ROLLBACK
    //   return res.status(404).json({ error: 'Product not found.' });
    // }

    await Products.remove(req.params.id, dbClient);

    if (req.user && req.user.id) {
      await logAction(dbClient, req.user.id, 'DELETE_PRODUCT', 'PRODUCT', parseInt(req.params.id));
    } else {
      throw new Error('User information missing for audit logging in DELETE /products/:id.');
    }

    await dbClient.query('COMMIT');
    res.status(204).end();
  } catch (err) {
    if (dbClient) await dbClient.query('ROLLBACK');
    logger.error(`Transaction failed for DELETE /products/${req.params.id}:`, err);
    res.status(500).json({ error: 'Failed to delete product.' });
  } finally {
    if (dbClient) dbClient.release();
  }
});

app.get('/batches', AuthMiddleware.loadUserAndAuthenticate, async (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  try {
    const batches = await Batches.getAll({ limit, offset });
    res.json(batches);
  } catch (err) {
    next(err);
  }
});

app.post('/batches', AuthMiddleware.loadUserAndAuthenticate, async (req, res) => {
  let dbClient;
  try {
    dbClient = await db.getClient();
    await dbClient.query('BEGIN');

    const newBatch = await Batches.create(req.body, dbClient);

    if (req.user && req.user.id && newBatch && newBatch.id) {
      await logAction(dbClient, req.user.id, 'CREATE_BATCH', 'BATCH', newBatch.id);
    } else {
      throw new Error('User information or newBatch ID missing for audit logging in POST /batches.');
    }

    await dbClient.query('COMMIT');
    res.status(201).json(newBatch);
  } catch (err) {
    if (dbClient) await dbClient.query('ROLLBACK');
    logger.error('Transaction failed for POST /batches:', err);
    res.status(500).json({ error: 'Failed to create batch.' });
  } finally {
    if (dbClient) dbClient.release();
  }
});

app.get('/inventory', AuthMiddleware.loadUserAndAuthenticate, async (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  try {
    const items = await Inventory.getAll({ limit, offset });
    res.json(items);
  } catch (err) {
    next(err);
  }
});

app.post('/inventory/transfer', AuthMiddleware.loadUserAndAuthenticate, async (req, res) => {
  let dbClient;
  try {
    dbClient = await db.getClient();
    await dbClient.query('BEGIN');

    const { product_id, from_location_id, to_location_id, quantity } = req.body; // Assuming from/to are location_ids
    const inventoryTransferResult = await Inventory.transfer(product_id, from_location_id, to_location_id, quantity, dbClient);

    if (req.user && req.user.id) {
      await logAction(dbClient, req.user.id, 'TRANSFER_INVENTORY', 'INVENTORY_TRANSFER', product_id || null);
    } else {
      throw new Error('User information missing for audit logging in POST /inventory/transfer.');
    }

    await dbClient.query('COMMIT');
    res.json(inventoryTransferResult);
  } catch (err) {
    if (dbClient) await dbClient.query('ROLLBACK');
    logger.error('Transaction failed for POST /inventory/transfer:', err);
    res.status(500).json({ error: 'Failed to transfer inventory.' });
  } finally {
    if (dbClient) dbClient.release();
  }
});

app.get('/sales', AuthMiddleware.loadUserAndAuthenticate, async (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  try {
    const sales = await Sales.getAll({ limit, offset });
    res.json(sales);
  } catch (err) {
    next(err);
  }
});

app.post('/sales', AuthMiddleware.loadUserAndAuthenticate, async (req, res) => {
  let dbClient;
  try {
    dbClient = await db.getClient();
    await dbClient.query('BEGIN');

    const saleData = { ...req.body, user_id: req.user.id };
    const newSale = await Sales.create(saleData, dbClient);

    if (req.user && req.user.id && newSale && newSale.id) {
      await logAction(dbClient, req.user.id, 'CREATE_SALE', 'SALE', newSale.id);
    } else {
      throw new Error('User information or newSale ID missing for audit logging in POST /sales.');
    }

    await dbClient.query('COMMIT');
    res.status(201).json(newSale);
  } catch (err) {
    if (dbClient) await dbClient.query('ROLLBACK');
    logger.error('Transaction failed for POST /sales:', err);
    res.status(500).json({ error: 'Failed to create sale.' });
  } finally {
    if (dbClient) dbClient.release();
  }
});

app.patch('/sales/:id/status', AuthMiddleware.loadUserAndAuthenticate, async (req, res) => {
  let dbClient;
  try {
    dbClient = await db.getClient();
    await dbClient.query('BEGIN');

    const updatedSale = await Sales.updateStatus(req.params.id, req.body.status, dbClient);
    if (!updatedSale) {
      await dbClient.query('COMMIT'); // or ROLLBACK
      return res.status(404).json({ error: 'Sale not found.'});
    }

    if (req.user && req.user.id && req.body.status) {
      const action = `UPDATE_SALE_STATUS_TO_${String(req.body.status).toUpperCase()}`;
      await logAction(dbClient, req.user.id, action, 'SALE', parseInt(req.params.id));
    } else {
      throw new Error('User information or status missing for audit logging in PATCH /sales/:id/status.');
    }

    await dbClient.query('COMMIT');
    res.json(updatedSale);
  } catch (err) {
    if (dbClient) await dbClient.query('ROLLBACK');
    logger.error(`Transaction failed for PATCH /sales/${req.params.id}/status:`, err);
    res.status(500).json({ error: 'Failed to update sale status.' });
  } finally {
    if (dbClient) dbClient.release();
  }
});

app.delete('/sales/:id', AuthMiddleware.loadUserAndAuthenticate, async (req, res) => {
  let dbClient;
  try {
    dbClient = await db.getClient();
    await dbClient.query('BEGIN');

    const deletedSale = await Sales.remove(req.params.id, dbClient);
    if (!deletedSale) {
      await dbClient.query('COMMIT'); // or ROLLBACK
      return res.status(404).json({ error: 'Sale not found.' });
    }

    if (req.user && req.user.id) {
      await logAction(dbClient, req.user.id, 'DELETE_SALE', 'SALE', parseInt(req.params.id));
    } else {
      throw new Error('User information missing for audit logging in DELETE /sales/:id.');
    }

    await dbClient.query('COMMIT');
    res.status(200).json(deletedSale); // Standard to return the deleted object or 204
  } catch (err) {
    if (dbClient) await dbClient.query('ROLLBACK');
    logger.error(`Transaction failed for DELETE /sales/${req.params.id}:`, err);
    res.status(500).json({ error: 'Failed to delete sale.' });
  } finally {
    if (dbClient) dbClient.release();
  }
});

app.get('/sales/:id/invoice', AuthMiddleware.loadUserAndAuthenticate, async (req, res, next) => {
  try {
    const sale = await Sales.getById(req.params.id);
    // naive invoice generation using sale record
    if (!sale) return res.status(404).end();
    const lineTotal = sale.price * sale.quantity - (sale.discount || 0);
    const gstAmount = lineTotal * (sale.gst / 100);
    res.json({
      items: [{ product_id: sale.product_id, quantity: sale.quantity, price: sale.price, gst: sale.gst }],
      total: lineTotal + gstAmount,
      gst: gstAmount
    });
  } catch (err) {
    next(err);
  }
});

if (require.main === module) {
  app.listen(port, () => {
    logger.info(`Server listening on port ${port}`);
  });
}

module.exports = app;
