const PASSWORD = 's3cr3t%40Pw';
const RAW_PASSWORD = 's3cr3t@Pw';
const ADMIN_URL = `postgres://admin:${PASSWORD}@dbhost:5433/app?sslmode=disable`;
const MISSING = 'DATABASE_URL is required for integration tests';

let queries;
let queryImpl;

jest.mock('pg', () => {
  class Pool {
    constructor(opts) { this.opts = opts; }
    query(...args) { return mockQuery(...args); }
    async connect() {
      return { query: (...a) => mockQuery(...a), release() {} };
    }
    async end() {}
  }
  return { Pool };
});

function mockQuery(sql, params) {
  queries.push(typeof sql === 'string' ? sql : sql.text);
  return queryImpl(sql, params);
}

const savedUrl = process.env.DATABASE_URL;
let helper;

beforeEach(() => {
  jest.resetModules();
  queries = [];
  queryImpl = async () => ({ rows: [], rowCount: 0 });
  process.env.DATABASE_URL = ADMIN_URL;
  helper = require('../../test-utils/scratchDb');
});

afterEach(() => {
  if (savedUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedUrl;
});

const dropQueries = () => queries.filter(q => /DROP/i.test(q));

describe('names and urls', () => {
  test('scratchName is prw_test_ plus 8 random hex chars; withDatabaseName replaces only the database name', () => {
    const names = Array.from({ length: 20 }, () => helper.scratchName());
    for (const n of names) expect(n).toMatch(/^prw_test_[0-9a-f]{8}$/);
    expect(new Set(names).size).toBeGreaterThan(1);

    const u = new URL(helper.withDatabaseName(ADMIN_URL, 'prw_test_abcd1234'));
    const orig = new URL(ADMIN_URL);
    expect(u.pathname).toBe('/prw_test_abcd1234');
    expect(u.username).toBe(orig.username);
    expect(u.password).toBe(orig.password);
    expect(u.hostname).toBe(orig.hostname);
    expect(u.port).toBe('5433');
    expect(u.search).toBe('?sslmode=disable');
  });

  test('requireDatabaseUrl returns the trimmed url and throws the exact message when it is unset, empty or blank', () => {
    expect(() => helper.requireDatabaseUrl({})).toThrow(new Error(MISSING));
    expect(() => helper.requireDatabaseUrl({ DATABASE_URL: '' })).toThrow(new Error(MISSING));
    expect(() => helper.requireDatabaseUrl({ DATABASE_URL: '   ' })).toThrow(new Error(MISSING));
    expect(helper.requireDatabaseUrl({ DATABASE_URL: `  ${ADMIN_URL}\n` })).toBe(ADMIN_URL);
  });
});

describe('createScratchDb', () => {
  test('without DATABASE_URL it throws the exact message, issues no query and does not leak the password', async () => {
    delete process.env.DATABASE_URL;
    let err;
    try { await helper.createScratchDb(); } catch (e) { err = e; }
    expect(err).toEqual(new Error(MISSING));
    expect(queries).toEqual([]);
    expect(err.message).not.toContain(RAW_PASSWORD);
    expect(err.message).not.toContain(PASSWORD);

    process.env.DATABASE_URL = '   ';
    await expect(helper.createScratchDb()).rejects.toThrow(new Error(MISSING));
  });

  test('creates a prw_test_ database and returns the rewritten url; a connection failure names neither password nor url', async () => {
    const { name, url } = await helper.createScratchDb();
    expect(name).toMatch(/^prw_test_[0-9a-f]{8}$/);
    expect(queries.some(q => /CREATE DATABASE/i.test(q) && q.includes(name))).toBe(true);
    expect(new URL(url).pathname).toBe(`/${name}`);
    expect(new URL(url).search).toBe('?sslmode=disable');

    queryImpl = async () => {
      throw Object.assign(
        new Error(`password authentication failed for ${ADMIN_URL} pw=${RAW_PASSWORD} ${PASSWORD}`),
        { code: '28P01' }
      );
    };
    let err;
    try { await helper.createScratchDb(); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(Error);
    expect(err.message).not.toContain(RAW_PASSWORD);
    expect(err.message).not.toContain(PASSWORD);
    expect(err.message).not.toContain(ADMIN_URL);
    expect(err.message).not.toContain('dbhost');
  });
});

describe('dropScratchDb', () => {
  test('rejects a name without the prw_test_ prefix, or one this process did not create, with no DROP and no password in the error', async () => {
    for (const name of ['other_db', 'app', 'postgres', 'prw_testing', 'x_prw_test_abcd1234', '', 'prw_test_abcd1234']) {
      let err;
      try { await helper.dropScratchDb(name); } catch (e) { err = e; }
      expect([name, err instanceof Error]).toEqual([name, true]);
      expect(err.message).not.toContain(RAW_PASSWORD);
      expect(err.message).not.toContain(PASSWORD);
    }
    expect(dropQueries()).toEqual([]);
  });

  test('drops a database it created, with FORCE, once', async () => {
    const { name } = await helper.createScratchDb();
    await helper.dropScratchDb(name);
    const drops = dropQueries();
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatch(/DROP DATABASE/i);
    expect(drops[0]).toMatch(/FORCE/i);
    expect(drops[0]).toContain(name);
    await expect(helper.dropScratchDb(name)).rejects.toThrow();
    expect(dropQueries()).toHaveLength(1);
  });
});

describe('useScratchEnv', () => {
  const keys = ['DATABASE_URL', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'];
  let saved;
  beforeEach(() => { saved = Object.fromEntries(keys.map(k => [k, process.env[k]])); });
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test('sets DATABASE_URL and PG* from the scratch url, with port 5432 by default', () => {
    const url = helper.withDatabaseName(ADMIN_URL, 'prw_test_abcd1234');
    helper.useScratchEnv(url);
    expect(process.env.DATABASE_URL).toBe(url);
    expect(process.env.PGHOST).toBe('dbhost');
    expect(process.env.PGPORT).toBe('5433');
    expect(process.env.PGUSER).toBe('admin');
    expect(process.env.PGPASSWORD).toBe(RAW_PASSWORD);
    expect(process.env.PGDATABASE).toBe('prw_test_abcd1234');

    helper.useScratchEnv('postgres://u:p@h/prw_test_abcd1234');
    expect(process.env.PGPORT).toBe('5432');
  });
});
