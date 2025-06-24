const request = require('supertest');

process.env.ADMIN_TOKEN = 'secret';

jest.mock('./models/products', () => {
  let data = [];
  return {
    __reset: () => { data = []; },
    getAll: ({ limit = 10, offset = 0 } = {}) => Promise.resolve(data.slice(offset, offset + limit)),
    create: async (p) => { const item = { id: data.length + 1, ...p }; data.push(item); return item; },
    getById: async (id) => data.find(d => d.id === parseInt(id)),
    update: async (id, p) => { const i = data.findIndex(d => d.id === parseInt(id)); if(i<0) return null; data[i] = { ...data[i], ...p }; return data[i]; },
    remove: async (id) => { const i = data.findIndex(d => d.id === parseInt(id)); if(i>=0) data.splice(i,1); }
  };
});

jest.mock('./models/batches', () => {
  let data = [];
  return {
    __reset: () => { data = []; },
    getAll: ({ limit = 10, offset = 0 } = {}) => Promise.resolve(data.slice(offset, offset + limit)),
    create: async (b) => { const item = { id: data.length + 1, ...b }; data.push(item); return item; }
  };
});

jest.mock('./models/inventory', () => {
  let data = [];
  return {
    __reset: () => { data = []; },
    transfer: async (product_id, from, to, qty) => {
      const fromItem = data.find(i => i.product_id === product_id && i.location === from);
      if (fromItem) fromItem.quantity -= qty;
      let toItem = data.find(i => i.product_id === product_id && i.location === to);
      if (!toItem) { toItem = { id: data.length + 1, product_id, location: to, quantity: 0 }; data.push(toItem); }
      toItem.quantity += qty;
      return toItem;
    },
    getAll: ({ limit = 10, offset = 0 } = {}) => Promise.resolve(data.slice(offset, offset + limit))
  };
});

jest.mock('./models/categories', () => {
  let data = [];
  return {
    __reset: () => { data = []; },
    getAll: ({ limit = 10, offset = 0 } = {}) => Promise.resolve(data.slice(offset, offset + limit)),
    create: async (c) => { const item = { id: data.length + 1, ...c }; data.push(item); return item; }
  };
});

jest.mock('./models/sales', () => {
  let data = [];
  return {
    __reset: () => { data = []; },
    getAll: ({ limit = 10, offset = 0 } = {}) => Promise.resolve(data.slice(offset, offset + limit)),
    getById: async (id) => data.find(d => d.id === parseInt(id)),
    create: async (s) => { const item = { id: data.length + 1, ...s }; data.push(item); return item; },
    updateStatus: async (id, status) => {
      const sale = data.find(d => d.id === parseInt(id));
      if (!sale) return null; sale.status = status; return sale; },
    remove: async (id) => {
      const i = data.findIndex(d => d.id === parseInt(id));
      if (i >= 0) return data.splice(i,1)[0];
      return null;
    }
  };
});

jest.mock('./models/users', () => {
  let data = [];
  return {
    __reset: () => { data = []; },
    getAll: ({ limit = 10, offset = 0 } = {}) => Promise.resolve(data.slice(offset, offset + limit)),
    create: async (u) => { const item = { id: data.length + 1, ...u }; data.push(item); return item; }
  };
});

const Products = require('./models/products');
const Batches = require('./models/batches');
const Inventory = require('./models/inventory');
const Sales = require('./models/sales');
const Users = require('./models/users');
const Categories = require('./models/categories');

// const app = require('./index'); // No longer importing the app directly
const baseURL = process.env.TEST_BASE_URL || 'http://localhost:3000'; // Use environment variable or default

beforeEach(() => {
  Products.__reset();
  Batches.__reset();
  Inventory.__reset();
  Sales.__reset();
  Users.__reset();
  Categories.__reset && Categories.__reset();
});

describe('GET /', () => {
  it('should respond with status ok', async () => {
    const res = await request(baseURL).get('/');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('API endpoints using responses', () => {
  const token = process.env.X_AUTH_TOKEN || 'secrettoken'; // Standard user token from .env
  const adminToken = process.env.ADMIN_TOKEN || 'secrettoken'; // Admin token from .env

  // Note: These tests will run against a live server, but they are still using mocked data because
  // the server running in Docker will have its models mocked by Jest due to how Jest works
  // when `npm test` is run. This is a bit unusual.
  // For true integration tests, the server should run with *real* models connected to the test DB.
  // The current setup `docker exec $(CONTAINER_NAME) npm test` runs Jest inside the container,
  // so Jest's mocking behavior will still apply to the models as defined in this test file.

  test('create and list users', async () => {
    // User creation requires admin token.
    const createUserPayload = { username: 'Bob', password: 'password', role: 'admin' };
    const create = await request(baseURL).post('/users').set('x-auth-token', adminToken).send(createUserPayload);
    expect(create.statusCode).toBe(201);

    const list = await request(baseURL).get('/users').set('x-auth-token', adminToken);
    expect(list.statusCode).toBe(200);
    // The body will contain all users created by the mocked Users.create.
    // We need to find the one we just created.
    expect(list.body).toEqual(expect.arrayContaining([expect.objectContaining(createUserPayload)]));
  });

  test('create and list products', async () => {
    const productPayload = { name: 'p', category_id: 1, unit_price: 10.00 };
    const createResponse = await request(baseURL).post('/products').set('x-auth-token', token).send(productPayload);
    expect(createResponse.statusCode).toBe(201);
    const res = await request(baseURL).get('/products').set('x-auth-token', token);
    expect(res.body).toEqual(expect.arrayContaining([expect.objectContaining(productPayload)]));
  });

  test('create batch and verify list', async () => {
    const batchPayload = { product_id: 1, quantity: 10, manufacturing_date: new Date().toISOString().split('T')[0] };
    const createResponse = await request(baseURL).post('/batches').set('x-auth-token', token).send(batchPayload);
    expect(createResponse.statusCode).toBe(201);
    const res = await request(baseURL).get('/batches').set('x-auth-token', token);
    expect(res.body).toEqual(expect.arrayContaining([expect.objectContaining(batchPayload)]));
  });

  test('transfer inventory and list', async () => {
    // This test assumes product_id 1 exists and has inventory at location 'A'.
    // With mocks, this might not behave as expected unless the mock is pre-populated or handles this.
    // The current Inventory mock for transfer just creates/updates quantity.
    const transferPayload = { product_id: 1, from: 'A', to: 'B', quantity: 5 };
    const transferResponse = await request(baseURL).post('/inventory/transfer').set('x-auth-token', token).send(transferPayload);
    expect(transferResponse.statusCode).toBe(200); // Assuming /inventory/transfer returns 200 on success

    const res = await request(baseURL).get('/inventory').set('x-auth-token', token);
    // The mock for getAll returns all items, so we check if the transferred item is present
    expect(res.body).toEqual(expect.arrayContaining([expect.objectContaining({ product_id: 1, location: 'B', quantity: 5 })]));
  });

  test('create sale and list', async () => {
    const salePayload = { product_id: 1, quantity: 1, price: 10, discount:0, gst: 1, user_id: 1 }; // user_id is set by auth middleware
    const createResponse = await request(baseURL).post('/sales').set('x-auth-token', token).send(salePayload);
    expect(createResponse.statusCode).toBe(201);

    const res = await request(baseURL).get('/sales').set('x-auth-token', token);
    // Remove user_id for comparison if it's auto-assigned and not in original payload for mock
    const expectedSale = { ...salePayload, user_id: createResponse.body.user_id }; // Assuming token '1' corresponds to user_id 1
    expect(res.body).toEqual(expect.arrayContaining([expect.objectContaining(expectedSale)]));
  });

  test('update sale status and invoice', async () => {
    const salePayload = { product_id: 1, quantity: 1, price: 10, gst: 1, status: 'order_created', user_id: 1 };
    const create = await request(baseURL).post('/sales').set('x-auth-token', token).send(salePayload);
    expect(create.statusCode).toBe(201);

    const updated = await request(baseURL).patch(`/sales/${create.body.id}/status`).set('x-auth-token', token).send({ status: 'sold' });
    expect(updated.body.status).toBe('sold');

    const invoice = await request(baseURL).get(`/sales/${create.body.id}/invoice`).set('x-auth-token', token);
    expect(invoice.statusCode).toBe(200);
    // Invoice content depends on the mocked getById for sales.
    // The current mock will find the created sale.
    const lineTotal = salePayload.price * salePayload.quantity - (salePayload.discount || 0);
    const gstAmount = lineTotal * (salePayload.gst / 100);
    expect(invoice.body).toEqual({
      items: [{ product_id: salePayload.product_id, quantity: salePayload.quantity, price: salePayload.price, gst: salePayload.gst }],
      total: lineTotal + gstAmount,
      gst: gstAmount
    });
  });

  test('create and list categories', async () => {
    const categoryPayload = { name: 'Electronics', gst_percentage: 18 };
    const createResponse = await request(baseURL).post('/categories').set('x-auth-token', token).send(categoryPayload);
    expect(createResponse.statusCode).toBe(201);

    const res = await request(baseURL).get('/categories').set('x-auth-token', token);
    expect(res.body).toEqual(expect.arrayContaining([expect.objectContaining(categoryPayload)]));
  });
});
