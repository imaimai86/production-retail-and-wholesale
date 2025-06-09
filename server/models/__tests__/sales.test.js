const Sales = require('../sales');
const db = require('../db'); // Mocked
const { logAction } = require('../../utils/auditLog');
const logger = require('../../utils/logger');

jest.mock('../db', () => ({
  getClient: jest.fn(),
  query: jest.fn(), // For read-only methods
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

describe('Sales Model', () => {
  let mockDbClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDbClient = {
      query: jest.fn(),
      release: jest.fn(),
    };
    db.getClient.mockReturnValue(mockDbClient);
    db.query.mockClear();
  });

  // --- Read-only methods (adapt if necessary) ---
  describe('getAll', () => {
    test('should retrieve all sales with default pagination', async () => {
      const mockSales = [{ id: 1, product_id: 1 }];
      db.query.mockResolvedValue({ rows: mockSales });
      const result = await Sales.getAll({});
      expect(db.query).toHaveBeenCalledWith(
        'SELECT * FROM sales ORDER BY id LIMIT $1 OFFSET $2',
        [10, 0]
      );
      expect(result).toEqual(mockSales);
    });
  });

  describe('getById', () => {
    test('should retrieve a sale by its ID', async () => {
      const mockSale = { id: 1, product_id: 1 };
      db.query.mockResolvedValue({ rows: [mockSale] });
      const result = await Sales.getById(1);
      expect(db.query).toHaveBeenCalledWith('SELECT * FROM sales WHERE id=$1', [1]);
      expect(result).toEqual(mockSale);
    });
  });

  // --- Write methods ---
  describe('create(saleData, performingUserId)', () => {
    const saleData = { product_id: 1, quantity: 2, price: 10, gst_percent: 10, status: 'sold', user_id: 1 };
    const performingUserId = 1; // Should be same as saleData.user_id for sales creation audit
    const createdSale = { ...saleData, id: 123, discount: 0 }; // discount defaults to 0

    test('should create a sale, update inventory, log action, and commit on success', async () => {
      mockDbClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [createdSale] }) // INSERT sales
        .mockResolvedValueOnce(undefined) // UPDATE inventory
        .mockResolvedValueOnce(undefined); // COMMIT
      logAction.mockResolvedValue(undefined);

      const result = await Sales.create(saleData, performingUserId);

      expect(db.getClient).toHaveBeenCalledTimes(1);
      expect(mockDbClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockDbClient.query).toHaveBeenCalledWith(
        'INSERT INTO sales(product_id, quantity, price, discount, gst_percent, status, user_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [saleData.product_id, saleData.quantity, saleData.price, 0, saleData.gst_percent, saleData.status, saleData.user_id]
      );
      expect(mockDbClient.query).toHaveBeenCalledWith(
        'UPDATE inventory SET quantity = quantity - $1 WHERE product_id=$2 AND location_id = (SELECT id FROM locations WHERE is_default_source_for_sales = TRUE LIMIT 1)',
        [saleData.quantity, saleData.product_id]
      );
      expect(logAction).toHaveBeenCalledWith(mockDbClient, performingUserId, 'CREATE_SALE', 'SALE', createdSale.id);
      expect(mockDbClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockDbClient.release).toHaveBeenCalledTimes(1);
      expect(result).toEqual(createdSale);
    });

    test('should not update inventory if status is not "sold"', async () => {
        const pendingSaleData = { ...saleData, status: 'pending' };
        const createdPendingSale = { ...pendingSaleData, id:124, discount:0};
        mockDbClient.query
            .mockResolvedValueOnce(undefined) // BEGIN
            .mockResolvedValueOnce({ rows: [createdPendingSale] }) // INSERT sales
            .mockResolvedValueOnce(undefined); // COMMIT
        logAction.mockResolvedValue(undefined);

        await Sales.create(pendingSaleData, performingUserId);

        expect(mockDbClient.query).toHaveBeenCalledWith( // INSERT
            'INSERT INTO sales(product_id, quantity, price, discount, gst_percent, status, user_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
            [pendingSaleData.product_id, pendingSaleData.quantity, pendingSaleData.price, 0, pendingSaleData.gst_percent, pendingSaleData.status, pendingSaleData.user_id]
        );
        // Check that inventory update was NOT called
        expect(mockDbClient.query).not.toHaveBeenCalledWith(
            expect.stringContaining('UPDATE inventory'),
            expect.anything()
        );
        expect(logAction).toHaveBeenCalledWith(mockDbClient, performingUserId, 'CREATE_SALE', 'SALE', createdPendingSale.id);
        expect(mockDbClient.query).toHaveBeenCalledWith('COMMIT');
    });

    test('should rollback if INSERT sales fails', async () => {
      const dbError = new Error('INSERT sales failed');
      mockDbClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockRejectedValueOnce(dbError); // INSERT sales fails

      await expect(Sales.create(saleData, performingUserId)).rejects.toThrow(dbError);

      expect(mockDbClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(logger.error).toHaveBeenCalledWith('Failed to create sale in model:', dbError);
      expect(mockDbClient.release).toHaveBeenCalledTimes(1);
    });

    test('should rollback if UPDATE inventory fails', async () => {
      const dbError = new Error('UPDATE inventory failed');
      mockDbClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [createdSale] }) // INSERT sales success
        .mockRejectedValueOnce(dbError); // UPDATE inventory fails

      await expect(Sales.create(saleData, performingUserId)).rejects.toThrow(dbError);

      expect(mockDbClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(logAction).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith('Failed to create sale in model:', dbError);
      expect(mockDbClient.release).toHaveBeenCalledTimes(1);
    });

    // Add test for logAction failure similar to products.test.js
    // Add test for performingUserId null similar to products.test.js
    // Add test for input validation
  });

  describe('updateStatus(id, newStatus, performingUserId)', () => {
    const saleId = 1;
    const oldSaleStatus = 'pending';
    const newStatus = 'sold';
    const performingUserId = 2;
    const mockSale = { id: saleId, product_id: 1, quantity: 2, status: oldSaleStatus };
    const updatedSaleResult = { ...mockSale, status: newStatus };

    test('should update status, adjust inventory, log, and commit on success (pending to sold)', async () => {
      mockDbClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [mockSale] }) // SELECT sale
        .mockResolvedValueOnce(undefined) // UPDATE sales status
        .mockResolvedValueOnce(undefined) // UPDATE inventory (decrease for 'sold')
        .mockResolvedValueOnce(undefined); // COMMIT
      logAction.mockResolvedValue(undefined);

      const result = await Sales.updateStatus(saleId, newStatus, performingUserId);

      expect(mockDbClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockDbClient.query).toHaveBeenCalledWith('SELECT * FROM sales WHERE id=$1', [saleId]);
      expect(mockDbClient.query).toHaveBeenCalledWith('UPDATE sales SET status=$1 WHERE id=$2', [newStatus, saleId]);
      expect(mockDbClient.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE inventory SET quantity = quantity - $1'), [mockSale.quantity, mockSale.product_id]);
      expect(logAction).toHaveBeenCalledWith(mockDbClient, performingUserId, `UPDATE_SALE_STATUS_TO_${newStatus.toUpperCase()}`, 'SALE', saleId);
      expect(mockDbClient.query).toHaveBeenCalledWith('COMMIT');
      expect(result).toEqual(updatedSaleResult);
    });

    // Add more updateStatus tests:
    // - sold to pending (inventory increase)
    // - no inventory change if status not 'sold' related
    // - sale not found
    // - DB failures at each step
    // - logAction failure
    // - performingUserId null
  });

  describe('remove(id, performingUserId)', () => {
    const saleId = 1;
    const performingUserId = 3;
    const mockSale = { id: saleId, product_id: 1, quantity: 2, status: 'sold' };

    test('should remove sale, adjust inventory, log, and commit on success (if status was sold)', async () => {
      mockDbClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [mockSale] }) // SELECT sale
        .mockResolvedValueOnce(undefined) // DELETE sale
        .mockResolvedValueOnce(undefined) // UPDATE inventory (increase for 'sold')
        .mockResolvedValueOnce(undefined); // COMMIT
      logAction.mockResolvedValue(undefined);

      const result = await Sales.remove(saleId, performingUserId);

      expect(mockDbClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockDbClient.query).toHaveBeenCalledWith('DELETE FROM sales WHERE id=$1', [saleId]);
      expect(mockDbClient.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE inventory SET quantity = quantity + $1'), [mockSale.quantity, mockSale.product_id]);
      expect(logAction).toHaveBeenCalledWith(mockDbClient, performingUserId, 'DELETE_SALE', 'SALE', saleId);
      expect(mockDbClient.query).toHaveBeenCalledWith('COMMIT');
      expect(result).toEqual(mockSale);
    });

    // Add more remove tests:
    // - status not 'sold' (no inventory adjustment or different adjustment)
    // - sale not found
    // - DB failures
    // - logAction failure
    // - performingUserId null
  });
});
