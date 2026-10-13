CREATE TABLE IF NOT EXISTS menu (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  item TEXT NOT NULL,
  variant TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL DEFAULT 0,
  available INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  items_text TEXT NOT NULL,
  total INTEGER NOT NULL,
  method TEXT NOT NULL,
  pay_status TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'New',
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS login_fails (ip TEXT PRIMARY KEY, n INTEGER NOT NULL, t INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS seq (day TEXT PRIMARY KEY, n INTEGER NOT NULL);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('accepting', 'YES'),
  ('pause_message', 'We are very busy right now and have paused online orders for a short while. Please try again soon or order at the stall.');

-- Items with price 0 are hidden from customers until you set a price in the admin page.
INSERT INTO menu (category, item, variant, price, available, sort) VALUES
  ('Made fresh', 'Tea', '', 15, 1, 1),
  ('Made fresh', 'Omelette', 'Oil', 40, 1, 2),
  ('Made fresh', 'Omelette', 'Butter', 60, 1, 3),
  ('Ready-made', 'Patties', 'Aloo', 20, 1, 4),
  ('Ready-made', 'Patties', 'Paneer', 25, 1, 5),
  ('Ready-made', 'Cold drinks', '', 0, 1, 6),
  ('Ready-made', 'Ice cream', '', 0, 1, 7),
  ('Ready-made', 'Ice cubes', '', 20, 1, 8),
  ('Ready-made', 'Chocolates', '', 0, 1, 9),
  ('Ready-made', 'Water bottle', '½ L', 10, 1, 10),
  ('Ready-made', 'Water bottle', '1 L', 20, 1, 11),
  ('Ready-made', 'Water bottle', '2 L', 30, 1, 12),
  ('Ready-made', 'Juice', '', 0, 1, 13),
  ('Ready-made', 'Butter', '', 0, 1, 14),
  ('Ready-made', 'Maggi', '', 15, 1, 15),
  ('Ready-made', 'Yippee noodles', '', 15, 1, 16),
  ('Ready-made', 'Biscuits', '', 0, 1, 17),
  ('Ready-made', 'Packaged snacks', '', 0, 1, 18),
  ('Ready-made', 'Bread', '', 0, 1, 19);
