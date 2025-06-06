const originalRequest = require('supertest'); // Renamed to avoid conflict in atomicity tests
const originalApp = require('../index'); // Renamed
const globalDb = require('../models/db'); // Direct access to the database pool for general setup/teardown
const logger = require('../utils/logger'); // Import logger

// Helper function to create a user
async function createUser(name, role = 'user', dbInstance, password = 'password123') {
  const currentDb = dbInstance || globalDb;
  const { rows } = await currentDb.query(
    "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO UPDATE SET name = $1, role = $4 RETURNING *",
    [name, `${name}@example.com`, password, role]
  );
   if (rows.length > 0) return rows[0];
  const res = await currentDb.query("SELECT * FROM users WHERE email = $1", [`${name}@example.com`]);
  return res.rows[0];
}

// Helper function to create a product
async function createProduct(name, categoryId = 1, dbInstance, priceRetail = 10, priceWholesale = 5) {
    const currentDb = dbInstance || globalDb;
    // Ensure category exists
    await currentDb.query("INSERT INTO categories (id, name, gst_percent) VALUES ($1, 'Audit Test Category', 10) ON CONFLICT (id) DO NOTHING", [categoryId]);
    const { rows } = await currentDb.query(
        "INSERT INTO products (name, category_id, price_retail, price_wholesale) VALUES ($1, $2, $3, $4) RETURNING *",
        [name, categoryId, priceRetail, priceWholesale]
    );
    return rows[0];
}

// Helper function to create a sale
async function createSale(productId, userId, dbInstance, quantity = 1, price = 10) {
    const currentDb = dbInstance || globalDb;
    const { rows } = await currentDb.query(
        "INSERT INTO sales (product_id, user_id, quantity, price, gst_percent, status) VALUES ($1, $2, $3, $4, 10, 'created') RETURNING *",
        [productId, userId, quantity, price]
    );


    return rows[0];
}

describe('Audit Logging Integration Tests', () => {
  let testUser, userToken;
  let initialProduct;

  beforeAll(async () => {
    try {
      testUser = await createUser('Audit Logger', 'user', globalDb);
      if (!testUser) throw new Error("Failed to create 'Audit Logger' user.");
      userToken = testUser.id.toString();

      initialProduct = await createProduct('Audit Product Base', 1, globalDb);
      if (!initialProduct) throw new Error("Failed to create 'Audit Product Base'.");

    } catch (error) {
      logger.error("Error during beforeAll audit test setup:", error); // Use logger
      throw error; // Critical setup failure
    }
  });

  beforeEach(async () => {
    await globalDb.query('DELETE FROM audit_log');
  });

  afterAll(async () => {
    if (initialProduct) await globalDb.query('DELETE FROM products WHERE id = $1', [initialProduct.id]);
    if (testUser) await globalDb.query('DELETE FROM users WHERE id = $1', [testUser.id]);
    await globalDb.query("DELETE FROM categories WHERE name = 'Audit Test Category'");
    await globalDb.query('DELETE FROM audit_log');
    // Note: globalDb.end() is deferred to after the atomicity tests if they also use it,
    // or atomicity tests should manage their own db connection.
    // For now, assuming atomicity test suite will handle closing its own connections,
    // and this one will be closed by the atomicity suite's afterAll if it's the last one.
    // This is a bit risky. Ideally, a global setup/teardown script for Jest handles db connections.
  });

  test('POST /products should create an audit log entry', async () => {
    const productData = { name: 'Audit Test Product Create', price_retail: 12.99, price_wholesale: 6.99, category_id: 1 };
    const res = await originalRequest(originalApp)
      .post('/products')
      .set('x-auth-token', userToken)
      .send(productData);

    expect(res.statusCode).toBe(201);
    const newProductId = res.body.id;

    const auditRes = await globalDb.query("SELECT * FROM audit_log WHERE action = 'CREATE_PRODUCT'");
    expect(auditRes.rows.length).toBe(1);
    const logEntry = auditRes.rows[0];
    expect(logEntry.user_id).toBe(testUser.id);
    expect(logEntry.action).toBe('CREATE_PRODUCT');
    expect(logEntry.entity).toBe('PRODUCT');
    expect(logEntry.entity_id).toBe(newProductId);

    if (newProductId) await globalDb.query('DELETE FROM products WHERE id = $1', [newProductId]);
  });

  test('PUT /products/:id should create an audit log entry', async () => {
    const updateData = { name: 'Audit Product Updated Name' };
    const res = await originalRequest(originalApp)
      .put(`/products/${initialProduct.id}`)
      .set('x-auth-token', userToken)
      .send(updateData);

    expect(res.statusCode).toBe(200);

    const auditRes = await globalDb.query("SELECT * FROM audit_log WHERE action = 'UPDATE_PRODUCT'");
    expect(auditRes.rows.length).toBe(1);
    const logEntry = auditRes.rows[0];
    expect(logEntry.user_id).toBe(testUser.id);
    expect(logEntry.action).toBe('UPDATE_PRODUCT');
    expect(logEntry.entity).toBe('PRODUCT');
    expect(logEntry.entity_id).toBe(initialProduct.id);
  });

  test('DELETE /products/:id should create an audit log entry', async () => {
    const productToDelete = await createProduct('Audit Product ToDelete', 1, globalDb);

    const res = await originalRequest(originalApp)
      .delete(`/products/${productToDelete.id}`)
      .set('x-auth-token', userToken);

    expect(res.statusCode).toBe(204);

    const auditRes = await globalDb.query("SELECT * FROM audit_log WHERE action = 'DELETE_PRODUCT'");
    expect(auditRes.rows.length).toBe(1);
    const logEntry = auditRes.rows[0];
    expect(logEntry.user_id).toBe(testUser.id);
    expect(logEntry.action).toBe('DELETE_PRODUCT');
    expect(logEntry.entity).toBe('PRODUCT');
    expect(logEntry.entity_id).toBe(productToDelete.id);
  });

  test('PATCH /sales/:id/status should create an audit log entry', async () => {
    const sale = await createSale(initialProduct.id, testUser.id, globalDb);
    const newStatus = 'shipped';

    const res = await originalRequest(originalApp)
      .patch(`/sales/${sale.id}/status`)
      .set('x-auth-token', userToken)
      .send({ status: newStatus });

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe(newStatus);

    const auditRes = await globalDb.query("SELECT * FROM audit_log WHERE entity = 'SALE' AND entity_id = $1", [sale.id]);
    expect(auditRes.rows.length).toBe(1);
    const logEntry = auditRes.rows[0];
    expect(logEntry.user_id).toBe(testUser.id);
    expect(logEntry.action).toBe(`UPDATE_SALE_STATUS_TO_${newStatus.toUpperCase()}`);
    expect(logEntry.entity).toBe('SALE');
    expect(logEntry.entity_id).toBe(sale.id);

    await globalDb.query('DELETE FROM sales WHERE id = $1', [sale.id]);
  });
});

describe('Audit Log Atomicity Tests', () => {
  let atomicityTestUser, atomicityUserToken;
  let atomicityDb;

  beforeAll(async () => {
    atomicityDb = require('../models/db');
    atomicityTestUser = await createUser('Atomicity User', 'user', atomicityDb);
    if (!atomicityTestUser) throw new Error("Failed to create user for atomicity tests.");
    atomicityUserToken = atomicityTestUser.id.toString();
  });

  afterAll(async () => {
    if (atomicityTestUser) await atomicityDb.query('DELETE FROM users WHERE id = $1', [atomicityTestUser.id]);
    await atomicityDb.query("DELETE FROM categories WHERE name = 'Test Cat Atomicity'");
    await atomicityDb.query("DELETE FROM products WHERE name = 'Atomic Test Product'"); // Ensure product cleanup
    await atomicityDb.end();
  });

  beforeEach(async () => {
    await atomicityDb.query('DELETE FROM audit_log');
    await atomicityDb.query("DELETE FROM products WHERE name = 'Atomic Test Product'");
  });

  test('should rollback product creation if audit logging fails', async () => {
    jest.doMock('../utils/auditLog', () => ({
      logAction: jest.fn().mockImplementation(async () => {
        throw new Error('Simulated audit log failure');
      }),
    }));

    jest.resetModules();
    const app = require('../index');
    const request = require('supertest');

    await atomicityDb.query("INSERT INTO categories (id, name, gst_percent) VALUES (1, 'Test Cat Atomicity', 10) ON CONFLICT (id) DO NOTHING");

    const productData = { name: 'Atomic Test Product', price_retail: 10, category_id: 1 };

    const response = await request(app)
      .post('/products')
      .set('x-auth-token', atomicityUserToken)
      .send(productData);

    expect(response.status).toBe(500);

    const productRes = await atomicityDb.query("SELECT * FROM products WHERE name = 'Atomic Test Product'");
    expect(productRes.rows.length).toBe(0);

    const auditRes = await atomicityDb.query("SELECT * FROM audit_log WHERE user_id = $1 AND action = 'CREATE_PRODUCT'", [atomicityTestUser.id]);
    expect(auditRes.rows.length).toBe(0);

    jest.unmock('../utils/auditLog');
    jest.resetModules();
  });
});
