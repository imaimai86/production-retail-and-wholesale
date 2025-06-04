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

jest.mock('./models/sales', () => {
  let data = [];
  return {
    __reset: () => { data = []; },
    getAll: ({ limit = 10, offset = 0 } = {}) => Promise.resolve(data.slice(offset, offset + limit)),
    create: async (s) => { const item = { id: data.length + 1, ...s }; data.push(item); return item; }
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

const app = require('./index');

beforeEach(() => {
  Products.__reset();
  Batches.__reset();
  Inventory.__reset();
  Sales.__reset();
  Users.__reset();
});

describe('GET /', () => {
  it('should respond with status ok', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('API endpoints using responses', () => {
  const token = '1';
  const admin = process.env.ADMIN_TOKEN;

  test('create and list users', async () => {
    const create = await request(app).post('/users').set('x-auth-token', admin).send({ name: 'Bob' });
    expect(create.statusCode).toBe(201);

    const list = await request(app).get('/users').set('x-auth-token', admin);
    expect(list.statusCode).toBe(200);
    expect(list.body).toContainEqual(create.body);
  });

  test('create and list products', async () => {
    await request(app).post('/products').set('x-auth-token', token).send({ name: 'p', price_retail: 1, price_wholesale: 1 });
    const res = await request(app).get('/products').set('x-auth-token', token);
    expect(res.body.length).toBe(1);
  });

  test('create batch and verify list', async () => {
    await request(app).post('/batches').set('x-auth-token', token).send({ product_id: 1, quantity: 10 });
    const res = await request(app).get('/batches').set('x-auth-token', token);
    expect(res.body.length).toBe(1);
  });

  test('transfer inventory and list', async () => {
    await request(app).post('/inventory/transfer').set('x-auth-token', token).send({ product_id: 1, from: 'A', to: 'B', quantity: 5 });
    const res = await request(app).get('/inventory').set('x-auth-token', token);
    expect(res.body.length).toBe(1);
    expect(res.body[0]).toMatchObject({ product_id: 1, location: 'B', quantity: 5 });
  });

  test('create sale and list', async () => {
    await request(app).post('/sales').set('x-auth-token', token).send({ product_id: 1, quantity: 1, price: 10, gst: 1 });
    const res = await request(app).get('/sales').set('x-auth-token', token);
    expect(res.body.length).toBe(1);
  });
});
