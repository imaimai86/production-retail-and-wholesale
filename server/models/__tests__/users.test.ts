import db from '../db';
import * as Users from '../users'; // Import all exports as Users
import { User, UserCreationData } from '../users';
import { QueryResult } from 'pg';

jest.mock('../db');

// Cast db to its mocked version to allow type-safe access to mockResolvedValue etc.
const mockedDb = db as jest.Mocked<typeof db>;

describe('Users model', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('getAll default', async () => {
    // Prepare the mock response for db.query
    const mockQueryResult: Partial<QueryResult<User>> = { rows: [] };
    mockedDb.query.mockResolvedValue(mockQueryResult as QueryResult<User>);

    await Users.getAll();

    expect(mockedDb.query).toHaveBeenCalledWith(
      'SELECT * FROM users ORDER BY id LIMIT $1 OFFSET $2',
      [10, 0]
    );
  });

  test('create', async () => {
    const userData: UserCreationData = { name: 'Alice' };
    const expectedUser: User = { id: 1, ...userData }; // Assuming id is added upon creation

    // Prepare the mock response for db.query
    const mockQueryResult: Partial<QueryResult<User>> = { rows: [expectedUser] };
    mockedDb.query.mockResolvedValue(mockQueryResult as QueryResult<User>);

    const createdUser = await Users.create(userData);

    expect(mockedDb.query).toHaveBeenCalledWith(
      'INSERT INTO users(name) VALUES($1) RETURNING *',
      [userData.name]
    );
    expect(createdUser).toEqual(expectedUser);
  });
});
