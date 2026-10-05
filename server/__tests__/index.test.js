const request = require('supertest');

process.env.ADMIN_TOKEN = 'secret';

jest.mock('../models/products', () => {
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

jest.mock('../models/batches', () => {
  let data = [];
  return {
    __reset: () => { data = []; },
    getAll: ({ limit = 10, offset = 0 } = {}) => Promise.resolve(data.slice(offset, offset + limit)),
    create: async (b) => { const item = { id: data.length + 1, ...b }; data.push(item); return item; }
  };
});

jest.mock('../models/inventory', () => {
  let data = [];
  const coded = (code, message) => Object.assign(new Error(message), { code });
  return {
    __reset: () => { data = []; },
    __seed: rows => { data = rows.map(r => ({ ...r })); },
    transfer: jest.fn(async (product_id, from, to, qty) => {
      const fromItem = data.find(i => i.product_id === product_id && i.location === from);
      if (!fromItem || fromItem.quantity < qty) throw coded('INSUFFICIENT_STOCK', 'Insufficient stock');
      fromItem.quantity -= qty;
      let toItem = data.find(i => i.product_id === product_id && i.location === to);
      if (!toItem) { toItem = { id: data.length + 1, product_id, location: to, quantity: 0 }; data.push(toItem); }
      toItem.quantity += qty;
      return toItem;
    }),
    getAll: ({ limit = 10, offset = 0 } = {}) => Promise.resolve(data.slice(offset, offset + limit))
  };
});

jest.mock('../models/categories', () => {
  let data = [];
  return {
    __reset: () => { data = []; },
    getAll: ({ limit = 10, offset = 0 } = {}) => Promise.resolve(data.slice(offset, offset + limit)),
    create: async (c) => { const item = { id: data.length + 1, ...c }; data.push(item); return item; }
  };
});

jest.mock('../models/sales', () => {
  let data = [];
  return {
    __reset: () => { data = []; },
    getAll: ({ limit = 10, offset = 0 } = {}) => Promise.resolve(data.slice(offset, offset + limit)),
    getById: async (id) => data.find(d => d.id === parseInt(id)),
    create: jest.fn(async (s) => { const item = { id: data.length + 1, ...s }; data.push(item); return item; }),
    updateStatus: jest.fn(async (id, status) => {
      const sale = data.find(d => d.id === parseInt(id));
      if (!sale) return null; sale.status = status; return sale; }),
    remove: jest.fn(async (id) => {
      const i = data.findIndex(d => d.id === parseInt(id));
      if (i >= 0) return data.splice(i,1)[0];
      return null;
    })
  };
});

jest.mock('../models/users', () => {
  let data = [];
  return {
    __reset: () => { data = []; },
    getAll: ({ limit = 10, offset = 0 } = {}) => Promise.resolve(data.slice(offset, offset + limit)),
    create: async (u) => { const item = { id: data.length + 1, ...u }; data.push(item); return item; }
  };
});

const Products = require('../models/products');
const Batches = require('../models/batches');
const Inventory = require('../models/inventory');
const Sales = require('../models/sales');
const Users = require('../models/users');
const Categories = require('../models/categories');

const app = require('../index');

const coded = (code, message) => Object.assign(new Error(message), { code });

beforeEach(() => {
  jest.clearAllMocks();
  Products.__reset();
  Batches.__reset();
  Inventory.__reset();
  Sales.__reset();
  Users.__reset();
  Categories.__reset && Categories.__reset();
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
    Inventory.__seed([{ id: 1, product_id: 1, location: 'A', quantity: 8 }]);
    await request(app).post('/inventory/transfer').set('x-auth-token', token).send({ product_id: 1, from: 'A', to: 'B', quantity: 5 });
    const res = await request(app).get('/inventory').set('x-auth-token', token);
    expect(res.body.length).toBe(2);
    expect(res.body[0]).toMatchObject({ product_id: 1, location: 'A', quantity: 3 });
    expect(res.body[1]).toMatchObject({ product_id: 1, location: 'B', quantity: 5 });
  });

  test('create sale and list', async () => {
    await request(app).post('/sales').set('x-auth-token', token).send({ product_id: 1, location: 'retail', quantity: 1, price: 10, gst: 1 });
    const res = await request(app).get('/sales').set('x-auth-token', token);
    expect(res.body.length).toBe(1);
  });

  test('update sale status and invoice', async () => {
    const create = await request(app).post('/sales').set('x-auth-token', token).send({ product_id: 1, location: 'retail', quantity: 1, price: 10, gst: 1, status: 'order_created' });
    expect(create.statusCode).toBe(201);
    const updated = await request(app).patch(`/sales/${create.body.id}/status`).set('x-auth-token', token).send({ status: 'sold' });
    expect(updated.body.status).toBe('sold');
    const invoice = await request(app).get(`/sales/${create.body.id}/invoice`).set('x-auth-token', token);
    expect(invoice.statusCode).toBe(200);
  });

  test('create and list categories', async () => {
    await request(app).post('/categories').set('x-auth-token', token).send({ name: 'c', gst: 10 });
    const res = await request(app).get('/categories').set('x-auth-token', token);
    expect(res.body.length).toBe(1);
  });
});

describe('POST /inventory/transfer validation and errors', () => {
  const token = '1';
  const valid = { product_id: 1, from: 'A', to: 'B', quantity: 5 };
  const post = body => request(app).post('/inventory/transfer').set('x-auth-token', token).send(body);

  test('T-R1 valid body calls the model and returns 200', async () => {
    Inventory.__seed([{ id: 1, product_id: 1, location: 'A', quantity: 5 }]);
    const res = await post(valid);
    expect(res.statusCode).toBe(200);
    expect(Inventory.transfer).toHaveBeenCalledWith(1, 'A', 'B', 5);
  });

  const invalid = {
    'missing product_id': { from: 'A', to: 'B', quantity: 5 },
    'empty product_id': { ...valid, product_id: '' },
    'missing from': { product_id: 1, to: 'B', quantity: 5 },
    'empty from': { ...valid, from: '' },
    'whitespace from': { ...valid, from: '   ' },
    'missing to': { product_id: 1, from: 'A', quantity: 5 },
    'empty to': { ...valid, to: '' },
    'whitespace to': { ...valid, to: ' ' },
    'from equals to': { ...valid, to: 'A' },
    'missing quantity': { product_id: 1, from: 'A', to: 'B' },
    'zero quantity': { ...valid, quantity: 0 },
    'negative quantity': { ...valid, quantity: -1 },
    'fractional quantity': { ...valid, quantity: 1.5 },
    'string quantity': { ...valid, quantity: '5' },
    'null quantity': { ...valid, quantity: null }
  };
  test.each(Object.entries(invalid))('T-R2..6 400 for %s', async (_name, body) => {
    const res = await post(body);
    expect(res.statusCode).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error).not.toBe('');
    expect(Inventory.transfer).not.toHaveBeenCalled();
  });

  test('T-R7 insufficient stock returns 409', async () => {
    Inventory.transfer.mockRejectedValueOnce(coded('INSUFFICIENT_STOCK', 'Insufficient stock'));
    const res = await post(valid);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'Insufficient stock' });
  });

  test('T-R7b a short source through the mock returns 409', async () => {
    Inventory.__seed([{ id: 1, product_id: 1, location: 'A', quantity: 4 }]);
    const res = await post(valid);
    expect(res.statusCode).toBe(409);
  });

  test('T-R8 locations differing only by case are accepted as different', async () => {
    Inventory.__seed([{ id: 1, product_id: 1, location: 'Retail', quantity: 5 }]);
    const res = await post({ ...valid, from: 'Retail', to: 'retail' });
    expect(res.statusCode).toBe(200);
    expect(Inventory.transfer).toHaveBeenCalledWith(1, 'Retail', 'retail', 5);
  });

  test('T-R9 an unexpected error returns 500', async () => {
    Inventory.transfer.mockRejectedValueOnce(new Error('boom'));
    const res = await post(valid);
    expect(res.statusCode).toBe(500);
  });
});

describe('POST /sales validation and errors', () => {
  const token = '1';
  const valid = { product_id: 1, location: 'retail', quantity: 2, price: 10, gst: 1 };
  const post = body => request(app).post('/sales').set('x-auth-token', token).send(body);

  test('S-R1 valid body returns 201 and passes location through untrimmed', async () => {
    const res = await post({ ...valid, location: ' Retail ', status: 'sold' });
    expect(res.statusCode).toBe(201);
    expect(Sales.create).toHaveBeenCalledWith(expect.objectContaining({ location: ' Retail ', user_id: token }));
  });

  test.each([[undefined], ['order_created'], ['sold']])('S-R2 status %s is accepted', async status => {
    const body = status === undefined ? valid : { ...valid, status };
    const res = await post(body);
    expect(res.statusCode).toBe(201);
  });

  const invalid = {
    'missing product_id': { ...valid, product_id: undefined },
    'empty product_id': { ...valid, product_id: '' },
    'missing location': { ...valid, location: undefined },
    'empty location': { ...valid, location: '' },
    'whitespace location': { ...valid, location: '   ' },
    'numeric location': { ...valid, location: 5 },
    'null location': { ...valid, location: null },
    'missing quantity': { ...valid, quantity: undefined },
    'zero quantity': { ...valid, quantity: 0 },
    'negative quantity': { ...valid, quantity: -2 },
    'fractional quantity': { ...valid, quantity: 1.5 },
    'string quantity': { ...valid, quantity: '2' },
    'unknown status': { ...valid, status: 'bogus' },
    'shipped status': { ...valid, status: 'shipped' },
    'empty status': { ...valid, status: '' }
  };
  test.each(Object.entries(invalid))('S-R3..6 400 for %s', async (_name, body) => {
    const res = await post(body);
    expect(res.statusCode).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error).not.toBe('');
    expect(Sales.create).not.toHaveBeenCalled();
  });

  test('S-R7 a missing inventory row returns 404 with an error body', async () => {
    Sales.create.mockRejectedValueOnce(coded('INVENTORY_NOT_FOUND', 'Inventory not found'));
    const res = await post(valid);
    expect(res.statusCode).toBe(404);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error).not.toBe('');
  });

  test('S-R8 insufficient stock returns 409', async () => {
    Sales.create.mockRejectedValueOnce(coded('INSUFFICIENT_STOCK', 'Insufficient stock'));
    const res = await post(valid);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'Insufficient stock' });
  });

  test('S-R9 validation wins over a would-be 404', async () => {
    Sales.create.mockRejectedValueOnce(coded('INVENTORY_NOT_FOUND', 'Inventory not found'));
    const res = await post({ ...valid, location: '' });
    expect(res.statusCode).toBe(400);
    expect(Sales.create).not.toHaveBeenCalled();
    // jest.clearAllMocks() does not drop queued once-values; consume the unused
    // rejection so it cannot leak into the next test.
    await expect(Sales.create(valid)).rejects.toMatchObject({ code: 'INVENTORY_NOT_FOUND' });
  });

  test('S-R10 an unexpected error returns 500', async () => {
    Sales.create.mockRejectedValueOnce(new Error('boom'));
    const res = await post(valid);
    expect(res.statusCode).toBe(500);
  });
});

describe('PATCH /sales/:id/status validation and errors', () => {
  const token = '1';
  const patch = (id, body) => request(app).patch(`/sales/${id}/status`).set('x-auth-token', token).send(body);
  const seedSale = async () => (await request(app).post('/sales').set('x-auth-token', token)
    .send({ product_id: 1, location: 'retail', quantity: 1, price: 10, gst: 1, status: 'order_created' })).body;

  test.each([[{}], [{ status: 'bogus' }], [{ status: '' }], [{ status: 'SOLD' }]])(
    'P-R1 400 for body %j on an existing id', async body => {
      const created = await seedSale();
      const res = await patch(created.id, body);
      expect(res.statusCode).toBe(400);
      expect(typeof res.body.error).toBe('string');
      expect(res.body.error).not.toBe('');
      expect(Sales.updateStatus).not.toHaveBeenCalled();
    });

  test.each([[{}], [{ status: 'bogus' }]])('P-R2 400 (not 404) for body %j on a missing id', async body => {
    const res = await patch(9999, body);
    expect(res.statusCode).toBe(400);
    expect(Sales.updateStatus).not.toHaveBeenCalled();
  });

  test('P-R3 an unknown id with a valid status returns 404 with an empty body', async () => {
    const res = await patch(9999, { status: 'sold' });
    expect(res.statusCode).toBe(404);
    expect(res.text).toBe('');
  });

  test('P-R4 insufficient stock returns 409', async () => {
    const created = await seedSale();
    Sales.updateStatus.mockRejectedValueOnce(coded('INSUFFICIENT_STOCK', 'Insufficient stock'));
    const res = await patch(created.id, { status: 'sold' });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'Insufficient stock' });
  });

  test('P-R5 a valid change returns 200 with the sale', async () => {
    const created = await seedSale();
    const res = await patch(created.id, { status: 'sold' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ id: created.id, status: 'sold' });
  });
});

describe('DELETE /sales/:id', () => {
  const token = '1';

  test('D-R1 an unknown id returns 404 with an empty body', async () => {
    const res = await request(app).delete('/sales/9999').set('x-auth-token', token);
    expect(res.statusCode).toBe(404);
    expect(res.text).toBe('');
  });

  test('D-R2 an existing id returns 200 with the sale', async () => {
    const created = (await request(app).post('/sales').set('x-auth-token', token)
      .send({ product_id: 1, location: 'retail', quantity: 1, price: 10, gst: 1 })).body;
    const res = await request(app).delete(`/sales/${created.id}`).set('x-auth-token', token);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ id: created.id });
  });
});
