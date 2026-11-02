import { PoolClient } from 'pg';
import { pool } from './pool';
import { OrderState, canTransition } from '../lib/stateMachine';
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

/**
 * Thrown when an order is no longer in the state the caller expected,
 * e.g. another worker moved it first. Nothing is written in that case.
 */
export class StaleTransitionError extends Error {
  constructor(orderId: string, from: OrderState, to: OrderState) {
    super(`Order ${orderId} is no longer '${from}', cannot move to '${to}'`);
    this.name = 'StaleTransitionError';
  }
}

/**
 * Runs fn inside a transaction. If the caller passes its own client it owns
 * the transaction, so fn runs on that client directly.
 */
async function inTransaction<T>(
  client: PoolClient | undefined,
  fn: (c: PoolClient) => Promise<T>
): Promise<T> {
  if (client) return fn(client);
  const own = await pool.connect();
  try {
    await own.query('BEGIN');
    const result = await fn(own);
    await own.query('COMMIT');
    return result;
  } catch (err) {
    await own.query('ROLLBACK');
    throw err;
  } finally {
    own.release();
  }
}

export async function transitionOrder(
  orderId: string,
  from: OrderState,
  to: OrderState,
  note?: string,
  client?: PoolClient
): Promise<void> {
  if (to === 'failed') throw new Error('Use failOrder() to fail an order');
  if (!canTransition(from, to)) throw new Error(`Invalid transition '${from}' -> '${to}'`);

  await inTransaction(client, async (c) => {
    const { rowCount } = await c.query(
      `UPDATE orders SET state = $1 WHERE id = $2 AND state = $3`,
      [to, orderId, from]
    );
    if (rowCount === 0) throw new StaleTransitionError(orderId, from, to);

    await c.query(
      `INSERT INTO state_transitions (order_id, from_state, to_state, note)
       VALUES ($1, $2, $3, $4)`,
      [orderId, from, to, note ?? null]
    );
  });
  log.info({ orderId, from, to, note }, 'order.transition');
}

export async function failOrder(
  orderId: string,
  from: OrderState,
  reason: string,
  client?: PoolClient
): Promise<void> {
  if (!canTransition(from, 'failed')) throw new Error(`Invalid transition '${from}' -> 'failed'`);

  await inTransaction(client, async (c) => {
    const { rowCount } = await c.query(
      `UPDATE orders SET state = 'failed', error_msg = $1 WHERE id = $2 AND state = $3`,
      [reason, orderId, from]
    );
    if (rowCount === 0) throw new StaleTransitionError(orderId, from, 'failed');

    await c.query(
      `INSERT INTO state_transitions (order_id, from_state, to_state, note)
       VALUES ($1, $2, 'failed', $3)`,
      [orderId, from, reason]
    );
  });
  log.warn({ orderId, from, reason }, 'order.failed');
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
