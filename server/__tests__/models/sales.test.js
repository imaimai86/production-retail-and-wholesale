jest.mock('../../models/db', () => ({
  query: jest.fn(),
  transaction: jest.fn()
}));
const db = require('../../models/db');
const Sales = require('../../models/sales');

// Stateful fake of the inventory and sales tables. It interprets the SQL shapes from plan-1:
//   SELECT * FROM sales WHERE id=$1
//   SELECT ... FROM inventory WHERE product_id=$1 AND location=$2
//   UPDATE inventory SET quantity = quantity - $1 WHERE product_id=$2 AND location=$3 [AND quantity >= $1]
//   INSERT INTO inventory(product_id, location, quantity) VALUES($1,$2,$3) ON CONFLICT ...   (upsert)
//   INSERT INTO sales(<cols>) VALUES(...)   (columns are read from the statement)
//   UPDATE sales SET status=$1 WHERE id=$2 / DELETE FROM sales WHERE id=$1
// An inventory UPDATE without `quantity >=` is unconditional, so a missing check shows up as a
// negative quantity. Any other SQL (e.g. a decrement keyed by product_id only) throws.
// db.transaction restores the snapshot when the callback throws, like a real rollback.
function useFakeDb({ inventory = [], sales = [] } = {}) {
  const state = {
    inventory: inventory.map(r => ({ ...r })),
    sales: sales.map(r => ({ ...r })),
    log: []
  };
  let nextInvId = 100;
  let nextSaleId = 100;
  const client = {
    query: jest.fn(async (rawSql, params = []) => {
      const sql = rawSql.replace(/\s+/g, ' ').trim();
      state.log.push(sql);
      let m;
      if (/^SELECT .* FROM sales WHERE id ?= ?\$1/i.test(sql)) {
        const row = state.sales.find(s => s.id === Number(params[0]));
        return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
      }
      if (/^SELECT .* FROM inventory WHERE product_id ?= ?\$1 AND location ?= ?\$2/i.test(sql)) {
        const row = state.inventory.find(r => r.product_id === params[0] && r.location === params[1]);
        return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
      }
      m = sql.match(/^UPDATE inventory SET quantity ?= ?quantity - ?\$1 WHERE product_id ?= ?\$2 AND location ?= ?\$3( AND quantity ?>= ?\$1)?/i);
      if (m) {
        const [qty, productId, location] = params;
        const row = state.inventory.find(r => r.product_id === productId && r.location === location);
        if (!row || (m[1] && row.quantity < qty)) return { rows: [], rowCount: 0 };
        row.quantity -= qty;
        return { rows: [{ id: row.id }], rowCount: 1 };
      }
      if (/^INSERT INTO inventory ?\(product_id, ?location, ?quantity\) VALUES ?\(\$1, ?\$2, ?\$3\) ON CONFLICT \(product_id, ?location\) DO UPDATE SET quantity ?= ?inventory\.quantity ?\+ ?EXCLUDED\.quantity/i.test(sql)) {
        const [productId, location, qty] = params;
        let row = state.inventory.find(r => r.product_id === productId && r.location === location);
        if (row) row.quantity += qty;
        else {
          row = { id: nextInvId++, product_id: productId, location, quantity: qty };
          state.inventory.push(row);
        }
        return { rows: [{ ...row }], rowCount: 1 };
      }
      m = sql.match(/^INSERT INTO sales ?\(([^)]*)\) VALUES/i);
      if (m) {
        const row = { id: nextSaleId++ };
        m[1].split(',').map(c => c.trim()).forEach((col, i) => { row[col] = params[i]; });
        state.sales.push(row);
        return { rows: [{ ...row }], rowCount: 1 };
      }
      m = sql.match(/^UPDATE sales SET status ?= ?\$1 WHERE id ?= ?\$2/i);
      if (m) {
        const row = state.sales.find(s => s.id === Number(params[1]));
        if (row) row.status = params[0];
        return { rows: [], rowCount: row ? 1 : 0 };
      }
      if (/^DELETE FROM sales WHERE id ?= ?\$1/i.test(sql)) {
        const i = state.sales.findIndex(s => s.id === Number(params[0]));
        if (i >= 0) state.sales.splice(i, 1);
        return { rows: [], rowCount: i >= 0 ? 1 : 0 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    })
  };
  db.transaction.mockImplementation(async cb => {
    const snapshot = JSON.parse(JSON.stringify({ inventory: state.inventory, sales: state.sales }));
    try {
      return await cb(client);
    } catch (err) {
      state.inventory = snapshot.inventory;
      state.sales = snapshot.sales;
      throw err;
    }
  });
  state.qty = (product_id, location) => {
    const row = state.inventory.find(r => r.product_id === product_id && r.location === location);
    return row ? row.quantity : undefined;
  };
  state.writes = () => state.log.filter(sql => /^(UPDATE|INSERT|DELETE)/i.test(sql));
  return state;
}

async function rejection(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected promise to reject');
}

const inv = (id, product_id, location, quantity) => ({ id, product_id, location, quantity });
const sale = (id, overrides = {}) => ({
  id, product_id: 1, location: 'retail', quantity: 3, price: 10, discount: 0, gst: 1, status: 'sold', user_id: 1,
  ...overrides
});
const newSale = (overrides = {}) => ({
  product_id: 1, location: 'retail', quantity: 3, price: 10, gst: 1, user_id: 1, ...overrides
});

describe('Sales model', () => {
  afterEach(() => jest.clearAllMocks());

  test('getAll default', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await Sales.getAll();
    expect(db.query).toHaveBeenCalledWith(
      'SELECT * FROM sales ORDER BY id LIMIT $1 OFFSET $2',
      [10, 0]
    );
  });

  test('getAll with params', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await Sales.getAll({ limit: 2, offset: 2 });
    expect(db.query).toHaveBeenCalledWith(
      'SELECT * FROM sales ORDER BY id LIMIT $1 OFFSET $2',
      [2, 2]
    );
  });

  describe('create', () => {
    test('S-M1 sold decrements the location and stores it on the sale', async () => {
      const s = useFakeDb({ inventory: [inv(1, 1, 'retail', 10)] });
      const record = await Sales.create(newSale({ status: 'sold' }));
      expect(s.qty(1, 'retail')).toBe(7);
      expect(record).toMatchObject({ product_id: 1, location: 'retail', status: 'sold', quantity: 3 });
      expect(s.sales).toHaveLength(1);
      expect(s.sales[0].location).toBe('retail');
    });

    test('S-M2 sold leaves other locations of the same product unchanged', async () => {
      const s = useFakeDb({ inventory: [inv(1, 1, 'retail', 10), inv(2, 1, 'production', 10), inv(3, 2, 'retail', 10)] });
      await Sales.create(newSale());
      expect(s.qty(1, 'retail')).toBe(7);
      expect(s.qty(1, 'production')).toBe(10);
      expect(s.qty(2, 'retail')).toBe(10);
    });

    test('S-M3 defaults status to sold', async () => {
      const s = useFakeDb({ inventory: [inv(1, 1, 'retail', 10)] });
      const record = await Sales.create(newSale());
      expect(record.status).toBe('sold');
      expect(s.qty(1, 'retail')).toBe(7);
    });

    test('S-M4 sold for exactly the stock leaves the row at 0', async () => {
      const s = useFakeDb({ inventory: [inv(1, 1, 'retail', 3)] });
      await Sales.create(newSale({ quantity: 3 }));
      expect(s.qty(1, 'retail')).toBe(0);
      expect(s.sales).toHaveLength(1);
    });

    test('S-M5 sold for more than the stock rejects, with no sale row and stock unchanged', async () => {
      const s = useFakeDb({ inventory: [inv(1, 1, 'retail', 2)] });
      const err = await rejection(Sales.create(newSale({ quantity: 3 })));
      expect(err.code).toBe('INSUFFICIENT_STOCK');
      expect(err.message).toBe('Insufficient stock');
      expect(s.sales).toHaveLength(0);
      expect(s.qty(1, 'retail')).toBe(2);
    });

    test('S-M6 sold when the row has quantity 0 rejects', async () => {
      const s = useFakeDb({ inventory: [inv(1, 1, 'retail', 0)] });
      const err = await rejection(Sales.create(newSale({ quantity: 1 })));
      expect(err.code).toBe('INSUFFICIENT_STOCK');
      expect(s.sales).toHaveLength(0);
    });

    test('S-M7 sold with no inventory row at the location rejects with INVENTORY_NOT_FOUND', async () => {
      const s = useFakeDb({ inventory: [inv(1, 1, 'production', 10)] });
      const err = await rejection(Sales.create(newSale({ status: 'sold' })));
      expect(err.code).toBe('INVENTORY_NOT_FOUND');
      expect(s.sales).toHaveLength(0);
      expect(s.qty(1, 'production')).toBe(10);
    });

    test('S-M8 order_created with no inventory row rejects with INVENTORY_NOT_FOUND', async () => {
      const s = useFakeDb({ inventory: [] });
      const err = await rejection(Sales.create(newSale({ status: 'order_created' })));
      expect(err.code).toBe('INVENTORY_NOT_FOUND');
      expect(s.sales).toHaveLength(0);
    });

    test('S-M9 order_created creates the sale and does not touch stock', async () => {
      const s = useFakeDb({ inventory: [inv(1, 1, 'retail', 10)] });
      const record = await Sales.create(newSale({ status: 'order_created' }));
      expect(record).toMatchObject({ status: 'order_created', location: 'retail' });
      expect(s.qty(1, 'retail')).toBe(10);
      expect(s.log.some(sql => /^UPDATE inventory/i.test(sql))).toBe(false);
    });

    test('S-M10 order_created is created even when quantity exceeds the stock', async () => {
      const s = useFakeDb({ inventory: [inv(1, 1, 'retail', 1)] });
      await Sales.create(newSale({ status: 'order_created', quantity: 5 }));
      expect(s.sales).toHaveLength(1);
      expect(s.qty(1, 'retail')).toBe(1);
    });

    test('S-M11 matches the location case-sensitively', async () => {
      const s = useFakeDb({ inventory: [inv(1, 1, 'retail', 10)] });
      const err = await rejection(Sales.create(newSale({ location: 'Retail' })));
      expect(err.code).toBe('INVENTORY_NOT_FOUND');
      expect(s.qty(1, 'retail')).toBe(10);
      expect(s.sales).toHaveLength(0);
    });

    test('S-M12 a missing row is reported as not found, not as insufficient stock', async () => {
      useFakeDb({ inventory: [] });
      const err = await rejection(Sales.create(newSale({ quantity: 999 })));
      expect(err.code).toBe('INVENTORY_NOT_FOUND');
    });

    test('S-M13 the sold decrement is a conditional UPDATE', async () => {
      const s = useFakeDb({ inventory: [inv(1, 1, 'retail', 10)] });
      await Sales.create(newSale());
      const decrement = s.log.find(sql => /^UPDATE inventory/i.test(sql));
      expect(decrement).toMatch(/quantity ?>= ?\$1/);
    });
  });

  describe('updateStatus', () => {
    test('P-M1 returns null for an unknown id and writes nothing', async () => {
      const s = useFakeDb({ inventory: [inv(1, 1, 'retail', 10)] });
      expect(await Sales.updateStatus(999, 'sold')).toBeNull();
      expect(s.writes()).toEqual([]);
    });

    test('P-M2 order_created -> sold decrements only the sale location', async () => {
      const s = useFakeDb({
        inventory: [inv(1, 1, 'retail', 10), inv(2, 1, 'production', 10)],
        sales: [sale(7, { status: 'order_created', location: 'retail', quantity: 4 })]
      });
      const result = await Sales.updateStatus(7, 'sold');
      expect(result.status).toBe('sold');
      expect(s.sales[0].status).toBe('sold');
      expect(s.qty(1, 'retail')).toBe(6);
      expect(s.qty(1, 'production')).toBe(10);
    });

    test('P-M3 order_created -> sold with short stock rejects and keeps the status', async () => {
      const s = useFakeDb({
        inventory: [inv(1, 1, 'retail', 2)],
        sales: [sale(7, { status: 'order_created', quantity: 4 })]
      });
      const err = await rejection(Sales.updateStatus(7, 'sold'));
      expect(err.code).toBe('INSUFFICIENT_STOCK');
      expect(s.sales[0].status).toBe('order_created');
      expect(s.qty(1, 'retail')).toBe(2);
    });

    test('P-M4 order_created -> sold with no inventory row rejects as insufficient stock', async () => {
      const s = useFakeDb({
        inventory: [inv(1, 1, 'production', 10)],
        sales: [sale(7, { status: 'order_created', location: 'retail' })]
      });
      const err = await rejection(Sales.updateStatus(7, 'sold'));
      expect(err.code).toBe('INSUFFICIENT_STOCK');
      expect(s.sales[0].status).toBe('order_created');
      expect(s.qty(1, 'production')).toBe(10);
    });

    test('P-M5 sold -> sold is a no-op even at zero stock', async () => {
      const s = useFakeDb({
        inventory: [inv(1, 1, 'retail', 0)],
        sales: [sale(7, { status: 'sold', quantity: 4 })]
      });
      const result = await Sales.updateStatus(7, 'sold');
      expect(result).toMatchObject({ id: 7, status: 'sold' });
      expect(s.writes()).toEqual([]);
      expect(s.qty(1, 'retail')).toBe(0);
    });

    test('P-M6 order_created -> order_created is a no-op', async () => {
      const s = useFakeDb({
        inventory: [inv(1, 1, 'retail', 5)],
        sales: [sale(7, { status: 'order_created' })]
      });
      const result = await Sales.updateStatus(7, 'order_created');
      expect(result).toMatchObject({ id: 7, status: 'order_created' });
      expect(s.writes()).toEqual([]);
    });

    test('P-M7 sold -> order_created restores stock to the sale location only', async () => {
      const s = useFakeDb({
        inventory: [inv(1, 1, 'retail', 5), inv(2, 1, 'production', 9)],
        sales: [sale(7, { status: 'sold', location: 'retail', quantity: 3 })]
      });
      const result = await Sales.updateStatus(7, 'order_created');
      expect(result.status).toBe('order_created');
      expect(s.sales[0].status).toBe('order_created');
      expect(s.qty(1, 'retail')).toBe(8);
      expect(s.qty(1, 'production')).toBe(9);
    });

    test('P-M8 sold -> order_created re-creates a missing inventory row', async () => {
      const s = useFakeDb({
        inventory: [],
        sales: [sale(7, { status: 'sold', location: 'retail', quantity: 3 })]
      });
      await Sales.updateStatus(7, 'order_created');
      expect(s.qty(1, 'retail')).toBe(3);
    });
  });

  describe('remove', () => {
    test('D-M1 returns null for an unknown id', async () => {
      const s = useFakeDb({ inventory: [inv(1, 1, 'retail', 10)] });
      expect(await Sales.remove(999)).toBeNull();
      expect(s.qty(1, 'retail')).toBe(10);
    });

    test('D-M2 deleting a sold sale restores stock to its location only', async () => {
      const s = useFakeDb({
        inventory: [inv(1, 1, 'retail', 5), inv(2, 1, 'production', 9)],
        sales: [sale(7, { status: 'sold', location: 'retail', quantity: 3 })]
      });
      const removed = await Sales.remove(7);
      expect(removed).toMatchObject({ id: 7 });
      expect(s.sales).toHaveLength(0);
      expect(s.qty(1, 'retail')).toBe(8);
      expect(s.qty(1, 'production')).toBe(9);
    });

    test('D-M3 deleting a sold sale re-creates a missing inventory row', async () => {
      const s = useFakeDb({
        inventory: [],
        sales: [sale(7, { status: 'sold', location: 'retail', quantity: 3 })]
      });
      await Sales.remove(7);
      expect(s.qty(1, 'retail')).toBe(3);
    });

    test('D-M4 deleting an order_created sale does not change stock', async () => {
      const s = useFakeDb({
        inventory: [inv(1, 1, 'retail', 5)],
        sales: [sale(7, { status: 'order_created', quantity: 3 })]
      });
      await Sales.remove(7);
      expect(s.sales).toHaveLength(0);
      expect(s.qty(1, 'retail')).toBe(5);
    });

    test('D-M5 deleting an order_created sale does not create an inventory row', async () => {
      const s = useFakeDb({
        inventory: [],
        sales: [sale(7, { status: 'order_created' })]
      });
      await Sales.remove(7);
      expect(s.inventory).toEqual([]);
    });
  });
});
