const Users = require('../users');
const db = require('../db');
const { logAction } = require('../../utils/auditLog');
const logger = require('../../utils/logger');

jest.mock('../db', () => ({
  getClient: jest.fn(),
  // query: jest.fn(), // Mock global query if other User methods use it and are tested here
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

describe('Users Model - create()', () => {
  let mockDbClient;

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    mockDbClient = {
      query: jest.fn(),
      release: jest.fn(),
    };
    db.getClient.mockReturnValue(mockDbClient);
  });

  const userData = {
    name: 'Test User',
    email: 'test@example.com',
    password_hash: 'hashedpassword',
    role: 'user',
  };
  const performingUserId = 123;
  const newUserRecord = { ...userData, id: 1 };

  test('should create a user, log action, and commit transaction on success', async () => {
    mockDbClient.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [newUserRecord] }) // INSERT
      .mockResolvedValueOnce(undefined); // COMMIT
    logAction.mockResolvedValue(undefined);

    const result = await Users.create(userData, performingUserId);

    expect(db.getClient).toHaveBeenCalledTimes(1);
    expect(mockDbClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockDbClient.query).toHaveBeenCalledWith(
      'INSERT INTO users(name, email, password_hash, role) VALUES($1, $2, $3, $4) RETURNING *',
      [userData.name, userData.email, userData.password_hash, userData.role]
    );
    expect(logAction).toHaveBeenCalledWith(mockDbClient, performingUserId, 'CREATE_USER', 'USER', newUserRecord.id);
    expect(mockDbClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockDbClient.release).toHaveBeenCalledTimes(1);
    expect(result).toEqual(newUserRecord);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('should create a user with default role if role is not provided in userData', async () => {
    const userDataNoRole = { name: 'Test User No Role', email: 'testnorole@example.com', password_hash: 'hashedpassword' };
    // Assuming the model's INSERT query for no role results in a user record where 'role' might be set by DB default
    // For the test, we define what the expected returned record looks like if the model handles it.
    const newUserRecordNoRole = { ...userDataNoRole, id: 2, role: 'user' }; // Example, actual role depends on DB default or model logic

    mockDbClient.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [newUserRecordNoRole] }) // INSERT (model handles SQL for no role)
      .mockResolvedValueOnce(undefined); // COMMIT
    logAction.mockResolvedValue(undefined);

    const result = await Users.create(userDataNoRole, performingUserId);

    expect(mockDbClient.query).toHaveBeenCalledWith(
      'INSERT INTO users(name, email, password_hash) VALUES($1, $2, $3) RETURNING *',
      [userDataNoRole.name, userDataNoRole.email, userDataNoRole.password_hash]
    );
    expect(logAction).toHaveBeenCalledWith(mockDbClient, performingUserId, 'CREATE_USER', 'USER', newUserRecordNoRole.id);
    expect(result).toEqual(newUserRecordNoRole);
  });

  test('should rollback transaction and log error if INSERT query fails', async () => {
    const dbError = new Error('DB INSERT Failed');
    mockDbClient.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockRejectedValueOnce(dbError); // INSERT fails

    await expect(Users.create(userData, performingUserId)).rejects.toThrow(dbError);

    expect(mockDbClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockDbClient.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO users')); // Checks that an INSERT was attempted
    expect(logAction).not.toHaveBeenCalled();
    expect(mockDbClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(logger.error).toHaveBeenCalledWith('Failed to create user in model:', dbError);
    expect(mockDbClient.release).toHaveBeenCalledTimes(1);
  });

  test('should rollback transaction and log error if logAction fails', async () => {
    const logActionError = new Error('Simulated logAction failure');
    mockDbClient.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [newUserRecord] }); // INSERT successful
    logAction.mockRejectedValue(logActionError);

    await expect(Users.create(userData, performingUserId)).rejects.toThrow(logActionError);

    expect(mockDbClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockDbClient.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO users'));
    expect(logAction).toHaveBeenCalledWith(mockDbClient, performingUserId, 'CREATE_USER', 'USER', newUserRecord.id);
    expect(mockDbClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(logger.error).toHaveBeenCalledWith('Failed to create user in model:', logActionError);
    expect(mockDbClient.release).toHaveBeenCalledTimes(1);
  });

  test('should not call logAction if performingUserId is null and commit transaction', async () => {
    mockDbClient.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [newUserRecord] }) // INSERT
      .mockResolvedValueOnce(undefined); // COMMIT

    const result = await Users.create(userData, null); // Pass null for performingUserId

    expect(db.getClient).toHaveBeenCalledTimes(1);
    expect(mockDbClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockDbClient.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO users'));
    expect(logAction).not.toHaveBeenCalled(); // Crucial assertion
    // logger.warn might be called if that logic exists in the model, current model does not log warning for this.
    // expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('CREATE_USER action performed without a performingUserId'));
    expect(mockDbClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockDbClient.release).toHaveBeenCalledTimes(1);
    expect(result).toEqual(newUserRecord);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('should throw error if required userData fields (name, email, password_hash) are missing', async () => {
    const incompleteUserData1 = { email: 'e@e.com', password_hash: 'p' }; // Missing name
    const incompleteUserData2 = { name: 'N', password_hash: 'p' }; // Missing email
    const incompleteUserData3 = { name: 'N', email: 'e@e.com' }; // Missing password_hash

    const expectedErrorMessage = 'User creation requires name, email, and password_hash.';

    await expect(Users.create(incompleteUserData1, performingUserId)).rejects.toThrow(expectedErrorMessage);
    await expect(Users.create(incompleteUserData2, performingUserId)).rejects.toThrow(expectedErrorMessage);
    await expect(Users.create(incompleteUserData3, performingUserId)).rejects.toThrow(expectedErrorMessage);

    expect(db.getClient).not.toHaveBeenCalled(); // Transaction should not even start
  });
});
