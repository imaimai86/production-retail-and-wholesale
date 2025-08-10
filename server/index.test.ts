import request from 'supertest';
import app from './index'; // Assuming app is exported as default from index.ts
import { Product, ProductCreationData, ProductUpdateData } from './models/products';
import { Batch, BatchCreationData } from './models/batches';
import { InventoryItem } from './models/inventory';
import { Category, CategoryCreationData } from './models/categories';
import { Sale, SaleCreationData, SaleStatus } from './models/sales';
import { User, UserCreationData } from './models/users';

process.env.ADMIN_TOKEN = 'secret';

interface MockModule<T, CD, UD = any> {
  __reset: () => void;
  getAll: (options?: { limit?: number; offset?: number }) => Promise<T[]>;
  getById?: (id: string | number) => Promise<T | undefined | null>;
  create: (data: CD) => Promise<T>;
  update?: (id: string | number, data: UD) => Promise<T | undefined | null>;
  remove?: (id: string | number) => Promise<void | T | null>;
  transfer?: (...args: any[]) => Promise<T>; // For inventory
  updateStatus?: (id: string | number, status: SaleStatus) => Promise<T | null>; // For sales
}


jest.mock('./models/products', (): MockModule<Product, ProductCreationData, ProductUpdateData> => {
  let data: Product[] = [];
  return {
    __reset: ()_reset: () => { data = []; },
    getAll: async ({ limit = 10, offset = 0 } = {}) => data.slice(offset, offset + limit),
    create: async (p: ProductCreationData) => { const item = { id: data.length + 1, ...p } as Product; data.push(item); return item; },
    getById: async (id: string | number) => data.find(d => d.id === parseInt(id as string)),
    update: async (id: string | number, p: ProductUpdateData) => {
      const i = data.findIndex(d => d.id === parseInt(id as string));
      if (i < 0) return null;
      data[i] = { ...data[i], ...p };
      return data[i];
    },
    remove: async (id: string | number) => { const i = data.findIndex(d => d.id === parseInt(id as string)); if (i >= 0) data.splice(i, 1); }
  };
});

jest.mock('./models/batches', (): MockModule<Batch, BatchCreationData> => {
  let data: Batch[] = [];
  return {
    __reset: ()_reset: () => { data = []; },
    getAll: async ({ limit = 10, offset = 0 } = {}) => data.slice(offset, offset + limit),
    create: async (b: BatchCreationData) => { const item = { id: data.length + 1, completed: false, ...b } as Batch; data.push(item); return item; }
  };
});

jest.mock('./models/inventory', (): MockModule<InventoryItem, any> => {
  let data: InventoryItem[] = [];
  return {
    __reset: ()_reset: () => { data = []; },
    transfer: async (product_id: number, from: string, to: string, qty: number) => {
      const fromItem = data.find(i => i.product_id === product_id && i.location === from);
      if (fromItem) fromItem.quantity -= qty;
      let toItem = data.find(i => i.product_id === product_id && i.location === to);
      if (!toItem) {
        toItem = { id: data.length + 1, product_id, location: to, quantity: 0 } as InventoryItem;
        data.push(toItem);
      }
      toItem.quantity += qty;
      return toItem;
    },
    getAll: async ({ limit = 10, offset = 0 } = {}) => data.slice(offset, offset + limit),
    // create is not used in tests for inventory, but needed for MockModule interface
    create: async (i: any) => { const item = {id: data.length + 1, ...i} as InventoryItem; data.push(item); return item;}
  };
});

jest.mock('./models/categories', (): MockModule<Category, CategoryCreationData> => {
  let data: Category[] = [];
  return {
    __reset: ()_reset: () => { data = []; },
    getAll: async ({ limit = 10, offset = 0 } = {}) => data.slice(offset, offset + limit),
    create: async (c: CategoryCreationData) => { const item = { id: data.length + 1, ...c } as Category; data.push(item); return item; }
  };
});

jest.mock('./models/sales', (): MockModule<Sale, SaleCreationData> => {
  let data: Sale[] = [];
  return {
    __reset: ()_reset: () => { data = []; },
    getAll: async ({ limit = 10, offset = 0 } = {}) => data.slice(offset, offset + limit),
    getById: async (id: string | number) => data.find(d => d.id === parseInt(id as string)),
    create: async (s: SaleCreationData) => { const item = { id: data.length + 1, status: 'sold' as SaleStatus, discount: 0, ...s } as Sale; data.push(item); return item; },
    updateStatus: async (id: string | number, status: SaleStatus) => {
      const sale = data.find(d => d.id === parseInt(id as string));
      if (!sale) return null;
      sale.status = status;
      return sale;
    },
    remove: async (id: string | number) => {
      const i = data.findIndex(d => d.id === parseInt(id as string));
      if (i >= 0) return data.splice(i, 1)[0];
      return null;
    }
  };
});

jest.mock('./models/users', (): MockModule<User, UserCreationData> => {
  let data: User[] = [];
  return {
    __reset: ()_reset: () => { data = []; },
    getAll: async ({ limit = 10, offset = 0 } = {}) => data.slice(offset, offset + limit),
    create: async (u: UserCreationData) => { const item = { id: data.length + 1, ...u } as User; data.push(item); return item; }
  };
});

// Import with type assertion for the mocked modules
const ProductsMock = require('./models/products') as MockModule<Product, ProductCreationData, ProductUpdateData>;
const BatchesMock = require('./models/batches') as MockModule<Batch, BatchCreationData>;
const InventoryMock = require('./models/inventory') as MockModule<InventoryItem, any>; // 'any' for creation type as it's not standard
const SalesMock = require('./models/sales') as MockModule<Sale, SaleCreationData>;
const UsersMock = require('./models/users') as MockModule<User, UserCreationData>;
const CategoriesMock = require('./models/categories') as MockModule<Category, CategoryCreationData>;


beforeEach(() => {
  ProductsMock.__reset();
  BatchesMock.__reset();
  InventoryMock.__reset();
  SalesMock.__reset();
  UsersMock.__reset();
  if (CategoriesMock.__reset) CategoriesMock.__reset();
});

describe('GET /', () => {
  it('should respond with status ok', async () => {
    const res: request.Response = await request(app).get('/');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('API endpoints using responses', () => {
  const token: string = '1'; // Assuming token is a simple string for test purposes
  const adminToken: string | undefined = process.env.ADMIN_TOKEN;

  test('create and list users', async () => {
    const userCreateData: UserCreationData = { name: 'Bob' };
    const createRes: request.Response = await request(app).post('/users').set('x-auth-token', adminToken).send(userCreateData);
    expect(createRes.statusCode).toBe(201);

    const listRes: request.Response = await request(app).get('/users').set('x-auth-token', adminToken);
    expect(listRes.statusCode).toBe(200);
    expect(listRes.body).toContainEqual(createRes.body);
  });

  test('create and list products', async () => {
    const productCreateData: ProductCreationData = { name: 'p', price_retail: 1, price_wholesale: 1, category_id: 1 };
    await request(app).post('/products').set('x-auth-token', token).send(productCreateData);
    const res: request.Response = await request(app).get('/products').set('x-auth-token', token);
    expect(res.body.length).toBe(1);
  });

  test('create batch and verify list', async () => {
    const batchCreateData: BatchCreationData = { product_id: 1, quantity: 10 };
    await request(app).post('/batches').set('x-auth-token', token).send(batchCreateData);
    const res: request.Response = await request(app).get('/batches').set('x-auth-token', token);
    expect(res.body.length).toBe(1);
  });

  test('transfer inventory and list', async () => {
    const inventoryTransferData = { product_id: 1, from: 'A', to: 'B', quantity: 5 };
    await request(app).post('/inventory/transfer').set('x-auth-token', token).send(inventoryTransferData);
    const res: request.Response = await request(app).get('/inventory').set('x-auth-token', token);
    expect(res.body.length).toBe(1);
    expect(res.body[0]).toMatchObject({ product_id: 1, location: 'B', quantity: 5 });
  });

  test('create sale and list', async () => {
    const saleCreateData: SaleCreationData = { product_id: 1, quantity: 1, price: 10, gst: 1, user_id: parseInt(token) };
    await request(app).post('/sales').set('x-auth-token', token).send(saleCreateData);
    const res: request.Response = await request(app).get('/sales').set('x-auth-token', token);
    expect(res.body.length).toBe(1);
  });

  test('update sale status and invoice', async () => {
    const saleCreateData: SaleCreationData = { product_id: 1, quantity: 1, price: 10, gst: 1, status: 'order_created', user_id: parseInt(token) };
    const createRes: request.Response = await request(app).post('/sales').set('x-auth-token', token).send(saleCreateData);
    expect(createRes.statusCode).toBe(201);
    const createdSale: Sale = createRes.body;

    const updatedRes: request.Response = await request(app).patch(`/sales/${createdSale.id}/status`).set('x-auth-token', token).send({ status: 'sold' as SaleStatus });
    expect(updatedRes.body.status).toBe('sold');

    const invoiceRes: request.Response = await request(app).get(`/sales/${createdSale.id}/invoice`).set('x-auth-token', token);
    expect(invoiceRes.statusCode).toBe(200);
  });

  test('create and list categories', async () => {
    const categoryCreateData: CategoryCreationData = { name: 'c', gst: 10 };
    await request(app).post('/categories').set('x-auth-token', token).send(categoryCreateData);
    const res: request.Response = await request(app).get('/categories').set('x-auth-token', token);
    expect(res.body.length).toBe(1);
  });
});
