const Categories = require('../categories');
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

describe('Categories Model', () => {
  let mockDbClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDbClient = {
      query: jest.fn(),
      release: jest.fn(),
    };
    db.getClient.mockReturnValue(mockDbClient);
    db.query.mockClear(); // Clear for getAll if it uses global db.query
  });

  // --- Read-only method ---
  describe('getAll', () => {
    test('should retrieve all categories with default pagination', async () => {
      const mockCategories = [{ id: 1, name: 'Category 1' }];
      // Assuming getAll might be called without a dbClient, thus using global db.query
      db.query.mockResolvedValue({ rows: mockCategories });

      const result = await Categories.getAll({});

      expect(db.query).toHaveBeenCalledWith(
        'SELECT * FROM categories ORDER BY id LIMIT $1 OFFSET $2',
        [10, 0]
      );
      expect(result).toEqual(mockCategories);
    });
  });

  // --- Write method ---
  describe('create(categoryData, performingUserId)', () => {
    const categoryData = { name: 'New Category', gst_percent: 10 };
    const performingUserId = 1;
    const createdCategory = { ...categoryData, id: 123 };

    test('should create a category, log action, and commit on success', async () => {
      mockDbClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [createdCategory] }) // INSERT
        .mockResolvedValueOnce(undefined); // COMMIT
      logAction.mockResolvedValue(undefined);

      const result = await Categories.create(categoryData, performingUserId);

      expect(db.getClient).toHaveBeenCalledTimes(1);
      expect(mockDbClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockDbClient.query).toHaveBeenCalledWith(
        'INSERT INTO categories(name, gst_percent) VALUES($1,$2) RETURNING *',
        [categoryData.name, categoryData.gst_percent]
      );
      expect(logAction).toHaveBeenCalledWith(mockDbClient, performingUserId, 'CREATE_CATEGORY', 'CATEGORY', createdCategory.id);
      expect(mockDbClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockDbClient.release).toHaveBeenCalledTimes(1);
      expect(result).toEqual(createdCategory);
      expect(logger.error).not.toHaveBeenCalled();
    });

    test('should rollback and log error if INSERT fails', async () => {
      const dbError = new Error('INSERT failed');
      mockDbClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockRejectedValueOnce(dbError); // INSERT fails

      await expect(Categories.create(categoryData, performingUserId)).rejects.toThrow(dbError);

      expect(mockDbClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(logAction).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith('Failed to create category in model:', dbError);
      expect(mockDbClient.release).toHaveBeenCalledTimes(1);
    });

    test('should rollback and log error if logAction fails', async () => {
      const logActionError = new Error('logAction failed');
      mockDbClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [createdCategory] }); // INSERT success
      logAction.mockRejectedValue(logActionError);

      await expect(Categories.create(categoryData, performingUserId)).rejects.toThrow(logActionError);

      expect(mockDbClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(logger.error).toHaveBeenCalledWith('Failed to create category in model:', logActionError);
      expect(mockDbClient.release).toHaveBeenCalledTimes(1);
    });

    test('should warn and commit if performingUserId is null', async () => {
      mockDbClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [createdCategory] }) // INSERT
        .mockResolvedValueOnce(undefined); // COMMIT

      const result = await Categories.create(categoryData, null);
      expect(logAction).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(`CREATE_CATEGORY action for category ID ${createdCategory.id} performed without a performingUserId.`);
      expect(mockDbClient.query).toHaveBeenCalledWith('COMMIT');
      expect(result).toEqual(createdCategory);
    });

    test('should throw error if required fields are missing', async () => {
      await expect(Categories.create({ name: 'Test' }, 1)) // gst_percent missing
        .rejects.toThrow('Category creation requires name and gst_percent.');
      expect(db.getClient).not.toHaveBeenCalled();
    });
  });
});
