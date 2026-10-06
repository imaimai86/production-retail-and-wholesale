const scratch = require('../../test-utils/scratchDb');

jest.setTimeout(30000);

const created = [];

async function newDb() {
  const c = await scratch.createScratchDb();
  created.push(c.name);
  return c;
}

afterAll(async () => {
  await scratch.closePools();
  for (const name of created) await scratch.dropScratchDb(name);
});

async function describeTable(url, table) {
  const pool = scratch.openPool(url);
  const cols = await pool.query(
    `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  const columns = cols.rows
    .map(r => [r.column_name, r.data_type, r.is_nullable, r.column_default].join('|'))
    .sort();
  const cons = await pool.query(
    `SELECT c.contype,
            (SELECT array_agg(a.attname ORDER BY k.ord)
               FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS cols,
            (SELECT relname FROM pg_class WHERE oid = c.confrelid) AS ref
       FROM pg_constraint c
      WHERE c.conrelid = ('public.' || $1)::regclass
        AND c.contype IN ('p', 'f', 'u')`,
    [table]
  );
  const constraints = cons.rows
    .map(r => `${r.contype}:${r.cols.join(',')}:${r.ref || ''}`)
    .sort();
  return { columns, constraints };
}

describe('migrations against Postgres', () => {
  test('all migrations apply to an empty database', async () => {
    const { url } = await newDb();
    await expect(scratch.applyMigrations(url)).resolves.not.toThrow();
    const pool = scratch.openPool(url);
    const loc = await pool.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name='sales' AND column_name='location'"
    );
    expect(loc.rowCount).toBe(1);
    const uq = await pool.query(
      "SELECT 1 FROM pg_constraint WHERE conrelid='inventory'::regclass AND contype='u'"
    );
    expect(uq.rowCount).toBe(1);
  });

  test('002 merges duplicate inventory rows and backfills sales.location', async () => {
    const { url } = await newDb();
    await scratch.applyMigrations(url, ['001_initial.sql']);
    const pool = scratch.openPool(url);
    await pool.query("INSERT INTO categories(name, gst) VALUES('c', 5)");
    await pool.query("INSERT INTO products(name, price_retail, price_wholesale, category_id) VALUES('p', 10, 8, 1)");
    await pool.query("INSERT INTO inventory(product_id, location, quantity) VALUES (1,'retail',3),(1,'retail',4)");
    await pool.query("INSERT INTO sales(product_id, quantity, price, gst) VALUES (1,1,10,0.5),(1,2,10,1)");

    await scratch.applyMigrations(url, ['002_sales_location.sql']);

    const inv = await pool.query("SELECT quantity FROM inventory WHERE product_id=1 AND location='retail'");
    expect(inv.rows).toHaveLength(1);
    expect(inv.rows[0].quantity).toBe(7);
    const sales = await pool.query('SELECT location FROM sales ORDER BY id');
    expect(sales.rows).toHaveLength(2);
    expect(sales.rows.every(r => r.location === 'retail')).toBe(true);

    let err;
    try {
      await pool.query("INSERT INTO inventory(product_id, location, quantity) VALUES (1,'retail',1)");
    } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.code).toBe('23505');
  });

  test('002 leaves distinct locations of the same product untouched', async () => {
    const { url } = await newDb();
    await scratch.applyMigrations(url, ['001_initial.sql']);
    const pool = scratch.openPool(url);
    await pool.query("INSERT INTO categories(name, gst) VALUES('c', 5)");
    await pool.query("INSERT INTO products(name, price_retail, price_wholesale, category_id) VALUES('p', 10, 8, 1)");
    await pool.query("INSERT INTO inventory(product_id, location, quantity) VALUES (1,'retail',3),(1,'production',4)");
    await scratch.applyMigrations(url, ['002_sales_location.sql']);
    const inv = await pool.query('SELECT location, quantity FROM inventory ORDER BY location');
    expect(inv.rows).toEqual([
      { location: 'production', quantity: 4 },
      { location: 'retail', quantity: 3 }
    ]);
  });

  test('schema drift: migrations match schema.sql for sales and inventory', async () => {
    const a = await newDb();
    const b = await newDb();
    await scratch.applyMigrations(a.url, ['001_initial.sql', '002_sales_location.sql']);
    await scratch.applySchema(b.url);

    for (const table of ['sales', 'inventory']) {
      const fromMigrations = await describeTable(a.url, table);
      const fromSchema = await describeTable(b.url, table);
      expect(fromMigrations.columns).toEqual(fromSchema.columns);
      expect(fromMigrations.constraints).toEqual(fromSchema.constraints);
    }

    const sales = await describeTable(a.url, 'sales');
    expect(sales.constraints).toEqual(expect.arrayContaining([
      'p:id:',
      'f:product_id:products',
      'f:user_id:users'
    ]));
    const inventory = await describeTable(a.url, 'inventory');
    expect(inventory.constraints).toEqual(expect.arrayContaining([
      'p:id:',
      'f:product_id:products',
      'u:product_id,location:'
    ]));
  });

  test('drift check detects a real difference', async () => {
    const a = await newDb();
    const b = await newDb();
    await scratch.applyMigrations(a.url, ['001_initial.sql']);
    await scratch.applySchema(b.url);
    const fromMigrations = await describeTable(a.url, 'inventory');
    const fromSchema = await describeTable(b.url, 'inventory');
    expect(fromMigrations.constraints).not.toEqual(fromSchema.constraints);
  });
});
