jest.mock('pg', () => ({
  Pool: jest.fn(() => ({ query: jest.fn(), connect: jest.fn() }))
}));

describe('db model pool construction', () => {
  const original = process.env.DATABASE_URL;
  let consoleSpies;

  // The pool is created at require time, so reset modules, set the env, then
  // re-require pg so assertions use the same Pool mock that db.js received.
  function load(value) {
    jest.resetModules();
    if (value === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = value;
    const { Pool } = require('pg');
    const db = require('../../models/db');
    return { Pool, db };
  }

  beforeEach(() => {
    consoleSpies = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
      jest.spyOn(console, m).mockImplementation(() => {})
    );
  });

  afterEach(() => {
    consoleSpies.forEach((s) => s.mockRestore());
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  });

  test('uses the untrimmed DATABASE_URL as connectionString, exports exactly query and transaction, and logs nothing', () => {
    const url = 'postgres://u:secretpw@h:5432/d';
    let { Pool, db } = load(url);
    expect(Pool).toHaveBeenCalledTimes(1);
    expect(Pool).toHaveBeenCalledWith({ connectionString: url });
    expect(Object.keys(Pool.mock.calls[0][0])).toEqual(['connectionString']);

    expect(Object.keys(db).sort()).toEqual(['query', 'transaction']);
    expect(typeof db.query).toBe('function');
    expect(typeof db.transaction).toBe('function');
    consoleSpies.forEach((s) => expect(s).not.toHaveBeenCalled());

    const padded = '  postgres://u:p@h:5432/d  ';
    ({ Pool } = load(padded));
    expect(Pool).toHaveBeenCalledTimes(1);
    expect(Pool.mock.calls[0][0]).toEqual({ connectionString: padded });
  });

  test('calls Pool with no arguments when DATABASE_URL is unset, empty or blank; requiring the module never throws', () => {
    for (const value of [undefined, '', '   ', '\t\n ']) {
      const { Pool } = load(value);
      expect([value, Pool.mock.calls]).toEqual([value, [[]]]);
    }
    for (const value of [undefined, '', '   ', 'not a url', 'postgres://u:p@h:5432/d']) {
      expect(() => load(value)).not.toThrow();
    }
  });
});

describe('db model behaviour', () => {
  const original = process.env.DATABASE_URL;
  let pool;
  let db;

  beforeEach(() => {
    jest.resetModules();
    process.env.DATABASE_URL = 'postgres://u:p@h:5432/d';
    const { Pool } = require('pg');
    db = require('../../models/db');
    pool = Pool.mock.results[0].value;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  });

  test('query delegates to the pool', async () => {
    pool.query.mockResolvedValue({ rows: [1] });
    const res = await db.query('SELECT $1', [1]);
    expect(pool.query).toHaveBeenCalledWith('SELECT $1', [1]);
    expect(res).toEqual({ rows: [1] });
  });

  test('transaction commits, or rolls back and rethrows unchanged, and always releases the client', async () => {
    let client = { query: jest.fn().mockResolvedValue({}), release: jest.fn() };
    pool.connect.mockResolvedValue(client);
    expect(await db.transaction(async () => 'ok')).toBe('ok');
    expect(client.query.mock.calls.map((c) => c[0])).toEqual(['BEGIN', 'COMMIT']);
    expect(client.release).toHaveBeenCalledTimes(1);

    client = { query: jest.fn().mockResolvedValue({}), release: jest.fn() };
    pool.connect.mockResolvedValue(client);
    const err = new Error('boom');
    await expect(
      db.transaction(async () => {
        throw err;
      })
    ).rejects.toBe(err);
    expect(client.query.mock.calls.map((c) => c[0])).toEqual(['BEGIN', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
