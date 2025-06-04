# Database Schema (PostgreSQL)

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  price_retail NUMERIC NOT NULL,
  price_wholesale NUMERIC NOT NULL
);

CREATE TABLE batches (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id),
  quantity INTEGER NOT NULL,
  completed BOOLEAN DEFAULT false
);

CREATE TABLE inventory (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id),
  location TEXT NOT NULL,
  quantity INTEGER NOT NULL
);

CREATE TABLE sales (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id),
  quantity INTEGER NOT NULL,
  price NUMERIC NOT NULL,
  discount NUMERIC DEFAULT 0,
  gst NUMERIC NOT NULL,
  user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```
