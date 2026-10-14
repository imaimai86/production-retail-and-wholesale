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

  test('getAll pages with LIMIT and OFFSET, 10 and 0 by default', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await Sales.getAll();
    expect(db.query).toHaveBeenCalledWith(
      'SELECT * FROM sales ORDER BY id LIMIT $1 OFFSET $2',
      [10, 0]
    );
    await Sales.getAll({ limit: 2, offset: 2 });
    expect(db.query).toHaveBeenCalledWith(
      'SELECT * FROM sales ORDER BY id LIMIT $1 OFFSET $2',
      [2, 2]
    );
  });

  describe('create', () => {
    test('S-M1..4 S-M13 sold (the default status) decrements only the sale location, down to 0, with a conditional UPDATE', async () => {
      let s = useFakeDb({ inventory: [inv(1, 1, 'retail', 10)] });
      let record = await Sales.create(newSale({ status: 'sold' }));
      expect(s.qty(1, 'retail')).toBe(7);
      expect(record).toMatchObject({ product_id: 1, location: 'retail', status: 'sold', quantity: 3 });
      expect(s.sales).toHaveLength(1);
      expect(s.sales[0].location).toBe('retail');
      // S-M13
      expect(s.log.find(sql => /^UPDATE inventory/i.test(sql))).toMatch(/quantity ?>= ?\$1/);

      // S-M2 other locations of the same product, and other products, are unchanged; S-M3 status defaults to sold
      s = useFakeDb({ inventory: [inv(1, 1, 'retail', 10), inv(2, 1, 'production', 10), inv(3, 2, 'retail', 10)] });
      record = await Sales.create(newSale());
      expect(record.status).toBe('sold');
      expect(s.qty(1, 'retail')).toBe(7);
      expect(s.qty(1, 'production')).toBe(10);
      expect(s.qty(2, 'retail')).toBe(10);

      // S-M4 exactly the stock leaves the row at 0
      s = useFakeDb({ inventory: [inv(1, 1, 'retail', 3)] });
      await Sales.create(newSale({ quantity: 3 }));
      expect(s.qty(1, 'retail')).toBe(0);
      expect(s.sales).toHaveLength(1);
    });

    test('S-M5..7 S-M11 S-M12 sold rejects short stock (INSUFFICIENT_STOCK) and a missing row (INVENTORY_NOT_FOUND), writing nothing', async () => {
      // S-M5 more than the stock
      let s = useFakeDb({ inventory: [inv(1, 1, 'retail', 2)] });
      let err = await rejection(Sales.create(newSale({ quantity: 3 })));
      expect(err.code).toBe('INSUFFICIENT_STOCK');
      expect(err.message).toBe('Insufficient stock');
      expect(s.sales).toHaveLength(0);
      expect(s.qty(1, 'retail')).toBe(2);

      // S-M6 the row has quantity 0
      s = useFakeDb({ inventory: [inv(1, 1, 'retail', 0)] });
      err = await rejection(Sales.create(newSale({ quantity: 1 })));
      expect(err.code).toBe('INSUFFICIENT_STOCK');
      expect(s.sales).toHaveLength(0);

      // S-M7 no inventory row at the location
      s = useFakeDb({ inventory: [inv(1, 1, 'production', 10)] });
      err = await rejection(Sales.create(newSale({ status: 'sold' })));
      expect(err.code).toBe('INVENTORY_NOT_FOUND');
      expect(s.sales).toHaveLength(0);
      expect(s.qty(1, 'production')).toBe(10);

      // S-M11 the location is matched case-sensitively
      s = useFakeDb({ inventory: [inv(1, 1, 'retail', 10)] });
      err = await rejection(Sales.create(newSale({ location: 'Retail' })));
      expect(err.code).toBe('INVENTORY_NOT_FOUND');
      expect(s.qty(1, 'retail')).toBe(10);
      expect(s.sales).toHaveLength(0);

      // S-M12 a missing row is not found, not insufficient stock
      useFakeDb({ inventory: [] });
      err = await rejection(Sales.create(newSale({ quantity: 999 })));
      expect(err.code).toBe('INVENTORY_NOT_FOUND');
    });

    test('S-M8..10 order_created needs an inventory row but does not touch stock, even when quantity exceeds it', async () => {
      let s = useFakeDb({ inventory: [] });
      const err = await rejection(Sales.create(newSale({ status: 'order_created' })));
      expect(err.code).toBe('INVENTORY_NOT_FOUND');
      expect(s.sales).toHaveLength(0);

      s = useFakeDb({ inventory: [inv(1, 1, 'retail', 10)] });
      const record = await Sales.create(newSale({ status: 'order_created' }));
      expect(record).toMatchObject({ status: 'order_created', location: 'retail' });
      expect(s.qty(1, 'retail')).toBe(10);
      expect(s.log.some(sql => /^UPDATE inventory/i.test(sql))).toBe(false);

      s = useFakeDb({ inventory: [inv(1, 1, 'retail', 1)] });
      await Sales.create(newSale({ status: 'order_created', quantity: 5 }));
      expect(s.sales).toHaveLength(1);
      expect(s.qty(1, 'retail')).toBe(1);
    });
  });

  describe('updateStatus', () => {
    test('P-M1 P-M5 P-M6 an unknown id returns null and an unchanged status is a no-op: nothing is written', async () => {
      let s = useFakeDb({ inventory: [inv(1, 1, 'retail', 10)] });
      expect(await Sales.updateStatus(999, 'sold')).toBeNull();
      expect(s.writes()).toEqual([]);

      // P-M5 sold -> sold, even at zero stock
      s = useFakeDb({
        inventory: [inv(1, 1, 'retail', 0)],
        sales: [sale(7, { status: 'sold', quantity: 4 })]
      });
      expect(await Sales.updateStatus(7, 'sold')).toMatchObject({ id: 7, status: 'sold' });
      expect(s.writes()).toEqual([]);
      expect(s.qty(1, 'retail')).toBe(0);

      // P-M6 order_created -> order_created
      s = useFakeDb({
        inventory: [inv(1, 1, 'retail', 5)],
        sales: [sale(7, { status: 'order_created' })]
      });
      expect(await Sales.updateStatus(7, 'order_created')).toMatchObject({ id: 7, status: 'order_created' });
      expect(s.writes()).toEqual([]);
    });

    test('P-M2..4 order_created -> sold decrements only the sale location; short stock or no row rejects and keeps the status', async () => {
      let s = useFakeDb({
        inventory: [inv(1, 1, 'retail', 10), inv(2, 1, 'production', 10)],
        sales: [sale(7, { status: 'order_created', location: 'retail', quantity: 4 })]
      });
      const result = await Sales.updateStatus(7, 'sold');
      expect(result.status).toBe('sold');
      expect(s.sales[0].status).toBe('sold');
      expect(s.qty(1, 'retail')).toBe(6);
      expect(s.qty(1, 'production')).toBe(10);

      // P-M3 short stock
      s = useFakeDb({
        inventory: [inv(1, 1, 'retail', 2)],
        sales: [sale(7, { status: 'order_created', quantity: 4 })]
      });
      let err = await rejection(Sales.updateStatus(7, 'sold'));
      expect(err.code).toBe('INSUFFICIENT_STOCK');
      expect(s.sales[0].status).toBe('order_created');
      expect(s.qty(1, 'retail')).toBe(2);

      // P-M4 no inventory row is also insufficient stock
      s = useFakeDb({
        inventory: [inv(1, 1, 'production', 10)],
        sales: [sale(7, { status: 'order_created', location: 'retail' })]
      });
      err = await rejection(Sales.updateStatus(7, 'sold'));
      expect(err.code).toBe('INSUFFICIENT_STOCK');
      expect(s.sales[0].status).toBe('order_created');
      expect(s.qty(1, 'production')).toBe(10);
    });

    test('P-M7 P-M8 sold -> order_created restores stock to the sale location only, re-creating a missing row', async () => {
      let s = useFakeDb({
        inventory: [inv(1, 1, 'retail', 5), inv(2, 1, 'production', 9)],
        sales: [sale(7, { status: 'sold', location: 'retail', quantity: 3 })]
      });
      const result = await Sales.updateStatus(7, 'order_created');
      expect(result.status).toBe('order_created');
      expect(s.sales[0].status).toBe('order_created');
      expect(s.qty(1, 'retail')).toBe(8);
      expect(s.qty(1, 'production')).toBe(9);

      s = useFakeDb({
        inventory: [],
        sales: [sale(7, { status: 'sold', location: 'retail', quantity: 3 })]
      });
      await Sales.updateStatus(7, 'order_created');
      expect(s.qty(1, 'retail')).toBe(3);
    });
  });

  describe('remove', () => {
    test('D-M1..3 an unknown id returns null; deleting a sold sale restores stock to its location only, re-creating a missing row', async () => {
      let s = useFakeDb({ inventory: [inv(1, 1, 'retail', 10)] });
      expect(await Sales.remove(999)).toBeNull();
      expect(s.qty(1, 'retail')).toBe(10);

      s = useFakeDb({
        inventory: [inv(1, 1, 'retail', 5), inv(2, 1, 'production', 9)],
        sales: [sale(7, { status: 'sold', location: 'retail', quantity: 3 })]
      });
      expect(await Sales.remove(7)).toMatchObject({ id: 7 });
      expect(s.sales).toHaveLength(0);
      expect(s.qty(1, 'retail')).toBe(8);
      expect(s.qty(1, 'production')).toBe(9);

      s = useFakeDb({
        inventory: [],
        sales: [sale(7, { status: 'sold', location: 'retail', quantity: 3 })]
      });
      await Sales.remove(7);
      expect(s.qty(1, 'retail')).toBe(3);
    });

    test('D-M4 D-M5 deleting an order_created sale neither changes stock nor creates an inventory row', async () => {
      let s = useFakeDb({
        inventory: [inv(1, 1, 'retail', 5)],
        sales: [sale(7, { status: 'order_created', quantity: 3 })]
      });
      await Sales.remove(7);
      expect(s.sales).toHaveLength(0);
      expect(s.qty(1, 'retail')).toBe(5);

      s = useFakeDb({
        inventory: [],
        sales: [sale(7, { status: 'order_created' })]
      });
      await Sales.remove(7);
      expect(s.inventory).toEqual([]);
    });
  });
});
