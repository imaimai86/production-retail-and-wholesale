const scratch = require('../../test-utils/scratchDb');

jest.setTimeout(30000);

const tracked = [];
let dbName;
let db;

beforeAll(async () => {
  const created = await scratch.createScratchDb();
  dbName = created.name;
  await scratch.applyMigrations(created.url);
  scratch.useScratchEnv(created.url);
  jest.resetModules();
  jest.doMock('pg', () => {
    const actual = jest.requireActual('pg');
    class TrackedPool extends actual.Pool {
      constructor(...a) { super(...a); tracked.push(this); }
    }
    return { ...actual, Pool: TrackedPool };
  });
  db = require('../../models/db');
});

afterAll(async () => {
  await Promise.all(tracked.map(p => p.end()));
  if (dbName) await scratch.dropScratchDb(dbName);
});

beforeEach(async () => {
  await db.query('TRUNCATE categories RESTART IDENTITY CASCADE');
});

const countCategories = async name => {
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM categories WHERE name=$1', [name]);
  return rows[0].n;
};

describe('models/db against Postgres', () => {
  test('SELECT 1 returns 1', async () => {
    const { rows } = await db.query('SELECT 1 AS n');
    expect(rows[0].n).toBe(1);
  });

  test('transaction commits on success', async () => {
    await db.transaction(client =>
      client.query("INSERT INTO categories(name, gst) VALUES('committed', 5)")
    );
    expect(await countCategories('committed')).toBe(1);
  });

  test('transaction returns the callback result', async () => {
    const result = await db.transaction(async () => 42);
    expect(result).toBe(42);
  });

  test('transaction rolls back and rethrows the same error', async () => {
    const boom = new Error('boom');
    await expect(
      db.transaction(async client => {
        await client.query("INSERT INTO categories(name, gst) VALUES('rolled_back', 5)");
        throw boom;
      })
    ).rejects.toBe(boom);
    expect(await countCategories('rolled_back')).toBe(0);
  });

  test('pool stays usable after a rollback', async () => {
    await expect(db.transaction(async () => { throw new Error('x'); })).rejects.toThrow('x');
    const { rows } = await db.query('SELECT 1 AS n');
    expect(rows[0].n).toBe(1);
  });
});
