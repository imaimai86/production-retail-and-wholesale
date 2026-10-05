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
    test('T-M1 moves stock to a new destination and returns the destination row', async () => {
      const s = useFakeInventory([{ id: 1, product_id: 1, location: 'A', quantity: 10 }]);
      const result = await Inventory.transfer(1, 'A', 'B', 4);
      expect(s.qty(1, 'A')).toBe(6);
      expect(s.qty(1, 'B')).toBe(4);
      expect(result).toMatchObject({ product_id: 1, location: 'B', quantity: 4 });
      expect(db.transaction).toHaveBeenCalledTimes(1);
    });

    test('T-M2 adds to an existing destination and conserves the total', async () => {
      const s = useFakeInventory([
        { id: 1, product_id: 1, location: 'A', quantity: 10 },
        { id: 2, product_id: 1, location: 'B', quantity: 3 }
      ]);
      await Inventory.transfer(1, 'A', 'B', 4);
      expect(s.qty(1, 'A')).toBe(6);
      expect(s.qty(1, 'B')).toBe(7);
      expect(s.qty(1, 'A') + s.qty(1, 'B')).toBe(13);
    });

    test('T-M3 transfers exactly the available quantity, leaving the source at 0', async () => {
      const s = useFakeInventory([{ id: 1, product_id: 1, location: 'A', quantity: 5 }]);
      await Inventory.transfer(1, 'A', 'B', 5);
      expect(s.qty(1, 'A')).toBe(0);
      expect(s.qty(1, 'B')).toBe(5);
    });

    test('T-M4 rejects a transfer larger than the source stock and changes nothing', async () => {
      const s = useFakeInventory([
        { id: 1, product_id: 1, location: 'A', quantity: 5 },
        { id: 2, product_id: 1, location: 'B', quantity: 2 }
      ]);
      const err = await rejection(Inventory.transfer(1, 'A', 'B', 6));
      expect(err.code).toBe('INSUFFICIENT_STOCK');
      expect(err.message).toBe('Insufficient stock');
      expect(s.qty(1, 'A')).toBe(5);
      expect(s.qty(1, 'B')).toBe(2);
    });

    test('T-M5 rejects when the source row does not exist and creates no destination', async () => {
      const s = useFakeInventory([]);
      const err = await rejection(Inventory.transfer(1, 'A', 'B', 1));
      expect(err.code).toBe('INSUFFICIENT_STOCK');
      expect(s.qty(1, 'B')).toBeUndefined();
      expect(s.inventory).toEqual([]);
    });

    test('T-M6 rejects when the source row has quantity 0', async () => {
      const s = useFakeInventory([{ id: 1, product_id: 1, location: 'A', quantity: 0 }]);
      const err = await rejection(Inventory.transfer(1, 'A', 'B', 1));
      expect(err.code).toBe('INSUFFICIENT_STOCK');
      expect(s.qty(1, 'A')).toBe(0);
      expect(s.qty(1, 'B')).toBeUndefined();
    });

    test('T-M7 does not touch the destination when the source check fails', async () => {
      const s = useFakeInventory([{ id: 1, product_id: 1, location: 'A', quantity: 1 }]);
      await rejection(Inventory.transfer(1, 'A', 'B', 2));
      expect(s.log.some(sql => /^INSERT INTO inventory/i.test(sql))).toBe(false);
      s.inventory.forEach(r => expect(r.quantity).toBeGreaterThanOrEqual(0));
    });

    test('T-M8 matches the source location case-sensitively', async () => {
      const s = useFakeInventory([{ id: 1, product_id: 1, location: 'Retail', quantity: 10 }]);
      const err = await rejection(Inventory.transfer(1, 'retail', 'B', 1));
      expect(err.code).toBe('INSUFFICIENT_STOCK');
      expect(s.qty(1, 'Retail')).toBe(10);
    });

    test('T-M9 leaves other products at the same location unchanged', async () => {
      const s = useFakeInventory([
        { id: 1, product_id: 1, location: 'A', quantity: 10 },
        { id: 2, product_id: 2, location: 'A', quantity: 10 }
      ]);
      await Inventory.transfer(1, 'A', 'B', 3);
      expect(s.qty(2, 'A')).toBe(10);
      expect(s.qty(2, 'B')).toBeUndefined();
    });
  });

  test('getAll default', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await Inventory.getAll();
    expect(db.query).toHaveBeenCalledWith(
      'SELECT * FROM inventory ORDER BY id LIMIT $1 OFFSET $2',
      [10, 0]
    );
  });

  test('getAll with params', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await Inventory.getAll({ limit: 3, offset: 6 });
    expect(db.query).toHaveBeenCalledWith(
      'SELECT * FROM inventory ORDER BY id LIMIT $1 OFFSET $2',
      [3, 6]
    );
  });
});
