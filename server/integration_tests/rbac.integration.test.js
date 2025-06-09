const request = require('supertest');
const app = require('../index'); // Assuming server/index.js is the entry point
const db = require('../models/db'); // Direct access to the database pool

// Helper function to create a user with a specific role
async function createUser(name, role = 'user', password = 'password123') {
  // In a real app, you'd hash the password. For tests, plain text is simpler.
  // Adjust based on how users are actually created (e.g., if password hashing is done in model)
  // For now, assuming Users.create handles it or it's not strictly needed for role testing if token is just ID
  const { rows } = await db.query(
    "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING *",
    [name, `${name}@example.com`, password, role]
  );
  return rows[0];
}

describe('RBAC Integration Tests', () => {
  let adminUser, regularUser, superAdminUser;
  let adminToken, userToken, superAdminToken;

  beforeAll(async () => {
    // Setup: Ensure the test database is clean and migrated
    // This should ideally be handled by a script before running tests,
    // but we can try to ensure users are created here.
    // For these tests, the token will be the user's ID.
    try {
      await db.query('DELETE FROM audit_log');
      await db.query('DELETE FROM users'); // Clear users to avoid conflicts

      regularUser = await createUser('Test User', 'user');
      adminUser = await createUser('Admin User', 'admin');
      superAdminUser = await createUser('SuperAdmin User', 'super_admin');

      userToken = regularUser.id.toString();
      adminToken = adminUser.id.toString();
      superAdminToken = superAdminUser.id.toString();

    } catch (error) {
      console.error("Error during beforeAll user creation:", error);
      // If setup fails, tests might not run correctly.
      // Consider throwing to stop tests if critical.
    }
  });

  afterAll(async () => {
    // Clean up users or the entire test database
    // await db.query('DELETE FROM users');
    await db.end(); // Close the database connection pool
  });

  describe('User Management Endpoints (/users)', () => {
    test('GET /users without token should return 401', async () => {
      const res = await request(app).get('/users');
      expect(res.statusCode).toBe(401);
    });

    test('GET /users with "user" role token should return 403', async () => {
      const res = await request(app).get('/users').set('x-auth-token', userToken);
      expect(res.statusCode).toBe(403);
    });

    test('GET /users with "admin" role token should return 200', async () => {
      const res = await request(app).get('/users').set('x-auth-token', adminToken);
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    test('GET /users with "super_admin" role token should return 200', async () => {
      const res = await request(app).get('/users').set('x-auth-token', superAdminToken);
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    test('POST /users without token should return 401', async () => {
      const res = await request(app).post('/users').send({ name: 'New User Fail', email: 'nu-fail@example.com', role: 'user' });
      expect(res.statusCode).toBe(401);
    });

    test('POST /users with "user" role token should return 403', async () => {
      const res = await request(app).post('/users').set('x-auth-token', userToken).send({ name: 'New User Fail', email: 'nu-fail@example.com', role: 'user' });
      expect(res.statusCode).toBe(403);
    });

    test('POST /users with "admin" role token should return 201', async () => {
      const res = await request(app)
        .post('/users')
        .set('x-auth-token', adminToken)
        .send({ name: 'New User By Admin', email: 'nuba@example.com', role: 'user' });
      expect(res.statusCode).toBe(201);
      expect(res.body.name).toBe('New User By Admin');
      // Cleanup this user or ensure DB is reset between tests/suites
      if(res.body.id) await db.query("DELETE FROM users WHERE id = $1", [res.body.id]);

    });
     test('POST /users with "super_admin" role token should return 201', async () => {
      const res = await request(app)
        .post('/users')
        .set('x-auth-token', superAdminToken)
        .send({ name: 'New User By SuperAdmin', email: 'nubsa@example.com', role: 'admin' });
      expect(res.statusCode).toBe(201);
      expect(res.body.name).toBe('New User By SuperAdmin');
      if(res.body.id) await db.query("DELETE FROM users WHERE id = $1", [res.body.id]);
    });
  });

  describe('General Endpoints (e.g., /products)', () => {
    test('GET /products without token should return 401', async () => {
      const res = await request(app).get('/products');
      expect(res.statusCode).toBe(401);
    });

    test('GET /products with "user" role token should return 200', async () => {
      // This test assumes there might be products or an empty list is acceptable
      const res = await request(app).get('/products').set('x-auth-token', userToken);
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    test('POST /products with "user" role token should return 201', async () => {
      const productData = { name: 'Test Product', price_retail: 10.99, price_wholesale: 5.99, category_id: 1 }; // Assuming category_id 1 exists or is not strictly enforced for this test
       // Check if category 1 exists, if not create it for the test
      let cat = await db.query("SELECT * FROM categories WHERE id = 1");
      if (cat.rows.length === 0) {
        await db.query("INSERT INTO categories (id, name, gst_percent) VALUES (1, 'Test Category', 10) ON CONFLICT (id) DO NOTHING");
      }

      const res = await request(app)
        .post('/products')
        .set('x-auth-token', userToken)
        .send(productData);
      expect(res.statusCode).toBe(201);
      expect(res.body.name).toBe('Test Product');
      // Cleanup this product
      if(res.body.id) await db.query("DELETE FROM products WHERE id = $1", [res.body.id]);
    });
  });
});
