const scratch = require('../../test-utils/scratchDb');

jest.setTimeout(30000);

const tracked = [];
let dbName;
let db;
let request;
let app;

beforeAll(async () => {
  const created = await scratch.createScratchDb();
  dbName = created.name;
  await scratch.applyMigrations(created.url);
  scratch.useScratchEnv(created.url);
  jest.resetModules();
  jest.doMock('pg', () => {
    const actual = jest.requireActual('pg');
    class TrackedPool extends actual.Pool {
      constructor(...a) { super(...a); tracked.push(this); }
    }
    return { ...actual, Pool: TrackedPool };
  });
  db = require('../../models/db');
  app = require('../../index');
  request = require('supertest');
});

afterAll(async () => {
  await Promise.all(tracked.map(p => p.end()));
  if (dbName) await scratch.dropScratchDb(dbName);
});

beforeEach(async () => {
  await db.query('TRUNCATE sales, inventory, batches, products, categories, users RESTART IDENTITY CASCADE');
});

async function seed(stock = {}) {
  const user = (await db.query("INSERT INTO users(name) VALUES('tester') RETURNING id")).rows[0];
  const cat = (await db.query("INSERT INTO categories(name, gst) VALUES('cat', 5) RETURNING id")).rows[0];
  const product = (await db.query(
    'INSERT INTO products(name, price_retail, price_wholesale, category_id) VALUES($1,$2,$3,$4) RETURNING id',
    ['widget', 100, 80, cat.id]
  )).rows[0];
  for (const [location, quantity] of Object.entries(stock)) {
    await db.query(
      'INSERT INTO inventory(product_id, location, quantity) VALUES($1,$2,$3)',
      [product.id, location, quantity]
    );
  }
  return { userId: user.id, productId: product.id };
}

const auth = userId => ({ 'x-auth-token': String(userId) });

async function stockOf(productId) {
  const { rows } = await db.query(
    'SELECT location, quantity FROM inventory WHERE product_id=$1 ORDER BY location',
    [productId]
  );
  return Object.fromEntries(rows.map(r => [r.location, r.quantity]));
}

const salesCount = async () =>
  (await db.query('SELECT COUNT(*)::int AS n FROM sales')).rows[0].n;

async function createSale(userId, productId, body = {}) {
  return request(app)
    .post('/sales')
    .set(auth(userId))
    .send({ product_id: productId, location: 'retail', quantity: 3, price: 100, gst: 5, status: 'sold', ...body });
}

describe('POST /inventory/transfer', () => {
  test('moves stock and creates the destination row', async () => {
    const { userId, productId } = await seed({ production: 10 });
    const res = await request(app)
      .post('/inventory/transfer')
      .set(auth(userId))
      .send({ product_id: productId, from: 'production', to: 'retail', quantity: 4 });
    expect(res.status).toBe(200);
    expect(await stockOf(productId)).toEqual({ production: 6, retail: 4 });
  });

  test('increments an existing destination row', async () => {
    const { userId, productId } = await seed({ production: 10, retail: 5 });
    const res = await request(app)
      .post('/inventory/transfer')
      .set(auth(userId))
      .send({ product_id: productId, from: 'production', to: 'retail', quantity: 4 });
    expect(res.status).toBe(200);
    expect(await stockOf(productId)).toEqual({ production: 6, retail: 9 });
  });

  test('transferring the entire stock leaves zero at the source', async () => {
    const { userId, productId } = await seed({ production: 4 });
    const res = await request(app)
      .post('/inventory/transfer')
      .set(auth(userId))
      .send({ product_id: productId, from: 'production', to: 'retail', quantity: 4 });
    expect(res.status).toBe(200);
    expect(await stockOf(productId)).toEqual({ production: 0, retail: 4 });
  });

  test('insufficient stock returns 409 and changes nothing', async () => {
    const { userId, productId } = await seed({ production: 10, retail: 2 });
    const before = await stockOf(productId);
    const res = await request(app)
      .post('/inventory/transfer')
      .set(auth(userId))
      .send({ product_id: productId, from: 'production', to: 'retail', quantity: 11 });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Insufficient stock' });
    expect(await stockOf(productId)).toEqual(before);
  });

  test('source location with no row returns 409 and creates nothing', async () => {
    const { userId, productId } = await seed({ production: 10 });
    const before = await stockOf(productId);
    const res = await request(app)
      .post('/inventory/transfer')
      .set(auth(userId))
      .send({ product_id: productId, from: 'warehouse', to: 'retail', quantity: 1 });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Insufficient stock' });
    expect(await stockOf(productId)).toEqual(before);
  });
});

describe('sales', () => {
  test('sold sale decrements only its own location and stores the user id', async () => {
    const { userId, productId } = await seed({ retail: 10, production: 5 });
    const res = await createSale(userId, productId);
    expect(res.status).toBe(201);
    expect(await stockOf(productId)).toEqual({ production: 5, retail: 7 });
    const { rows } = await db.query('SELECT user_id, location, status FROM sales');
    expect(rows).toEqual([{ user_id: userId, location: 'retail', status: 'sold' }]);
  });

  test('order_created sale does not touch stock', async () => {
    const { userId, productId } = await seed({ retail: 10 });
    const res = await createSale(userId, productId, { status: 'order_created' });
    expect(res.status).toBe(201);
    expect(await stockOf(productId)).toEqual({ retail: 10 });
  });

  test('sale above stock returns 409 and stores nothing', async () => {
    const { userId, productId } = await seed({ retail: 2 });
    const res = await createSale(userId, productId, { quantity: 3 });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Insufficient stock' });
    expect(await salesCount()).toBe(0);
    expect(await stockOf(productId)).toEqual({ retail: 2 });
  });

  test('status change sold -> order_created restores stock to the sale location', async () => {
    const { userId, productId } = await seed({ retail: 10, production: 5 });
    const sale = (await createSale(userId, productId)).body;
    expect(await stockOf(productId)).toEqual({ production: 5, retail: 7 });
    const res = await request(app)
      .patch(`/sales/${sale.id}/status`)
      .set(auth(userId))
      .send({ status: 'order_created' });
    expect(res.status).toBe(200);
    expect(await stockOf(productId)).toEqual({ production: 5, retail: 10 });
  });

  test('status change order_created -> sold decrements stock', async () => {
    const { userId, productId } = await seed({ retail: 10 });
    const sale = (await createSale(userId, productId, { status: 'order_created' })).body;
    const res = await request(app)
      .patch(`/sales/${sale.id}/status`)
      .set(auth(userId))
      .send({ status: 'sold' });
    expect(res.status).toBe(200);
    expect(await stockOf(productId)).toEqual({ retail: 7 });
  });

  test('deleting a sold sale restores stock and removes the row', async () => {
    const { userId, productId } = await seed({ retail: 10, production: 5 });
    const sale = (await createSale(userId, productId)).body;
    const res = await request(app).delete(`/sales/${sale.id}`).set(auth(userId));
    expect(res.status).toBe(200);
    expect(await stockOf(productId)).toEqual({ production: 5, retail: 10 });
    expect(await salesCount()).toBe(0);
  });

  test('deleting an order_created sale leaves stock unchanged', async () => {
    const { userId, productId } = await seed({ retail: 10 });
    const sale = (await createSale(userId, productId, { status: 'order_created' })).body;
    const res = await request(app).delete(`/sales/${sale.id}`).set(auth(userId));
    expect(res.status).toBe(200);
    expect(await stockOf(productId)).toEqual({ retail: 10 });
    expect(await salesCount()).toBe(0);
  });

  test('unknown location returns 404 and stores nothing', async () => {
    const { userId, productId } = await seed({ retail: 10 });
    const res = await createSale(userId, productId, { location: 'warehouse' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Inventory not found for product at location' });
    expect(await salesCount()).toBe(0);
    expect(await stockOf(productId)).toEqual({ retail: 10 });
  });
});
