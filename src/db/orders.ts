import { pool } from './pool';
import { OrderState } from '../lib/stateMachine';
import { log } from '../lib/logger';

export interface OrderRow {
  id: string;
  external_ref: string | null;
  state: OrderState;
  priority: number;
  created_at: Date;
  updated_at: Date;
  error_msg: string | null;
}

export interface OrderItemInput {
  sku: string;
  quantity: number;
}

export async function createOrder(
  items: OrderItemInput[],
  externalRef?: string,
  priority = 1
): Promise<OrderRow> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query<OrderRow>(
      `INSERT INTO orders (external_ref, priority)
       VALUES ($1, $2)
       RETURNING *`,
      [externalRef ?? null, priority]
    );
    const order = rows[0];

    for (const item of items) {
      await client.query(
        `INSERT INTO order_items (order_id, sku, quantity) VALUES ($1, $2, $3)`,
        [order.id, item.sku, item.quantity]
      );
    }

    await client.query(
      `INSERT INTO state_transitions (order_id, from_state, to_state, note)
       VALUES ($1, NULL, 'received', 'Order created')`,
      [order.id]
    );

    await client.query('COMMIT');
    log.info({ orderId: order.id, items }, 'order.created');
    return order;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getOrderById(id: string): Promise<OrderRow | null> {
  const { rows } = await pool.query<OrderRow>(
    `SELECT * FROM orders WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function listOrders(limit = 50): Promise<OrderRow[]> {
  const { rows } = await pool.query<OrderRow>(
    `SELECT * FROM orders ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function getOrderItems(orderId: string) {
  const { rows } = await pool.query(
    `SELECT oi.sku, oi.quantity, i.description, i.location
     FROM order_items oi
     JOIN inventory i ON i.sku = oi.sku
     WHERE oi.order_id = $1`,
    [orderId]
  );
  return rows;
}

export async function getStateHistory(orderId: string) {
  const { rows } = await pool.query(
    `SELECT from_state, to_state, occurred_at, note
     FROM state_transitions
     WHERE order_id = $1
     ORDER BY occurred_at ASC`,
    [orderId]
  );
  return rows;
}

export async function transitionOrder(
  orderId: string,
  from: OrderState,
  to: OrderState,
  note?: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE orders SET state = $1 WHERE id = $2 AND state = $3`,
      [to, orderId, from]
    );
    await client.query(
      `INSERT INTO state_transitions (order_id, from_state, to_state, note)
       VALUES ($1, $2, $3, $4)`,
      [orderId, from, to, note ?? null]
    );

    await client.query('COMMIT');
    log.info({ orderId, from, to, note }, 'order.transition');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function failOrder(orderId: string, from: OrderState, reason: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE orders SET state = 'failed', error_msg = $1 WHERE id = $2`,
      [reason, orderId]
    );
    await client.query(
      `INSERT INTO state_transitions (order_id, from_state, to_state, note)
       VALUES ($1, $2, 'failed', $3)`,
      [orderId, from, reason]
    );
    await client.query('COMMIT');
    log.warn({ orderId, from, reason }, 'order.failed');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getMetrics() {
  const { rows } = await pool.query(`
    SELECT
      state,
      COUNT(*) AS count
    FROM orders
    GROUP BY state
  `);

  const stateCounts: Record<string, number> = {};
  for (const row of rows) stateCounts[row.state] = Number(row.count);

  const { rows: throughputRows } = await pool.query(`
    SELECT COUNT(*) AS delivered_last_hour
    FROM state_transitions
    WHERE to_state = 'delivered'
      AND occurred_at >= NOW() - INTERVAL '1 hour'
  `);

  const { rows: avgRows } = await pool.query(`
    SELECT ROUND(AVG(EXTRACT(EPOCH FROM (updated_at - created_at))), 1) AS avg_seconds
    FROM orders
    WHERE state = 'delivered'
  `);

  const { rows: stuckRows } = await pool.query(`
    SELECT COUNT(*) AS stuck
    FROM orders
    WHERE state NOT IN ('delivered', 'failed')
      AND updated_at < NOW() - INTERVAL '5 minutes'
  `);

  return {
    by_state:             stateCounts,
    delivered_last_hour:  Number(throughputRows[0]?.delivered_last_hour ?? 0),
    avg_fulfillment_secs: Number(avgRows[0]?.avg_seconds ?? 0),
    stuck_orders:         Number(stuckRows[0]?.stuck ?? 0),
  };
}
