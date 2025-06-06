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
const Auth = require('./middleware/auth');
const morgan = require('morgan');
const logger = require('./logger'); // Import logger

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(morgan('dev'));

app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

app.use(Auth.verify);

app.post('/users', Auth.requireAdmin, async (req, res, next) => {
  try {
    logger.info(`Attempting to create user with email: ${req.body.email}`);
    const user = await Users.create(req.body);
    logger.info(`User created successfully with ID: ${user.id}`);
    res.status(201).json(user);
  } catch (err) {
    logger.error(`Error creating user: ${err.message}`, { stack: err.stack, requestBody: req.body });
    next(err);
  }
});

app.get('/users', Auth.requireAdmin, async (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  try {
    logger.info(`Fetching list of users. Page: ${page}, Limit: ${limit}`);
    const users = await Users.getAll({ limit, offset });
    logger.info(`Successfully fetched ${users.length} users.`);
    res.json(users);
  } catch (err) {
    logger.error(`Error fetching users: ${err.message}`, { stack: err.stack });
    next(err);
  }
});

app.get('/categories', async (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  try {
    logger.info(`Fetching categories. Page: ${page}, Limit: ${limit}`);
    const cats = await Categories.getAll({ limit, offset });
    logger.info(`Successfully fetched ${cats.length} categories.`);
    res.json(cats);
  } catch (err) {
    logger.error(`Error fetching categories: ${err.message}`, { stack: err.stack });
    next(err);
  }
});

app.post('/categories', async (req, res, next) => {
  try {
    logger.info('Attempting to create category', { requestBody: req.body });
    const cat = await Categories.create(req.body);
    logger.info(`Category created successfully with ID: ${cat.id}`);
    res.status(201).json(cat);
  } catch (err) {
    logger.error(`Error creating category: ${err.message}`, { stack: err.stack, requestBody: req.body });
    next(err);
  }
});

app.get('/products', async (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  try {
    logger.info(`Fetching products. Page: ${page}, Limit: ${limit}`);
    const products = await Products.getAll({ limit, offset });
    logger.info(`Successfully fetched ${products.length} products.`);
    res.json(products);
  } catch (err) {
    logger.error(`Error fetching products: ${err.message}`, { stack: err.stack });
    next(err);
  }
});

app.post('/products', async (req, res, next) => {
  try {
    logger.info('Attempting to create product', { requestBody: req.body });
    const product = await Products.create(req.body);
    logger.info(`Product created successfully with ID: ${product.id}`);
    res.status(201).json(product);
  } catch (err) {
    logger.error(`Error creating product: ${err.message}`, { stack: err.stack, requestBody: req.body });
    next(err);
  }
});

app.get('/products/:id', async (req, res, next) => {
  try {
    logger.info(`Fetching product with ID: ${req.params.id}`);
    const product = await Products.getById(req.params.id);
    if (!product) {
      logger.warn(`Product with ID: ${req.params.id} not found.`);
      return res.status(404).end();
    }
    logger.info(`Successfully fetched product with ID: ${product.id}`);
    res.json(product);
  } catch (err) {
    logger.error(`Error fetching product ID ${req.params.id}: ${err.message}`, { stack: err.stack });
    next(err);
  }
});

app.put('/products/:id', async (req, res, next) => {
  try {
    logger.info(`Attempting to update product ID: ${req.params.id}`, { requestBody: req.body });
    const product = await Products.update(req.params.id, req.body);
    if (!product) {
      logger.warn(`Product with ID: ${req.params.id} not found for update.`);
      return res.status(404).end();
    }
    logger.info(`Product updated successfully with ID: ${product.id}`);
    res.json(product);
  } catch (err) {
    logger.error(`Error updating product ID ${req.params.id}: ${err.message}`, { stack: err.stack, requestBody: req.body });
    next(err);
  }
});

app.delete('/products/:id', async (req, res, next) => {
  try {
    logger.info(`Attempting to delete product ID: ${req.params.id}`);
    await Products.remove(req.params.id);
    logger.info(`Product deleted successfully with ID: ${req.params.id}`);
    res.status(204).end();
  } catch (err) {
    logger.error(`Error deleting product ID ${req.params.id}: ${err.message}`, { stack: err.stack });
    next(err);
  }
});

app.get('/batches', async (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  try {
    logger.info(`Fetching batches. Page: ${page}, Limit: ${limit}`);
    const batches = await Batches.getAll({ limit, offset });
    logger.info(`Successfully fetched ${batches.length} batches.`);
    res.json(batches);
  } catch (err) {
    logger.error(`Error fetching batches: ${err.message}`, { stack: err.stack });
    next(err);
  }
});

app.post('/batches', async (req, res, next) => {
  try {
    logger.info('Attempting to create batch', { requestBody: req.body });
    const batch = await Batches.create(req.body);
    logger.info(`Batch created successfully with ID: ${batch.id}`);
    res.status(201).json(batch);
  } catch (err) {
    logger.error(`Error creating batch: ${err.message}`, { stack: err.stack, requestBody: req.body });
    next(err);
  }
});

app.get('/inventory', async (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  try {
    logger.info(`Fetching inventory. Page: ${page}, Limit: ${limit}`);
    const items = await Inventory.getAll({ limit, offset });
    logger.info(`Successfully fetched ${items.length} inventory items.`);
    res.json(items);
  } catch (err) {
    logger.error(`Error fetching inventory: ${err.message}`, { stack: err.stack });
    next(err);
  }
});

app.post('/inventory/transfer', async (req, res, next) => {
  const { product_id, from, to, quantity } = req.body;
  try {
    logger.info('Attempting to transfer inventory', { requestBody: req.body });
    const inventory = await Inventory.transfer(product_id, from, to, quantity);
    logger.info('Inventory transferred successfully', { result: inventory });
    res.json(inventory);
  } catch (err) {
    logger.error(`Error transferring inventory: ${err.message}`, { stack: err.stack, requestBody: req.body });
    next(err);
  }
});

app.get('/sales', async (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  try {
    logger.info(`Fetching list of sales. Page: ${page}, Limit: ${limit}, User ID: ${req.userId}`);
    const sales = await Sales.getAll({ limit, offset });
    logger.info(`Successfully fetched ${sales.length} sales.`);
    res.json(sales);
  } catch (err) {
    logger.error(`Error fetching sales: ${err.message}`, { stack: err.stack });
    next(err);
  }
});

app.post('/sales', async (req, res, next) => {
  try {
    logger.info(`Attempting to create sale for user ID: ${req.userId}`, { requestBody: req.body });
    const sale = await Sales.create({ ...req.body, user_id: req.userId });
    logger.info(`Sale created successfully with ID: ${sale.id} for user ID: ${req.userId}`);
    res.status(201).json(sale);
  } catch (err) {
    logger.error(`Error creating sale for user ID ${req.userId}: ${err.message}`, { stack: err.stack, requestBody: req.body });
    next(err);
  }
});

app.patch('/sales/:id/status', async (req, res, next) => {
  try {
    logger.info(`Attempting to update status for sale ID: ${req.params.id} to ${req.body.status} by user ID: ${req.userId}`);
    const sale = await Sales.updateStatus(req.params.id, req.body.status);
    if (!sale) return res.status(404).end();
    logger.info(`Sale status updated successfully for sale ID: ${sale.id}`);
    res.json(sale);
  } catch (err) {
    logger.error(`Error updating status for sale ID ${req.params.id}: ${err.message}`, { stack: err.stack, requestBody: req.body });
    next(err);
  }
});

app.delete('/sales/:id', async (req, res, next) => {
  try {
    logger.info(`Attempting to delete sale ID: ${req.params.id} by user ID: ${req.userId}`);
    const sale = await Sales.remove(req.params.id);
    if (!sale) return res.status(404).end();
    logger.info(`Sale deleted successfully with ID: ${req.params.id}`);
    res.status(200).json(sale);
  } catch (err) {
    logger.error(`Error deleting sale ID ${req.params.id}: ${err.message}`, { stack: err.stack });
    next(err);
  }
});

app.get('/sales/:id/invoice', async (req, res, next) => {
  try {
    logger.info(`Generating invoice for sale ID: ${req.params.id} by user ID: ${req.userId}`);
    const sale = await Sales.getById(req.params.id);
    // naive invoice generation using sale record
    if (!sale) return res.status(404).end();
    logger.info(`Invoice generated successfully for sale ID: ${req.params.id}`);
    const lineTotal = sale.price * sale.quantity - (sale.discount || 0);
    const gstAmount = lineTotal * (sale.gst / 100);
    res.json({
      items: [{ product_id: sale.product_id, quantity: sale.quantity, price: sale.price, gst: sale.gst }],
      total: lineTotal + gstAmount,
      gst: gstAmount
    });
  } catch (err) {
    logger.error(`Error generating invoice for sale ID ${req.params.id}: ${err.message}`, { stack: err.stack });
    next(err);
  }
});

// Error logging middleware
app.use((err, req, res, next) => {
  logger.error(`Error: ${err.message}, Stack: ${err.stack}, URL: ${req.originalUrl}`);
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({ error: 'Internal Server Error' });
});

if (require.main === module) {
  app.listen(port, () => {
    logger.info(`Server listening on port ${port}`); // Use logger.info
  });
}

module.exports = app;
