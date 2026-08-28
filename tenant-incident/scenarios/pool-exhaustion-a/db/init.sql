-- Seed the orders table the service reads. The datastore is deliberately ample:
-- max_connections=100 (set in docker-compose.yml) is far above the pool max, so
-- the ceiling under load is the client pool, never the database.

CREATE TABLE IF NOT EXISTS orders (
  id    integer PRIMARY KEY,
  sku   text    NOT NULL,
  price numeric NOT NULL
);

INSERT INTO orders (id, sku, price) VALUES
  (1, 'SKU-1', 19.99),
  (2, 'SKU-2', 29.99),
  (3, 'SKU-3',  9.99),
  (4, 'SKU-4', 49.99),
  (5, 'SKU-5', 14.99)
ON CONFLICT (id) DO NOTHING;
