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
// db import might become unused if all routes are simplified
// const db = require('./models/db');
const AuthMiddleware = require('./middleware/auth');
// logAction import will likely become unused
// const { logAction } = require('./utils/auditLog');
const logger = require('./utils/logger');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

// app.use(Auth.verify); // Removed global middleware

app.post('/users', AuthMiddleware.loadUserAndAuthenticate, AuthMiddleware.requireAdmin, async (req, res) => {
  try {
    const performingUserId = req.user ? req.user.id : null;
    // Assuming Users.create now handles its own transaction and audit logging
    // It requires userData and performingUserId
    const newUser = await Users.create(req.body, performingUserId);
    res.status(201).json(newUser);
  } catch (err) {
    logger.error(`POST /users - Error: ${err.message}`, { error: err });
    // Check for specific error types if models start throwing them (e.g., validation errors)
    // For now, a generic 500, as models re-throw after logging their specific DB error.
    res.status(500).json({ error: 'Failed to create user.' });
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
  try {
    const performingUserId = req.user ? req.user.id : null;
    const newCategory = await Categories.create(req.body, performingUserId);
    res.status(201).json(newCategory);
  } catch (err) {
    logger.error(`POST /categories - Error: ${err.message}`, { error: err });
    res.status(500).json({ error: 'Failed to create category.' });
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
  try {
    const performingUserId = req.user ? req.user.id : null;
    const newProduct = await Products.create(req.body, performingUserId);
    res.status(201).json(newProduct);
  } catch (err) {
    logger.error(`POST /products - Error: ${err.message}`, { error: err });
    res.status(500).json({ error: 'Failed to create product.' });
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
  try {
    const performingUserId = req.user ? req.user.id : null;
    const updatedProduct = await Products.update(req.params.id, req.body, performingUserId);
    if (!updatedProduct) {
      return res.status(404).json({ error: 'Product not found.'});
    }
    res.json(updatedProduct);
  } catch (err) {
    logger.error(`PUT /products/${req.params.id} - Error: ${err.message}`, { error: err });
    res.status(500).json({ error: 'Failed to update product.' });
  }
});

app.delete('/products/:id', AuthMiddleware.loadUserAndAuthenticate, async (req, res) => {
  try {
    const performingUserId = req.user ? req.user.id : null;
    const result = await Products.remove(req.params.id, performingUserId);
    if (!result) { // Assuming model.remove returns null if not found
        return res.status(404).json({ error: 'Product not found.' });
    }
    res.status(204).end();
  } catch (err) {
    logger.error(`DELETE /products/${req.params.id} - Error: ${err.message}`, { error: err });
    res.status(500).json({ error: 'Failed to delete product.' });
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
  try {
    const performingUserId = req.user ? req.user.id : null;
    const newBatch = await Batches.create(req.body, performingUserId);
    res.status(201).json(newBatch);
  } catch (err) {
    logger.error(`POST /batches - Error: ${err.message}`, { error: err });
    res.status(500).json({ error: 'Failed to create batch.' });
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
  try {
    const performingUserId = req.user ? req.user.id : null;
    const { product_id, from_location_id, to_location_id, quantity } = req.body;
    const inventoryTransferResult = await Inventory.transfer(product_id, from_location_id, to_location_id, quantity, performingUserId);
    res.json(inventoryTransferResult);
  } catch (err) {
    logger.error(`POST /inventory/transfer - Error: ${err.message}`, { error: err });
    // Consider specific error for insufficient quantity or item not found if model throws custom errors
    res.status(500).json({ error: 'Failed to transfer inventory.' });
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
  try {
    // performingUserId for Sales.create is derived from req.user.id, which is also part of saleData.user_id
    const performingUserId = req.user ? req.user.id : null;
    if (!performingUserId) {
        // This case should ideally be prevented by AuthMiddleware.loadUserAndAuthenticate
        logger.error('POST /sales - Critical: No user ID found after authentication.');
        return res.status(401).json({ error: 'User authentication issue.' });
    }
    const saleData = { ...req.body, user_id: performingUserId };
    const newSale = await Sales.create(saleData, performingUserId); // Pass performingUserId explicitly for audit log
    res.status(201).json(newSale);
  } catch (err) {
    logger.error(`POST /sales - Error: ${err.message}`, { error: err });
    res.status(500).json({ error: 'Failed to create sale.' });
  }
});

app.patch('/sales/:id/status', AuthMiddleware.loadUserAndAuthenticate, async (req, res) => {
  try {
    const performingUserId = req.user ? req.user.id : null;
    const updatedSale = await Sales.updateStatus(req.params.id, req.body.status, performingUserId);
    if (!updatedSale) {
      return res.status(404).json({ error: 'Sale not found.'});
    }
    res.json(updatedSale);
  } catch (err) {
    logger.error(`PATCH /sales/${req.params.id}/status - Error: ${err.message}`, { error: err });
    res.status(500).json({ error: 'Failed to update sale status.' });
  }
});

app.delete('/sales/:id', AuthMiddleware.loadUserAndAuthenticate, async (req, res) => {
  try {
    const performingUserId = req.user ? req.user.id : null;
    const deletedSale = await Sales.remove(req.params.id, performingUserId);
    if (!deletedSale) {
      return res.status(404).json({ error: 'Sale not found.' });
    }
    res.status(200).json(deletedSale);
  } catch (err) {
    logger.error(`DELETE /sales/${req.params.id} - Error: ${err.message}`, { error: err });
    res.status(500).json({ error: 'Failed to delete sale.' });
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
