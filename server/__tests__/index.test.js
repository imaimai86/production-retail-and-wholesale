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
    create: jest.fn(async (u) => { const item = { id: data.length + 1, ...u }; data.push(item); return item; })
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

// Every test starts from empty models. A test that checks several cases calls it between them.
function reset() {
  jest.clearAllMocks();
  Products.__reset();
  Batches.__reset();
  Inventory.__reset();
  Sales.__reset();
  Users.__reset();
  Categories.__reset && Categories.__reset();
}
beforeEach(reset);

// A 400 with a non-empty error text, for the case called `name`.
const expectBadRequest = (name, res) => {
  expect([name, res.statusCode]).toEqual([name, 400]);
  expect(typeof res.body.error).toBe('string');
  expect(res.body.error).not.toBe('');
};

describe('API endpoints using responses', () => {
  const token = '1';
  const admin = process.env.ADMIN_TOKEN;

  test('GET / responds ok; users, products, batches and categories are created and listed', async () => {
    const root = await request(app).get('/');
    expect(root.statusCode).toBe(200);
    expect(root.body).toEqual({ status: 'ok' });

    const create = await request(app).post('/users').set('x-auth-token', admin).send({ name: 'Bob' });
    expect(create.statusCode).toBe(201);
    const list = await request(app).get('/users').set('x-auth-token', admin);
    expect(list.statusCode).toBe(200);
    expect(list.body).toContainEqual(create.body);

    await request(app).post('/products').set('x-auth-token', token).send({ name: 'p', price_retail: 1, price_wholesale: 1 });
    expect((await request(app).get('/products').set('x-auth-token', token)).body.length).toBe(1);

    await request(app).post('/batches').set('x-auth-token', token).send({ product_id: 1, quantity: 10 });
    expect((await request(app).get('/batches').set('x-auth-token', token)).body.length).toBe(1);

    await request(app).post('/categories').set('x-auth-token', token).send({ name: 'c', gst: 10 });
    expect((await request(app).get('/categories').set('x-auth-token', token)).body.length).toBe(1);
  });

  test('inventory is transferred and listed; a sale is created, listed, moved to sold and invoiced', async () => {
    Inventory.__seed([{ id: 1, product_id: 1, location: 'A', quantity: 8 }]);
    await request(app).post('/inventory/transfer').set('x-auth-token', token).send({ product_id: 1, from: 'A', to: 'B', quantity: 5 });
    const inv = await request(app).get('/inventory').set('x-auth-token', token);
    expect(inv.body.length).toBe(2);
    expect(inv.body[0]).toMatchObject({ product_id: 1, location: 'A', quantity: 3 });
    expect(inv.body[1]).toMatchObject({ product_id: 1, location: 'B', quantity: 5 });

    const create = await request(app).post('/sales').set('x-auth-token', token).send({ product_id: 1, location: 'retail', quantity: 1, price: 10, gst: 1, status: 'order_created' });
    expect(create.statusCode).toBe(201);
    expect((await request(app).get('/sales').set('x-auth-token', token)).body.length).toBe(1);
    const updated = await request(app).patch(`/sales/${create.body.id}/status`).set('x-auth-token', token).send({ status: 'sold' });
    expect(updated.body.status).toBe('sold');
    const invoice = await request(app).get(`/sales/${create.body.id}/invoice`).set('x-auth-token', token);
    expect(invoice.statusCode).toBe(200);
  });
});

describe('POST /users validation', () => {
  const admin = process.env.ADMIN_TOKEN;
  const json = (token, raw) => {
    const r = request(app).post('/users').set('Content-Type', 'application/json');
    return (token ? r.set('x-auth-token', token) : r).send(raw);
  };
  const post = body => request(app).post('/users').set('x-auth-token', admin).send(body);

  test('U-1..4 a valid name returns 201 with {id, name}: trimmed, extra fields dropped, duplicates allowed', async () => {
    let res = await post({ name: 'Asha' });
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ id: expect.any(Number), name: 'Asha' });
    expect(Users.create).toHaveBeenCalledTimes(1);

    // U-4 duplicate names are allowed
    expect((await post({ name: 'Asha' })).statusCode).toBe(201);

    // U-2 the name is trimmed before the insert and in the response
    reset();
    res = await post({ name: '  Asha  ' });
    expect(res.statusCode).toBe(201);
    expect(res.body.name).toBe('Asha');
    expect(Users.create).toHaveBeenCalledWith({ name: 'Asha' });

    // U-3 extra fields are ignored, not echoed and not passed to the model
    reset();
    res = await post({ name: 'Asha', username: 'a', password: 'p', role: 'admin' });
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ id: expect.any(Number), name: 'Asha' });
    expect(Users.create).toHaveBeenCalledWith({ name: 'Asha' });
  });

  test('U-5 an invalid body returns 400 and inserts nothing', async () => {
    const required = { error: 'name is required' };
    const notString = { error: 'name must be a string' };
    const cases = [
      ['{}', () => post({}), required],
      ['missing name', () => post({ username: 'a' }), required],
      ['null name', () => post({ name: null }), required],
      ['empty name', () => post({ name: '' }), required],
      ['whitespace name', () => post({ name: '   ' }), required],
      ['no body', () => request(app).post('/users').set('x-auth-token', admin), required],
      ['empty body', () => json(admin, ''), required],
      ['array body', () => json(admin, '[]'), required],
      ['string body', () => json(admin, '"text"'), required],
      ['null body', () => json(admin, 'null'), required],
      ['number name', () => post({ name: 123 }), notString],
      ['object name', () => post({ name: {} }), notString],
      ['array name', () => post({ name: [] }), notString],
      ['boolean name', () => post({ name: true }), notString],
      ['malformed JSON', () => json(admin, '{bad'), { error: 'Bad Request' }]
    ];
    for (const [name, send, expected] of cases) {
      const res = await send();
      expect([name, res.statusCode, res.body]).toEqual([name, 400, expected]);
    }
    expect(Users.create).not.toHaveBeenCalled();
  });

  test('U-6..8 no token is 401 and a non-admin token 403, even with an invalid body; a database failure is 500', async () => {
    let res = await request(app).post('/users').send({});
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });

    res = await request(app).post('/users').set('x-auth-token', '1').send({});
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
    expect(Users.create).not.toHaveBeenCalled();

    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    Users.create.mockRejectedValueOnce(new Error('boom'));
    res = await post({ name: 'Asha' });
    spy.mockRestore();
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});

describe('POST /inventory/transfer validation and errors', () => {
  const token = '1';
  const valid = { product_id: 1, from: 'A', to: 'B', quantity: 5 };
  const post = body => request(app).post('/inventory/transfer').set('x-auth-token', token).send(body);

  test('T-R1 T-R8 a valid body calls the model and returns 200; locations differing only by case are different', async () => {
    Inventory.__seed([{ id: 1, product_id: 1, location: 'A', quantity: 5 }]);
    let res = await post(valid);
    expect(res.statusCode).toBe(200);
    expect(Inventory.transfer).toHaveBeenCalledWith(1, 'A', 'B', 5);

    reset();
    Inventory.__seed([{ id: 1, product_id: 1, location: 'Retail', quantity: 5 }]);
    res = await post({ ...valid, from: 'Retail', to: 'retail' });
    expect(res.statusCode).toBe(200);
    expect(Inventory.transfer).toHaveBeenCalledWith(1, 'Retail', 'retail', 5);
  });

  test('T-R2..6 an invalid body returns 400 and the model is not called', async () => {
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
    for (const [name, body] of Object.entries(invalid)) expectBadRequest(name, await post(body));
    expect(Inventory.transfer).not.toHaveBeenCalled();
  });

  test('T-R7 T-R9 insufficient stock returns 409, an unexpected error 500', async () => {
    Inventory.transfer.mockRejectedValueOnce(coded('INSUFFICIENT_STOCK', 'Insufficient stock'));
    let res = await post(valid);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'Insufficient stock' });

    // T-R7b a short source, through the mock
    Inventory.__seed([{ id: 1, product_id: 1, location: 'A', quantity: 4 }]);
    expect((await post(valid)).statusCode).toBe(409);

    Inventory.transfer.mockRejectedValueOnce(new Error('boom'));
    res = await post(valid);
    expect(res.statusCode).toBe(500);
  });
});

describe('POST /sales validation and errors', () => {
  const token = '1';
  const valid = { product_id: 1, location: 'retail', quantity: 2, price: 10, gst: 1 };
  const post = body => request(app).post('/sales').set('x-auth-token', token).send(body);

  test('S-R1 S-R2 a valid body returns 201, with location passed through untrimmed and any allowed status', async () => {
    const res = await post({ ...valid, location: ' Retail ', status: 'sold' });
    expect(res.statusCode).toBe(201);
    expect(Sales.create).toHaveBeenCalledWith(expect.objectContaining({ location: ' Retail ', user_id: token }));

    for (const status of [undefined, 'order_created', 'sold']) {
      const body = status === undefined ? valid : { ...valid, status };
      expect([status, (await post(body)).statusCode]).toEqual([status, 201]);
    }
  });

  test('S-R3..6 an invalid body returns 400 and the model is not called', async () => {
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
    for (const [name, body] of Object.entries(invalid)) expectBadRequest(name, await post(body));
    expect(Sales.create).not.toHaveBeenCalled();
  });

  test('S-R7..10 a missing inventory row is 404, insufficient stock 409, an unexpected error 500; validation wins over a would-be 404', async () => {
    Sales.create.mockRejectedValueOnce(coded('INVENTORY_NOT_FOUND', 'Inventory not found'));
    let res = await post(valid);
    expect(res.statusCode).toBe(404);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error).not.toBe('');

    Sales.create.mockRejectedValueOnce(coded('INSUFFICIENT_STOCK', 'Insufficient stock'));
    res = await post(valid);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'Insufficient stock' });

    Sales.create.mockRejectedValueOnce(new Error('boom'));
    res = await post(valid);
    expect(res.statusCode).toBe(500);

    // S-R9
    reset();
    Sales.create.mockRejectedValueOnce(coded('INVENTORY_NOT_FOUND', 'Inventory not found'));
    res = await post({ ...valid, location: '' });
    expect(res.statusCode).toBe(400);
    expect(Sales.create).not.toHaveBeenCalled();
    // jest.clearAllMocks() does not drop queued once-values; consume the unused
    // rejection so it cannot leak into the next test.
    await expect(Sales.create(valid)).rejects.toMatchObject({ code: 'INVENTORY_NOT_FOUND' });
  });
});

describe('PATCH /sales/:id/status and DELETE /sales/:id', () => {
  const token = '1';
  const patch = (id, body) => request(app).patch(`/sales/${id}/status`).set('x-auth-token', token).send(body);
  const seedSale = async () => (await request(app).post('/sales').set('x-auth-token', token)
    .send({ product_id: 1, location: 'retail', quantity: 1, price: 10, gst: 1, status: 'order_created' })).body;

  test('P-R1 P-R2 an invalid status returns 400, on an existing id and (not 404) on a missing one', async () => {
    const created = await seedSale();
    for (const body of [{}, { status: 'bogus' }, { status: '' }, { status: 'SOLD' }]) {
      expectBadRequest(JSON.stringify(body), await patch(created.id, body));
    }
    for (const body of [{}, { status: 'bogus' }]) {
      expect([body, (await patch(9999, body)).statusCode]).toEqual([body, 400]);
    }
    expect(Sales.updateStatus).not.toHaveBeenCalled();
  });

  test('P-R3..5 an unknown id returns 404 with an empty body, insufficient stock 409, a valid change 200 with the sale', async () => {
    let res = await patch(9999, { status: 'sold' });
    expect(res.statusCode).toBe(404);
    expect(res.text).toBe('');

    const created = await seedSale();
    Sales.updateStatus.mockRejectedValueOnce(coded('INSUFFICIENT_STOCK', 'Insufficient stock'));
    res = await patch(created.id, { status: 'sold' });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'Insufficient stock' });

    res = await patch(created.id, { status: 'sold' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ id: created.id, status: 'sold' });
  });

  test('D-R1 D-R2 delete returns 404 with an empty body for an unknown id, 200 with the sale for an existing one', async () => {
    let res = await request(app).delete('/sales/9999').set('x-auth-token', token);
    expect(res.statusCode).toBe(404);
    expect(res.text).toBe('');

    const created = (await request(app).post('/sales').set('x-auth-token', token)
      .send({ product_id: 1, location: 'retail', quantity: 1, price: 10, gst: 1 })).body;
    res = await request(app).delete(`/sales/${created.id}`).set('x-auth-token', token);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ id: created.id });
  });
});

describe('global error handler', () => {
  const token = '1';
  let errorSpy;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  const getProducts = async err => {
    const spy = jest.spyOn(Products, 'getAll').mockRejectedValueOnce(err);
    const res = await request(app).get('/products').set('x-auth-token', token);
    spy.mockRestore();
    return res;
  };

  test('E-R1..4 a model error is logged and returns generic JSON: 500, or Not Found for status 404, never the detail', async () => {
    const err = new Error('secret db detail');
    let res = await getProducts(err);
    expect(res.statusCode).toBe(500);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(res.text).not.toContain('secret db detail');
    expect(res.text).not.toMatch(/<html|<pre|\.js/i);
    // E-R2 logged server-side
    expect(errorSpy).toHaveBeenCalledWith(err);

    // E-R3 driver error code and SQL detail never reach the client
    res = await getProducts(Object.assign(new Error('insert into products failed'), { code: '23505', detail: 'Key (id)=(1) exists' }));
    expect(res.statusCode).toBe(500);
    expect(res.text).not.toContain('23505');
    expect(res.text).not.toContain('insert into');
    expect(res.text).not.toContain('Key (id)');

    // E-R4
    res = await getProducts(Object.assign(new Error('hidden'), { status: 404 }));
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Not Found' });
    expect(res.text).not.toContain('hidden');
  });

  test('E-R5..9 malformed JSON returns 400 Bad Request without a stack; 401 and 409 are unchanged; the handler is the last layer', async () => {
    let res = await request(app).post('/products')
      .set('x-auth-token', token)
      .set('Content-Type', 'application/json')
      .send('{"name": ');
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ error: 'Bad Request' });
    expect(res.text).not.toMatch(/SyntaxError|stack|node_modules|\.js/);

    // E-R6 also without an auth header
    res = await request(app).post('/products')
      .set('Content-Type', 'application/json')
      .send('{bad json');
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Bad Request' });

    // E-R7
    expect((await request(app).get('/products')).statusCode).toBe(401);

    // E-R8
    res = await request(app).post('/inventory/transfer').set('x-auth-token', token)
      .send({ product_id: 1, from: 'A', to: 'B', quantity: 5 });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'Insufficient stock' });

    // E-R9
    const router = app._router || app.router;
    const last = router.stack[router.stack.length - 1];
    expect(last.handle.length).toBe(4);
  });
});

describe('logging', () => {
  const loggerModule = require('../logger');
  const token = '1';
  const lines = [];
  const sink = { write: (s) => { lines.push(s); } };
  const entries = () => lines.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const settle = () => new Promise(setImmediate);
  let savedLogger;

  beforeEach(() => {
    lines.length = 0;
    savedLogger = loggerModule.logger;
    loggerModule.logger = loggerModule.createLogger(sink);
  });

  afterEach(() => {
    loggerModule.logger = savedLogger;
    jest.restoreAllMocks();
  });

  test('IX-L1 a thrown model error is logged with its message, stack and path but not returned', async () => {
    const originalGetAll = Products.getAll;
    Products.getAll = jest.fn().mockRejectedValueOnce(new Error('secret db detail'));
    let res;
    try {
      res = await request(app).get('/products').set('x-auth-token', token);
    } finally {
      Products.getAll = originalGetAll;
    }
    await settle();
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    const out = lines.join('');
    expect(out).toContain('secret db detail');
    expect(out).toContain('    at ');
    expect(out).toContain('/products');
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('secret db detail');
    expect(body).not.toContain('    at ');
    expect(body).not.toContain('/products');
  });

  test('IX-L2 a 409 insufficient-stock response produces exactly one WARNING entry', async () => {
    Inventory.transfer.mockRejectedValueOnce(coded('INSUFFICIENT_STOCK', 'Insufficient stock'));
    const res = await request(app).post('/inventory/transfer').set('x-auth-token', token)
      .send({ product_id: 1, from: 'A', to: 'B', quantity: 5 });
    await settle();
    expect(res.statusCode).toBe(409);
    const got = entries();
    expect(got).toHaveLength(1);
    expect(got[0].severity).toBe('WARNING');
  });

  test('IX-L3 malformed JSON gives 400 and two WARNING entries sharing the request id', async () => {
    const res = await request(app).post('/products')
      .set('x-auth-token', token)
      .set('Content-Type', 'application/json')
      .send('{bad');
    await settle();
    expect(res.statusCode).toBe(400);
    const got = entries();
    expect(got).toHaveLength(2);
    expect(got.every((e) => e.severity === 'WARNING')).toBe(true);
    const fromRequestLogger = got.filter((e) => e.httpRequest && e.httpRequest.status === 400);
    const fromErrorHandler = got.filter((e) => e.error);
    expect(fromRequestLogger).toHaveLength(1);
    expect(fromErrorHandler).toHaveLength(1);
    const label = 'logging.googleapis.com/labels';
    expect(fromRequestLogger[0][label].requestId).toBe(res.headers['x-request-id']);
    expect(fromErrorHandler[0][label].requestId).toBe(res.headers['x-request-id']);
  });

  test('IX-L4 every response has X-Request-Id and the bodies are unchanged', async () => {
    const root = await request(app).get('/');
    expect(root.body).toEqual({ status: 'ok' });
    const unauth = await request(app).get('/products');
    expect(unauth.statusCode).toBe(401);
    expect(unauth.body).toEqual({ error: 'Unauthorized' });
    const ok = await request(app).get('/products').set('x-auth-token', token);
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toEqual([]);
    Inventory.transfer.mockRejectedValueOnce(coded('INSUFFICIENT_STOCK', 'Insufficient stock'));
    const conflict = await request(app).post('/inventory/transfer').set('x-auth-token', token)
      .send({ product_id: 1, from: 'A', to: 'B', quantity: 5 });
    expect(conflict.body).toEqual({ error: 'Insufficient stock' });
    const bad = await request(app).post('/products').set('x-auth-token', token)
      .set('Content-Type', 'application/json').send('{bad');
    expect(bad.body).toEqual({ error: 'Bad Request' });
    for (const r of [root, unauth, ok, conflict, bad]) {
      expect(typeof r.headers['x-request-id']).toBe('string');
      expect(r.headers['x-request-id']).not.toBe('');
    }
    const supplied = await request(app).get('/').set('X-Request-Id', 'client-id-1');
    expect(supplied.headers['x-request-id']).toBe('client-id-1');
  });
});
