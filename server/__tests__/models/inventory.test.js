jest.mock('../../models/db', () => ({
  query: jest.fn(),
  transaction: jest.fn()
}));
const db = require('../../models/db');
const Inventory = require('../../models/inventory');

// Stateful fake of the inventory table. It interprets the SQL shapes from plan-1
// (decrement params: [qty, product_id, location]; upsert params: [product_id, location, qty]).
// An UPDATE with `quantity >= $1` is conditional; one without it can go negative.
// db.transaction restores the snapshot when the callback throws, like a real rollback.
function useFakeInventory(rows) {
  const state = { inventory: rows.map(r => ({ ...r })), log: [] };
  let nextId = 100;
  const client = {
    query: jest.fn(async (rawSql, params = []) => {
      const sql = rawSql.replace(/\s+/g, ' ').trim();
      state.log.push(sql);
      let m = sql.match(/^UPDATE inventory SET quantity ?= ?quantity - ?\$1 WHERE product_id ?= ?\$2 AND location ?= ?\$3( AND quantity ?>= ?\$1)?/i);
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
          row = { id: nextId++, product_id: productId, location, quantity: qty };
          state.inventory.push(row);
        }
        return { rows: [{ ...row }], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    })
  };
  db.transaction.mockImplementation(async cb => {
    const snapshot = JSON.parse(JSON.stringify(state.inventory));
    try {
      return await cb(client);
    } catch (err) {
      state.inventory = snapshot;
      throw err;
    }
  });
  state.qty = (product_id, location) => {
    const row = state.inventory.find(r => r.product_id === product_id && r.location === location);
    return row ? row.quantity : undefined;
  };
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

describe('Inventory model', () => {
  afterEach(() => jest.clearAllMocks());

  describe('transfer', () => {
    test('T-M1..3 T-M9 moves stock to a new or existing destination, down to 0 at the source, and touches no other product', async () => {
      let s = useFakeInventory([{ id: 1, product_id: 1, location: 'A', quantity: 10 }]);
      const result = await Inventory.transfer(1, 'A', 'B', 4);
      expect(s.qty(1, 'A')).toBe(6);
      expect(s.qty(1, 'B')).toBe(4);
      // the destination row is returned
      expect(result).toMatchObject({ product_id: 1, location: 'B', quantity: 4 });
      expect(db.transaction).toHaveBeenCalledTimes(1);

      // T-M2 an existing destination is added to and the total conserved
      s = useFakeInventory([
        { id: 1, product_id: 1, location: 'A', quantity: 10 },
        { id: 2, product_id: 1, location: 'B', quantity: 3 }
      ]);
      await Inventory.transfer(1, 'A', 'B', 4);
      expect(s.qty(1, 'A')).toBe(6);
      expect(s.qty(1, 'B')).toBe(7);
      expect(s.qty(1, 'A') + s.qty(1, 'B')).toBe(13);

      // T-M3 exactly the available quantity
      s = useFakeInventory([{ id: 1, product_id: 1, location: 'A', quantity: 5 }]);
      await Inventory.transfer(1, 'A', 'B', 5);
      expect(s.qty(1, 'A')).toBe(0);
      expect(s.qty(1, 'B')).toBe(5);

      // T-M9 other products at the same location are unchanged
      s = useFakeInventory([
        { id: 1, product_id: 1, location: 'A', quantity: 10 },
        { id: 2, product_id: 2, location: 'A', quantity: 10 }
      ]);
      await Inventory.transfer(1, 'A', 'B', 3);
      expect(s.qty(2, 'A')).toBe(10);
      expect(s.qty(2, 'B')).toBeUndefined();
    });

    test('T-M4..8 rejects with INSUFFICIENT_STOCK when the source is short, empty, missing or differs in case, and changes nothing', async () => {
      // T-M4 larger than the source stock
      let s = useFakeInventory([
        { id: 1, product_id: 1, location: 'A', quantity: 5 },
        { id: 2, product_id: 1, location: 'B', quantity: 2 }
      ]);
      let err = await rejection(Inventory.transfer(1, 'A', 'B', 6));
      expect(err.code).toBe('INSUFFICIENT_STOCK');
      expect(err.message).toBe('Insufficient stock');
      expect(s.qty(1, 'A')).toBe(5);
      expect(s.qty(1, 'B')).toBe(2);

      // T-M5 no source row: no destination is created
      s = useFakeInventory([]);
      err = await rejection(Inventory.transfer(1, 'A', 'B', 1));
      expect(err.code).toBe('INSUFFICIENT_STOCK');
      expect(s.qty(1, 'B')).toBeUndefined();
      expect(s.inventory).toEqual([]);

      // T-M6 the source row has quantity 0
      s = useFakeInventory([{ id: 1, product_id: 1, location: 'A', quantity: 0 }]);
      err = await rejection(Inventory.transfer(1, 'A', 'B', 1));
      expect(err.code).toBe('INSUFFICIENT_STOCK');
      expect(s.qty(1, 'A')).toBe(0);
      expect(s.qty(1, 'B')).toBeUndefined();

      // T-M7 the destination is not touched when the source check fails
      s = useFakeInventory([{ id: 1, product_id: 1, location: 'A', quantity: 1 }]);
      await rejection(Inventory.transfer(1, 'A', 'B', 2));
      expect(s.log.some(sql => /^INSERT INTO inventory/i.test(sql))).toBe(false);
      s.inventory.forEach(r => expect(r.quantity).toBeGreaterThanOrEqual(0));

      // T-M8 the source location is matched case-sensitively
      s = useFakeInventory([{ id: 1, product_id: 1, location: 'Retail', quantity: 10 }]);
      err = await rejection(Inventory.transfer(1, 'retail', 'B', 1));
      expect(err.code).toBe('INSUFFICIENT_STOCK');
      expect(s.qty(1, 'Retail')).toBe(10);
    });
  });

  test('getAll pages with LIMIT and OFFSET, 10 and 0 by default', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await Inventory.getAll();
    expect(db.query).toHaveBeenCalledWith(
      'SELECT * FROM inventory ORDER BY id LIMIT $1 OFFSET $2',
      [10, 0]
    );
    await Inventory.getAll({ limit: 3, offset: 6 });
    expect(db.query).toHaveBeenCalledWith(
      'SELECT * FROM inventory ORDER BY id LIMIT $1 OFFSET $2',
      [3, 6]
    );
  });
});
