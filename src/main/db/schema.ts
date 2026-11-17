// Versioned migrations. Never edit a released migration; add a new one.
export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id),
  permission TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  pin_hash TEXT,
  role_id TEXT NOT NULL REFERENCES roles(id),
  discount_limit_pct REAL NOT NULL DEFAULT 10 CHECK (discount_limit_pct >= 0 AND discount_limit_pct <= 100),
  active INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  device_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  parent_id TEXT REFERENCES categories(id),
  active INTEGER NOT NULL DEFAULT 1,
  device_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sizes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  code TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE colors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  code TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  product_no INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  brand TEXT,
  description TEXT,
  category_id TEXT REFERENCES categories(id),
  image_path TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  device_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE product_variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  size_id TEXT REFERENCES sizes(id),
  color_id TEXT REFERENCES colors(id),
  sku TEXT NOT NULL UNIQUE,
  barcode TEXT NOT NULL UNIQUE,
  cost_price REAL NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  sell_price REAL NOT NULL DEFAULT 0 CHECK (sell_price >= 0),
  stock_qty INTEGER NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 2 CHECK (reorder_level >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  device_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (product_id, size_id, color_id)
);
CREATE INDEX idx_variants_product ON product_variants(product_id);

CREATE TABLE variant_barcodes (
  barcode TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL REFERENCES product_variants(id),
  created_at TEXT NOT NULL
);

CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  device_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE purchases (
  id TEXT PRIMARY KEY,
  supplier_id TEXT REFERENCES suppliers(id),
  supplier_invoice_no TEXT,
  received_at TEXT NOT NULL,
  total_cost REAL NOT NULL DEFAULT 0,
  user_id TEXT NOT NULL REFERENCES users(id),
  note TEXT,
  device_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE purchase_items (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES purchases(id),
  variant_id TEXT NOT NULL REFERENCES product_variants(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_cost REAL NOT NULL CHECK (unit_cost >= 0)
);

CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL REFERENCES product_variants(id),
  type TEXT NOT NULL CHECK (type IN ('opening','purchase','sale','void','adjustment')),
  qty_change INTEGER NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  user_id TEXT REFERENCES users(id),
  reason TEXT,
  device_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_movements_variant ON stock_movements(variant_id, created_at);

CREATE TABLE sales (
  id TEXT PRIMARY KEY,
  invoice_no TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('draft','held','completed','voided','discarded')),
  cashier_id TEXT NOT NULL REFERENCES users(id),
  draft_json TEXT,
  subtotal REAL NOT NULL DEFAULT 0,
  discount_total REAL NOT NULL DEFAULT 0,
  grand_total REAL NOT NULL DEFAULT 0,
  cost_total REAL NOT NULL DEFAULT 0,
  approved_by TEXT REFERENCES users(id),
  voided_by TEXT REFERENCES users(id),
  void_reason TEXT,
  voided_at TEXT,
  device_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_sales_status ON sales(status, completed_at);
CREATE INDEX idx_sales_cashier ON sales(cashier_id, completed_at);

CREATE TABLE sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  variant_id TEXT NOT NULL REFERENCES product_variants(id),
  description TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price REAL NOT NULL CHECK (unit_price >= 0),
  unit_cost REAL NOT NULL CHECK (unit_cost >= 0),
  line_discount REAL NOT NULL DEFAULT 0 CHECK (line_discount >= 0),
  line_total REAL NOT NULL CHECK (line_total >= 0)
);
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX idx_sale_items_variant ON sale_items(variant_id);

CREATE TABLE sale_payments (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  method TEXT NOT NULL CHECK (method IN ('cash','card','bkash','nagad')),
  amount REAL NOT NULL CHECK (amount >= 0),
  reference TEXT,
  tendered REAL,
  change_given REAL
);
CREATE INDEX idx_sale_payments_sale ON sale_payments(sale_id);

CREATE TABLE invoice_counters (
  day TEXT PRIMARY KEY,
  last_no INTEGER NOT NULL
);

CREATE TABLE cash_counts (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  expected REAL NOT NULL,
  counted REAL NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE activity_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_activity_created ON activity_log(created_at);

CREATE TABLE backup_log (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  size INTEGER,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL
);

-- Empty in the MVP. A future cloud sync service reads this queue.
CREATE TABLE sync_outbox (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  op TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  synced_at TEXT
);
`
  }
]
