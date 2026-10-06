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
const errorHandler = require('./middleware/errorHandler');
const { isPresent, isNonEmptyString, isPositiveInt, isValidStatus } = require('./validation');

function handleStockError(err, res, next) {
  if (err.code === 'INSUFFICIENT_STOCK') return res.status(409).json({ error: 'Insufficient stock' });
  if (err.code === 'INVENTORY_NOT_FOUND') return res.status(404).json({ error: err.message });
  next(err);
}

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

app.use(Auth.verify);

/**
 * @swagger
 * /users:
 *   post:
 *     summary: Create a new user
 *     tags: [Users]
 *     security:
 *       - xAuthToken: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *     responses:
 *       201:
 *         description: User created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 name:
 *                   type: string
 *       400:
 *         description: Invalid name
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       500:
 *         description: Server error
 */
app.post('/users', Auth.requireAdmin, async (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (name == null) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (typeof name !== 'string') {
      return res.status(400).json({ error: 'name must be a string' });
    }
    if (!isNonEmptyString(name)) {
      return res.status(400).json({ error: 'name is required' });
    }
    const user = await Users.create({ name: name.trim() });
    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /users:
 *   get:
 *     summary: Get all users
 *     tags: [Users]
 *     security:
 *       - xAuthToken: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: A list of users
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   name:
 *                     type: string
 *       500:
 *         description: Server error
 */
app.get('/users', Auth.requireAdmin, async (req, res, next) => {
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

/**
 * @swagger
 * /categories:
 *   get:
 *     summary: Get all categories
 *     tags: [Categories]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: A list of categories
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   name:
 *                     type: string
 *                   gst_percentage:
 *                     type: number
 *       500:
 *         description: Server error
 */
app.get('/categories', async (req, res, next) => {
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

/**
 * @swagger
 * /categories:
 *   post:
 *     summary: Create a new category
 *     tags: [Categories]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               gst_percentage:
 *                 type: number
 *     responses:
 *       201:
 *         description: Category created successfully
 *       500:
 *         description: Server error
 */
app.post('/categories', async (req, res, next) => {
  try {
    const cat = await Categories.create(req.body);
    res.status(201).json(cat);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /products:
 *   get:
 *     summary: Get all products
 *     tags: [Products]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: A list of products
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   name:
 *                     type: string
 *                   category_id:
 *                     type: integer
 *                   unit_price:
 *                     type: number
 *       500:
 *         description: Server error
 */
app.get('/products', async (req, res, next) => {
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

/**
 * @swagger
 * /products:
 *   post:
 *     summary: Create a new product
 *     tags: [Products]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               category_id:
 *                 type: integer
 *               unit_price:
 *                 type: number
 *     responses:
 *       201:
 *         description: Product created successfully
 *       500:
 *         description: Server error
 */
app.post('/products', async (req, res, next) => {
  try {
    const product = await Products.create(req.body);
    res.status(201).json(product);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /products/{id}:
 *   get:
 *     summary: Get a product by ID
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Product ID
 *     responses:
 *       200:
 *         description: Product details
 *       404:
 *         description: Product not found
 *       500:
 *         description: Server error
 */
app.get('/products/:id', async (req, res, next) => {
  try {
    const product = await Products.getById(req.params.id);
    if (!product) return res.status(404).end();
    res.json(product);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /products/{id}:
 *   put:
 *     summary: Update a product by ID
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Product ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               category_id:
 *                 type: integer
 *               unit_price:
 *                 type: number
 *     responses:
 *       200:
 *         description: Product updated successfully
 *       404:
 *         description: Product not found
 *       500:
 *         description: Server error
 */
app.put('/products/:id', async (req, res, next) => {
  try {
    const product = await Products.update(req.params.id, req.body);
    if (!product) return res.status(404).end();
    res.json(product);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /products/{id}:
 *   delete:
 *     summary: Delete a product by ID
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Product ID
 *     responses:
 *       204:
 *         description: Product deleted successfully
 *       500:
 *         description: Server error
 */
app.delete('/products/:id', async (req, res, next) => {
  try {
    await Products.remove(req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /batches:
 *   get:
 *     summary: Get all production batches
 *     tags: [Production Batches]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: A list of production batches
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   product_id:
 *                     type: integer
 *                   quantity:
 *                     type: number
 *                   manufacturing_date:
 *                     type: string
 *                     format: date
 *       500:
 *         description: Server error
 */
app.get('/batches', async (req, res, next) => {
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

/**
 * @swagger
 * /batches:
 *   post:
 *     summary: Create a new production batch
 *     tags: [Production Batches]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               product_id:
 *                 type: integer
 *               quantity:
 *                 type: number
 *               manufacturing_date:
 *                 type: string
 *                 format: date
 *     responses:
 *       201:
 *         description: Production batch created successfully
 *       500:
 *         description: Server error
 */
app.post('/batches', async (req, res, next) => {
  try {
    const batch = await Batches.create(req.body);
    res.status(201).json(batch);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /inventory:
 *   get:
 *     summary: Get all inventory items
 *     tags: [Inventory]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: A list of inventory items
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   product_id:
 *                     type: integer
 *                   quantity:
 *                     type: number
 *                   location:
 *                     type: string
 *       500:
 *         description: Server error
 */
app.get('/inventory', async (req, res, next) => {
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

/**
 * @swagger
 * /inventory/transfer:
 *   post:
 *     summary: Transfer inventory between locations
 *     tags: [Inventory]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               product_id:
 *                 type: integer
 *               from:
 *                 type: string
 *               to:
 *                 type: string
 *               quantity:
 *                 type: number
 *     responses:
 *       200:
 *         description: Inventory transferred successfully
 *       400:
 *         description: Invalid request body
 *       409:
 *         description: Insufficient stock at the source location
 *       500:
 *         description: Server error
 */
app.post('/inventory/transfer', async (req, res, next) => {
  const { product_id, from, to, quantity } = req.body;
  if (!isPresent(product_id)) return res.status(400).json({ error: 'product_id is required' });
  if (!isNonEmptyString(from)) return res.status(400).json({ error: 'from is required' });
  if (!isNonEmptyString(to)) return res.status(400).json({ error: 'to is required' });
  if (from === to) return res.status(400).json({ error: 'from and to must differ' });
  if (!isPositiveInt(quantity)) return res.status(400).json({ error: 'quantity must be a positive integer' });
  try {
    const inventory = await Inventory.transfer(product_id, from, to, quantity);
    res.json(inventory);
  } catch (err) {
    handleStockError(err, res, next);
  }
});

/**
 * @swagger
 * /sales:
 *   get:
 *     summary: Get all sales
 *     tags: [Sales]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: A list of sales
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   product_id:
 *                     type: integer
 *                   user_id:
 *                     type: integer
 *                   location:
 *                     type: string
 *                   quantity:
 *                     type: number
 *                   price:
 *                     type: number
 *                   discount:
 *                     type: number
 *                   gst:
 *                     type: number
 *                   status:
 *                     type: string
 *       500:
 *         description: Server error
 */
app.get('/sales', async (req, res, next) => {
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

/**
 * @swagger
 * /sales:
 *   post:
 *     summary: Create a new sale
 *     tags: [Sales]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [product_id, location, quantity]
 *             properties:
 *               product_id:
 *                 type: integer
 *               location:
 *                 type: string
 *               quantity:
 *                 type: integer
 *               price:
 *                 type: number
 *               discount:
 *                 type: number
 *               gst:
 *                 type: number
 *               status:
 *                 type: string
 *                 enum: [order_created, sold]
 *     responses:
 *       201:
 *         description: Sale created successfully
 *       400:
 *         description: Invalid request body
 *       404:
 *         description: No inventory row for the product at the location
 *       409:
 *         description: Insufficient stock
 *       500:
 *         description: Server error
 */
app.post('/sales', async (req, res, next) => {
  const { product_id, location, quantity, status } = req.body;
  if (!isPresent(product_id)) return res.status(400).json({ error: 'product_id is required' });
  if (!isNonEmptyString(location)) return res.status(400).json({ error: 'location is required' });
  if (!isPositiveInt(quantity)) return res.status(400).json({ error: 'quantity must be a positive integer' });
  if (status !== undefined && !isValidStatus(status)) {
    return res.status(400).json({ error: 'status must be order_created or sold' });
  }
  try {
    const sale = await Sales.create({ ...req.body, user_id: req.userId });
    res.status(201).json(sale);
  } catch (err) {
    handleStockError(err, res, next);
  }
});

/**
 * @swagger
 * /sales/{id}/status:
 *   patch:
 *     summary: Update sale status
 *     tags: [Sales]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Sale ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [order_created, sold]
 *     responses:
 *       200:
 *         description: Sale status updated successfully
 *       400:
 *         description: Invalid status
 *       404:
 *         description: Sale not found
 *       409:
 *         description: Insufficient stock
 *       500:
 *         description: Server error
 */
app.patch('/sales/:id/status', async (req, res, next) => {
  if (!isValidStatus(req.body.status)) {
    return res.status(400).json({ error: 'status must be order_created or sold' });
  }
  try {
    const sale = await Sales.updateStatus(req.params.id, req.body.status);
    if (!sale) return res.status(404).end();
    res.json(sale);
  } catch (err) {
    handleStockError(err, res, next);
  }
});

/**
 * @swagger
 * /sales/{id}:
 *   delete:
 *     summary: Delete a sale by ID
 *     tags: [Sales]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Sale ID
 *     responses:
 *       200:
 *         description: Sale deleted successfully
 *       404:
 *         description: Sale not found
 *       500:
 *         description: Server error
 */
app.delete('/sales/:id', async (req, res, next) => {
  try {
    const sale = await Sales.remove(req.params.id);
    if (!sale) return res.status(404).end();
    res.status(200).json(sale);
  } catch (err) {
    handleStockError(err, res, next);
  }
});

/**
 * @swagger
 * /sales/{id}/invoice:
 *   get:
 *     summary: Get invoice for a sale
 *     tags: [Sales]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Sale ID
 *     responses:
 *       200:
 *         description: Invoice details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       product_id:
 *                         type: integer
 *                       quantity:
 *                         type: number
 *                       price:
 *                         type: number
 *                       gst:
 *                         type: number
 *                 total:
 *                   type: number
 *                 gst:
 *                   type: number
 *       404:
 *         description: Sale not found
 *       500:
 *         description: Server error
 */
app.get('/sales/:id/invoice', async (req, res, next) => {
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

app.use(errorHandler);

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

module.exports = app;
