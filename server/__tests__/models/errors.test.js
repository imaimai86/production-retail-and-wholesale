const { insufficientStock, inventoryNotFound } = require('../../models/errors');

describe('model errors', () => {
  test('insufficientStock', () => {
    const err = insufficientStock();
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Insufficient stock');
    expect(err.code).toBe('INSUFFICIENT_STOCK');
  });

  test('inventoryNotFound', () => {
    const err = inventoryNotFound();
    expect(err).toBeInstanceOf(Error);
    expect(typeof err.message).toBe('string');
    expect(err.message).not.toBe('');
    expect(err.code).toBe('INVENTORY_NOT_FOUND');
  });
});
