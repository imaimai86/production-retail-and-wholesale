const { logAction } = require('../auditLog');
const logger = require('../logger'); // Import the actual logger to mock its methods

jest.mock('../logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('auditLog utility', () => {
  let mockDbClient;

  beforeEach(() => {
    mockDbClient = {
      query: jest.fn(),
    };
    // Clear logger mocks before each test
    logger.debug.mockClear();
    logger.info.mockClear();
    logger.warn.mockClear();
    logger.error.mockClear();
  });

  describe('logAction', () => {
    it('should call dbClient.query with correct SQL and all parameters', async () => {
      const userId = 1;
      const action = 'CREATE_PRODUCT';
      const entity = 'PRODUCT';
      const entityId = 101;
      const mockRow = { id: 123 };
      mockDbClient.query.mockResolvedValue({ rows: [mockRow] });

      const result = await logAction(mockDbClient, userId, action, entity, entityId);

      expect(mockDbClient.query).toHaveBeenCalledTimes(1);
      expect(mockDbClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_log (user_id, action, entity, entity_id)'),
        [userId, action, entity, entityId]
      );
      expect(result).toEqual(mockRow);
    });

    it('should call dbClient.query with null for optional entity and entityId if not provided', async () => {
      const userId = 2;
      const action = 'USER_LOGIN';
      const mockRow = { id: 124 };
      mockDbClient.query.mockResolvedValue({ rows: [mockRow] });

      const result = await logAction(mockDbClient, userId, action);

      expect(mockDbClient.query).toHaveBeenCalledTimes(1);
      expect(mockDbClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_log (user_id, action, entity, entity_id)'),
        [userId, action, null, null]
      );
      expect(result).toEqual(mockRow);
    });

    it('should call dbClient.query with null for entityId if entity is provided but entityId is not', async () => {
      const userId = 3;
      const action = 'VIEW_PAGE';
      const entity = 'REPORTS_DASHBOARD';
      const mockRow = { id: 125 };
      mockDbClient.query.mockResolvedValue({ rows: [mockRow] });

      const result = await logAction(mockDbClient, userId, action, entity);

      expect(mockDbClient.query).toHaveBeenCalledTimes(1);
      expect(mockDbClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_log (user_id, action, entity, entity_id)'),
        [userId, action, entity, null]
      );
      expect(result).toEqual(mockRow);
    });

    it('should log error and re-throw if dbClient.query fails', async () => {
      const userId = 3;
      const action = 'DB_ERROR_TEST';
      const dbError = new Error('Database connection failed');
      mockDbClient.query.mockRejectedValue(dbError);

      await expect(logAction(mockDbClient, userId, action))
        .rejects.toThrow(dbError);

      expect(mockDbClient.query).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledTimes(1);
      const expectedErrorMessage = `Error logging action to audit_log. Action: ${action}, UserID: ${userId}, Entity: null, EntityID: null.`;
      expect(logger.error).toHaveBeenCalledWith(expectedErrorMessage, dbError);
    });
  });
});
