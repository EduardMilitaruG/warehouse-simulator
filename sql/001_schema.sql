-- Warehouse Order Simulator — initial schema

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Inventory ───────────────────────────────────────────────────────────────

CREATE TABLE inventory (
  sku         VARCHAR(32) PRIMARY KEY,
  description VARCHAR(255) NOT NULL,
  quantity    INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  location    VARCHAR(16) NOT NULL  -- shelf location e.g. "A-12-3"
);

-- ─── Orders ──────────────────────────────────────────────────────────────────

CREATE TYPE order_state AS ENUM (
  'received',
  'picking',
  'packing',
  'shipping',
  'delivered',
  'failed'
);

CREATE TABLE orders (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  external_ref VARCHAR(64),                             -- caller's reference ID
  state        order_state NOT NULL DEFAULT 'received',
  priority     SMALLINT NOT NULL DEFAULT 1 CHECK (priority BETWEEN 1 AND 5),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error_msg    TEXT                                     -- set on failure
);

CREATE TABLE order_items (
  id         BIGSERIAL PRIMARY KEY,
  order_id   UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sku        VARCHAR(32) NOT NULL REFERENCES inventory(sku),
  quantity   INTEGER NOT NULL CHECK (quantity > 0)
);

-- ─── State transition audit log ──────────────────────────────────────────────

CREATE TABLE state_transitions (
  id         BIGSERIAL PRIMARY KEY,
  order_id   UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_state order_state,
  to_state   order_state NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note       TEXT
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX idx_orders_state     ON orders(state);
CREATE INDEX idx_orders_created   ON orders(created_at DESC);
CREATE INDEX idx_transitions_order ON state_transitions(order_id, occurred_at DESC);

-- ─── Update trigger for orders.updated_at ────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Seed inventory ──────────────────────────────────────────────────────────

INSERT INTO inventory (sku, description, quantity, location) VALUES
  ('SKU-001', 'Industrial sensor bracket',  50, 'A-01-1'),
  ('SKU-002', 'Conveyor belt segment 1m',   12, 'B-03-2'),
  ('SKU-003', 'RFID scanner head',          30, 'A-02-4'),
  ('SKU-004', 'Picking robot arm mount',     8, 'C-01-1'),
  ('SKU-005', 'Barcode label roll 1000pcs', 200,'D-04-2'),
  ('SKU-006', 'Emergency stop button',      40, 'A-01-3'),
  ('SKU-007', 'PLC cable assembly 3m',      25, 'B-02-1'),
  ('SKU-008', 'Weight sensor module',       18, 'C-02-3');
