function insufficientStock() {
  return Object.assign(new Error('Insufficient stock'), { code: 'INSUFFICIENT_STOCK' });
}

function inventoryNotFound() {
  return Object.assign(new Error('Inventory not found for product at location'), {
    code: 'INVENTORY_NOT_FOUND'
  });
}

module.exports = { insufficientStock, inventoryNotFound };
