const fs = require('fs');
const path = require('path');

const migrationPath = path.join(__dirname, '../../migrations/002_sales_location.sql');
const schemaPath = path.join(__dirname, '../../schema.sql');

const squash = s => s.replace(/\s+/g, ' ');

describe('002_sales_location.sql', () => {
  test('adds sales.location, backfills it, merges duplicate inventory rows and adds the unique constraint, in that order', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = squash(fs.readFileSync(migrationPath, 'utf8'));

    expect(sql).toMatch(/ALTER TABLE sales ADD COLUMN (IF NOT EXISTS )?location TEXT/i);
    // existing sales are backfilled with retail
    expect(sql).toMatch(/UPDATE sales SET location ?= ?'retail'/i);
    // duplicate inventory rows are merged by summing
    expect(sql).toMatch(/SUM\(quantity\)/i);
    expect(sql).toMatch(/DELETE FROM inventory/i);
    expect(sql).toMatch(/ALTER TABLE inventory ADD CONSTRAINT \w+ UNIQUE ?\(product_id, ?location\)/i);

    const column = sql.search(/ADD COLUMN/i);
    const backfill = sql.search(/UPDATE sales SET location/i);
    const merge = sql.search(/DELETE FROM inventory/i);
    const unique = sql.search(/ADD CONSTRAINT/i);
    expect(column).toBeGreaterThanOrEqual(0);
    expect(backfill).toBeGreaterThan(column);
    expect(merge).toBeGreaterThan(backfill);
    expect(unique).toBeGreaterThan(merge);
  });
});

describe('schema.sql', () => {
  test('sales has a location column and inventory is unique on (product_id, location)', () => {
    const schema = squash(fs.readFileSync(schemaPath, 'utf8'));

    const sales = schema.match(/CREATE TABLE IF NOT EXISTS sales \((.*?)\);/i);
    expect(sales).not.toBeNull();
    expect(sales[1]).toMatch(/\blocation TEXT/i);

    const inventory = schema.match(/CREATE TABLE IF NOT EXISTS inventory \((.*?)\);/i);
    expect(inventory).not.toBeNull();
    expect(inventory[1]).toMatch(/UNIQUE ?\(product_id, ?location\)/i);
  });
});
