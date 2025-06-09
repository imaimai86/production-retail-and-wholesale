const Inventory = require('../inventory');
const db = require('../db'); // Mocked
const { logAction } = require('../../utils/auditLog');
const logger = require('../../utils/logger');

jest.mock('../db', () => ({
  getClient: jest.fn(),
  query: jest.fn(), // For read-only getAll
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

describe('Inventory Model', () => {
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

  // --- Read-only method ---
  describe('getAll', () => {
    test('should retrieve all inventory items with default pagination', async () => {
      const mockInventory = [{ id: 1, product_id: 1, location_id: 1, quantity: 10 }];
      db.query.mockResolvedValue({ rows: mockInventory });

      const result = await Inventory.getAll({});

      expect(db.query).toHaveBeenCalledWith(
        'SELECT * FROM inventory ORDER BY id LIMIT $1 OFFSET $2',
        [10, 0]
      );
      expect(result).toEqual(mockInventory);
    });
  });

  // --- Write method ---
  describe('transfer(productId, fromLocationId, toLocationId, quantity, performingUserId)', () => {
    const productId = 1;
    const fromLocationId = 10;
    const toLocationId = 20;
    const quantity = 5;
    const performingUserId = 1;
    const mockUpdatedInventoryItem = { product_id: productId, location_id: toLocationId, quantity: quantity + 5 }; // Example

    test('should transfer inventory, log action, and commit on success', async () => {
      mockDbClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ quantity: 10 - quantity }] }) // UPDATE (decrease from source)
        .mockResolvedValueOnce({ rows: [mockUpdatedInventoryItem] }) // INSERT/UPDATE (increase at destination)
        .mockResolvedValueOnce(undefined); // COMMIT
      logAction.mockResolvedValue(undefined);

      const result = await Inventory.transfer(productId, fromLocationId, toLocationId, quantity, performingUserId);

      expect(db.getClient).toHaveBeenCalledTimes(1);
      expect(mockDbClient.query).toHaveBeenCalledWith('BEGIN');
      // Check decrease query
      expect(mockDbClient.query).toHaveBeenCalledWith(
        'UPDATE inventory SET quantity = quantity - $1 WHERE product_id = $2 AND location_id = $3 RETURNING quantity',
        [quantity, productId, fromLocationId]
      );
      // Check increase/insert query
      expect(mockDbClient.query).toHaveBeenCalledWith(
        'INSERT INTO inventory(product_id, location_id, quantity) VALUES($1, $2, $3) ON CONFLICT (product_id, location_id) DO UPDATE SET quantity = inventory.quantity + EXCLUDED.quantity RETURNING *',
        [productId, toLocationId, quantity]
      );
      expect(logAction).toHaveBeenCalledWith(mockDbClient, performingUserId, 'TRANSFER_INVENTORY', 'INVENTORY', productId);
      expect(mockDbClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockDbClient.release).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockUpdatedInventoryItem);
    });

    test('should throw error if product not found at source location', async () => {
      mockDbClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rowCount: 0 }); // UPDATE (decrease from source) - 0 rows affected

      await expect(Inventory.transfer(productId, fromLocationId, toLocationId, quantity, performingUserId))
        .rejects.toThrow(`Product ID ${productId} not found at source location ID ${fromLocationId}.`);

      expect(mockDbClient.query).toHaveBeenCalledWith('ROLLBACK'); // Model should rollback
      expect(logAction).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to transfer inventory'), expect.any(Error));
      expect(mockDbClient.release).toHaveBeenCalledTimes(1);
    });

    test('should throw error if insufficient quantity at source location', async () => {
      mockDbClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ quantity: -1 }] }); // UPDATE (decrease from source) - results in negative

      await expect(Inventory.transfer(productId, fromLocationId, toLocationId, quantity, performingUserId))
        .rejects.toThrow(`Insufficient quantity for product ID ${productId} at source location ID ${fromLocationId}.`);

      expect(mockDbClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(logAction).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to transfer inventory'), expect.any(Error));
      expect(mockDbClient.release).toHaveBeenCalledTimes(1);
    });

    test('should rollback and log error if destination INSERT/UPDATE fails', async () => {
        const dbError = new Error('Destination update failed');
        mockDbClient.query
            .mockResolvedValueOnce(undefined) // BEGIN
            .mockResolvedValueOnce({ rowCount: 1, rows: [{ quantity: 10 - quantity }]}) // Source update success
            .mockRejectedValueOnce(dbError); // Destination update fails

        await expect(Inventory.transfer(productId, fromLocationId, toLocationId, quantity, performingUserId))
            .rejects.toThrow(dbError);

        expect(mockDbClient.query).toHaveBeenCalledWith('ROLLBACK');
        expect(logAction).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to transfer inventory'), dbError);
        expect(mockDbClient.release).toHaveBeenCalledTimes(1);
    });

    test('should rollback and log error if logAction fails', async () => {
      const logActionError = new Error('logAction failed');
      mockDbClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ quantity: 10 - quantity }] }) // Source update success
        .mockResolvedValueOnce({ rows: [mockUpdatedInventoryItem] }); // Destination update success
      logAction.mockRejectedValue(logActionError);

      await expect(Inventory.transfer(productId, fromLocationId, toLocationId, quantity, performingUserId))
        .rejects.toThrow(logActionError);

      expect(mockDbClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to transfer inventory'), logActionError);
      expect(mockDbClient.release).toHaveBeenCalledTimes(1);
    });

    test('should warn and commit if performingUserId is null', async () => {
      mockDbClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ quantity: 10 - quantity }] })
        .mockResolvedValueOnce({ rows: [mockUpdatedInventoryItem] })
        .mockResolvedValueOnce(undefined); // COMMIT

      const result = await Inventory.transfer(productId, fromLocationId, toLocationId, quantity, null);
      expect(logAction).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(`TRANSFER_INVENTORY action for product ID ${productId} performed without a performingUserId.`);
      expect(mockDbClient.query).toHaveBeenCalledWith('COMMIT');
      expect(result).toEqual(mockUpdatedInventoryItem);
    });

    test('should throw error for invalid quantity or same locations', async () => {
      await expect(Inventory.transfer(productId, fromLocationId, toLocationId, 0, performingUserId))
        .rejects.toThrow('Transfer quantity must be positive.');
      await expect(Inventory.transfer(productId, fromLocationId, fromLocationId, 1, performingUserId))
        .rejects.toThrow('Source and destination locations cannot be the same for an inventory transfer.');
      expect(db.getClient).not.toHaveBeenCalled();
    });
  });
});
