BEGIN;

ALTER TABLE sales ADD COLUMN IF NOT EXISTS location TEXT;

UPDATE sales SET location = 'retail' WHERE location IS NULL;

UPDATE inventory i SET quantity = s.total
  FROM (SELECT MIN(id) AS keep_id, SUM(quantity) AS total FROM inventory GROUP BY product_id, location) s
  WHERE i.id = s.keep_id;

DELETE FROM inventory i USING (SELECT MIN(id) AS keep_id, product_id, location FROM inventory GROUP BY product_id, location) k
  WHERE i.product_id = k.product_id AND i.location = k.location AND i.id <> k.keep_id;

ALTER TABLE inventory ADD CONSTRAINT inventory_product_location_key UNIQUE (product_id, location);

COMMIT;
