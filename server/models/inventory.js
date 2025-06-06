const db = require('./db');

async function transfer(product_id, from_location_id, to_location_id, quantity, dbClient = null) {
  // Assuming 'from' and 'to' are location IDs (integers)
  const operation = async (client) => {
    // Decrease quantity from source location
    const decreaseResult = await client.query(
      'UPDATE inventory SET quantity = quantity - $1 WHERE product_id = $2 AND location_id = $3 RETURNING *',
      [quantity, product_id, from_location_id]
    );
    // Optional: Check if decreaseResult.rowCount === 0, meaning source item not found or insufficient quantity (though DB constraint should handle this)

    // Increase quantity in destination location or insert new record
    const { rows } = await client.query(
      'INSERT INTO inventory(product_id, location_id, quantity) VALUES($1, $2, $3) ON CONFLICT (product_id, location_id) DO UPDATE SET quantity = inventory.quantity + EXCLUDED.quantity RETURNING *',
      [product_id, to_location_id, quantity]
    );
    return rows[0]; // Return the state of the destination inventory item
  };

  if (dbClient) {
    return operation(dbClient);
  } else {
    return db.transaction(operation);
  }
}

async function getAll({ limit = 10, offset = 0 } = {}, dbClient = null) {
  const client = dbClient || db;
  const { rows } = await client.query(
    'SELECT * FROM inventory ORDER BY id LIMIT $1 OFFSET $2', // Assuming 'id' is the primary key for ordering
    [limit, offset]
  );
  return rows;
}

module.exports = { transfer, getAll };
