const express = require('express');
const Products = require('./models/products');
const Batches = require('./models/batches');
const Inventory = require('./models/inventory');
const Sales = require('./models/sales');
const Users = require('./models/users');
const Categories = require('./models/categories');
const Auth = require('./middleware/auth');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

app.use(Auth.verify);

app.post('/users', Auth.requireAdmin, async (req, res, next) => {
  try {
    const user = await Users.create(req.body);
    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
});

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

app.post('/categories', async (req, res, next) => {
  try {
    const cat = await Categories.create(req.body);
    res.status(201).json(cat);
  } catch (err) {
    next(err);
  }
});

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

app.post('/products', async (req, res, next) => {
  try {
    const product = await Products.create(req.body);
    res.status(201).json(product);
  } catch (err) {
    next(err);
  }
});

app.get('/products/:id', async (req, res, next) => {
  try {
    const product = await Products.getById(req.params.id);
    if (!product) return res.status(404).end();
    res.json(product);
  } catch (err) {
    next(err);
  }
});

app.put('/products/:id', async (req, res, next) => {
  try {
    const product = await Products.update(req.params.id, req.body);
    if (!product) return res.status(404).end();
    res.json(product);
  } catch (err) {
    next(err);
  }
});

app.delete('/products/:id', async (req, res, next) => {
  try {
    await Products.remove(req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

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

app.post('/batches', async (req, res, next) => {
  try {
    const batch = await Batches.create(req.body);
    res.status(201).json(batch);
  } catch (err) {
    next(err);
  }
});

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

app.post('/inventory/transfer', async (req, res, next) => {
  const { product_id, from, to, quantity } = req.body;
  try {
    const inventory = await Inventory.transfer(product_id, from, to, quantity);
    res.json(inventory);
  } catch (err) {
    next(err);
  }
});

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

app.post('/sales', async (req, res, next) => {
  try {
    const sale = await Sales.create({ ...req.body, user_id: req.userId });
    res.status(201).json(sale);
  } catch (err) {
    next(err);
  }
});

app.patch('/sales/:id/status', async (req, res, next) => {
  try {
    const sale = await Sales.updateStatus(req.params.id, req.body.status);
    if (!sale) return res.status(404).end();
    res.json(sale);
  } catch (err) {
    next(err);
  }
});

app.delete('/sales/:id', async (req, res, next) => {
  try {
    const sale = await Sales.remove(req.params.id);
    if (!sale) return res.status(404).end();
    res.status(200).json(sale);
  } catch (err) {
    next(err);
  }
});

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

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

module.exports = app;
