const fs = require('fs');
const path = require('path');

const migrationPath = path.join(__dirname, '../../migrations/002_sales_location.sql');
const schemaPath = path.join(__dirname, '../../schema.sql');

const squash = s => s.replace(/\s+/g, ' ');

describe('002_sales_location.sql', () => {
  let sql;
  beforeAll(() => {
    sql = fs.existsSync(migrationPath) ? squash(fs.readFileSync(migrationPath, 'utf8')) : '';
  });

  test('file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  test('adds sales.location as text', () => {
    expect(sql).toMatch(/ALTER TABLE sales ADD COLUMN (IF NOT EXISTS )?location TEXT/i);
  });

  test('backfills existing sales with retail', () => {
    expect(sql).toMatch(/UPDATE sales SET location ?= ?'retail'/i);
  });

  test('merges duplicate inventory rows by summing', () => {
    expect(sql).toMatch(/SUM\(quantity\)/i);
    expect(sql).toMatch(/DELETE FROM inventory/i);
  });

  test('adds a unique constraint on inventory(product_id, location)', () => {
    expect(sql).toMatch(/ALTER TABLE inventory ADD CONSTRAINT \w+ UNIQUE ?\(product_id, ?location\)/i);
  });

  test('runs in order: column, backfill, merge, constraint', () => {
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
  let schema;
  beforeAll(() => {
    schema = squash(fs.readFileSync(schemaPath, 'utf8'));
  });

  test('sales has a location column', () => {
    const block = schema.match(/CREATE TABLE IF NOT EXISTS sales \((.*?)\);/i);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/\blocation TEXT/i);
  });

  test('inventory is unique on (product_id, location)', () => {
    const block = schema.match(/CREATE TABLE IF NOT EXISTS inventory \((.*?)\);/i);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/UNIQUE ?\(product_id, ?location\)/i);
  });
});
