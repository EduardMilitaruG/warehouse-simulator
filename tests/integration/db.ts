import fs from 'fs';
import path from 'path';
import { pool } from '../../src/db/pool';
import { createOrder, OrderRow } from '../../src/db/orders';

const schema = fs.readFileSync(path.join(__dirname, '..', '..', 'sql', '001_schema.sql'), 'utf8');

/** Drops everything and reapplies the schema + inventory seed. */
export async function resetDb(): Promise<void> {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await pool.query(schema);
}

export function makeOrder(priority = 1): Promise<OrderRow> {
  return createOrder([{ sku: 'SKU-001', quantity: 1 }], undefined, priority);
}

export async function stateOf(id: string): Promise<string> {
  const { rows } = await pool.query('SELECT state FROM orders WHERE id = $1', [id]);
  return rows[0].state;
}

export async function transitionsOf(id: string): Promise<{ from_state: string | null; to_state: string }[]> {
  const { rows } = await pool.query(
    'SELECT from_state, to_state FROM state_transitions WHERE order_id = $1 ORDER BY id',
    [id]
  );
  return rows;
}

export { pool };
