const Products = require('../products');
const db = require('../db'); // This will be the mock due to jest.mock below
const { logAction } = require('../../utils/auditLog');
const logger = require('../../utils/logger');

jest.mock('../db', () => ({
  getClient: jest.fn(),
  query: jest.fn(), // Mock global query for read-only methods if they don't use a client
}));

jest.mock('../../utils/auditLog', () => ({
  logAction: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

describe('Products Model', () => {
  let mockDbClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDbClient = {
      query: jest.fn(),
      release: jest.fn(),
    };
    db.getClient.mockReturnValue(mockDbClient); // For write methods
    // For read methods that might use global db.query if no client passed
    db.query.mockClear();
  });

  // --- Read-only methods (can remain as they are or be adapted slightly) ---
  describe('getAll', () => {
    test('should retrieve all products with default pagination', async () => {
      const mockProducts = [{ id: 1, name: 'Product 1' }];
      db.query.mockResolvedValue({ rows: mockProducts }); // getAll uses global db if no client

      const result = await Products.getAll({}); // Pass empty options object

      expect(db.query).toHaveBeenCalledWith(
        'SELECT * FROM products ORDER BY id LIMIT $1 OFFSET $2',
        [10, 0]
      );
      expect(result).toEqual(mockProducts);
    });
  });

  describe('getById', () => {
    test('should retrieve a product by its ID', async () => {
      const mockProduct = { id: 1, name: 'Product 1' };
      db.query.mockResolvedValue({ rows: [mockProduct] }); // getById uses global db if no client

      const result = await Products.getById(1);

      expect(db.query).toHaveBeenCalledWith('SELECT * FROM products WHERE id=$1', [1]);
      expect(result).toEqual(mockProduct);
    });
  });

  // --- Write methods ---
  describe('create(productData, performingUserId)', () => {
    const productData = { name: 'New Product', price_retail: 100, price_wholesale: 80, category_id: 1 };
    const performingUserId = 1;
    const createdProduct = { ...productData, id: 123 };

    test('should create a product, log action, and commit on success', async () => {
      mockDbClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [createdProduct] }) // INSERT
        .mockResolvedValueOnce(undefined); // COMMIT
      logAction.mockResolvedValue(undefined);

      const result = await Products.create(productData, performingUserId);

      expect(db.getClient).toHaveBeenCalledTimes(1);
      expect(mockDbClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockDbClient.query).toHaveBeenCalledWith(
        'INSERT INTO products(name, price_retail, price_wholesale, category_id) VALUES($1,$2,$3,$4) RETURNING *',
        [productData.name, productData.price_retail, productData.price_wholesale, productData.category_id]
      );
      expect(logAction).toHaveBeenCalledWith(mockDbClient, performingUserId, 'CREATE_PRODUCT', 'PRODUCT', createdProduct.id);
      expect(mockDbClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockDbClient.release).toHaveBeenCalledTimes(1);
      expect(result).toEqual(createdProduct);
      expect(logger.error).not.toHaveBeenCalled();
    });

    test('should rollback and log error if INSERT fails', async () => {
      const dbError = new Error('INSERT failed');
      mockDbClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockRejectedValueOnce(dbError); // INSERT fails

      await expect(Products.create(productData, performingUserId)).rejects.toThrow(dbError);

      expect(mockDbClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(logAction).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith('Failed to create product in model:', dbError);
      expect(mockDbClient.release).toHaveBeenCalledTimes(1);
    });

    test('should rollback and log error if logAction fails', async () => {
      const logActionError = new Error('logAction failed');
      mockDbClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [createdProduct] }); // INSERT success
      logAction.mockRejectedValue(logActionError);

      await expect(Products.create(productData, performingUserId)).rejects.toThrow(logActionError);

      expect(mockDbClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(logger.error).toHaveBeenCalledWith('Failed to create product in model:', logActionError);
      expect(mockDbClient.release).toHaveBeenCalledTimes(1);
    });

    test('should warn and commit if performingUserId is null', async () => {
      mockDbClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [createdProduct] }) // INSERT
        .mockResolvedValueOnce(undefined); // COMMIT

      const result = await Products.create(productData, null);
      expect(logAction).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(`CREATE_PRODUCT action for product ID ${createdProduct.id} performed without a performingUserId.`);
      expect(mockDbClient.query).toHaveBeenCalledWith('COMMIT');
      expect(result).toEqual(createdProduct);
    });

    test('should throw error if required fields are missing', async () => {
      await expect(Products.create({ name: 'Test' }, 1))
        .rejects.toThrow('Product creation requires name, prices, and category_id.');
      expect(db.getClient).not.toHaveBeenCalled();
    });
  });

  describe('update(id, productData, performingUserId)', () => {
    const productId = 1;
    const productData = { name: 'Updated Product', price_retail: 120, price_wholesale: 90, category_id: 2 };
    const performingUserId = 2;
    const updatedProduct = { ...productData, id: productId };

    test('should update product, log action, and commit on success', async () => {
      mockDbClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [updatedProduct], rowCount: 1 }) // UPDATE
        .mockResolvedValueOnce(undefined); // COMMIT
      logAction.mockResolvedValue(undefined);

      const result = await Products.update(productId, productData, performingUserId);

      expect(db.getClient).toHaveBeenCalledTimes(1);
      expect(mockDbClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockDbClient.query).toHaveBeenCalledWith(
        'UPDATE products SET name=$1, price_retail=$2, price_wholesale=$3, category_id=$4 WHERE id=$5 RETURNING *',
        [productData.name, productData.price_retail, productData.price_wholesale, productData.category_id, productId]
      );
      expect(logAction).toHaveBeenCalledWith(mockDbClient, performingUserId, 'UPDATE_PRODUCT', 'PRODUCT', productId);
      expect(mockDbClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockDbClient.release).toHaveBeenCalledTimes(1);
      expect(result).toEqual(updatedProduct);
    });

    test('should return null and rollback if product to update not found', async () => {
      mockDbClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // UPDATE finds no rows

      const result = await Products.update(productId, productData, performingUserId);

      expect(mockDbClient.query).toHaveBeenCalledWith('ROLLBACK'); // As per current model logic
      expect(result).toBeNull();
      expect(logAction).not.toHaveBeenCalled();
      expect(mockDbClient.release).toHaveBeenCalledTimes(1);
    });
     // Add tests for UPDATE query fail, logAction fail, performingUserId null, input validation (similar to create)
  });

  describe('remove(id, performingUserId)', () => {
    const productId = 1;
    const performingUserId = 3;

    test('should remove product, log action, and commit on success', async () => {
      mockDbClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rowCount: 1, rows:[{id: productId}] }) // DELETE returns rowCount
        .mockResolvedValueOnce(undefined); // COMMIT
      logAction.mockResolvedValue(undefined);

      const result = await Products.remove(productId, performingUserId);

      expect(db.getClient).toHaveBeenCalledTimes(1);
      expect(mockDbClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockDbClient.query).toHaveBeenCalledWith('DELETE FROM products WHERE id=$1 RETURNING id', [productId]);
      expect(logAction).toHaveBeenCalledWith(mockDbClient, performingUserId, 'DELETE_PRODUCT', 'PRODUCT', productId);
      expect(mockDbClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockDbClient.release).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ id: productId, deleted: true });
    });

    test('should return null and rollback if product to remove not found', async () => {
      mockDbClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rowCount: 0, rows:[] }); // DELETE finds no rows

      const result = await Products.remove(productId, performingUserId);

      expect(mockDbClient.query).toHaveBeenCalledWith('ROLLBACK'); // As per current model logic
      expect(result).toBeNull();
      expect(logAction).not.toHaveBeenCalled();
      expect(mockDbClient.release).toHaveBeenCalledTimes(1);
    });
    // Add tests for DELETE query fail, logAction fail, performingUserId null (similar to create)
  });
});
