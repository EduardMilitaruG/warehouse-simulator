/**
 * Background worker: advances orders through the state machine.
 *
 * Each tick it picks up to BATCH_SIZE orders that aren't terminal,
 * decides whether to inject a fault, and either advances or fails them.
 */

import { pool } from '../db/pool';
import { transitionOrder, failOrder } from '../db/orders';
import { nextState, isTerminal, OrderState, STATE_LABELS } from '../lib/stateMachine';
import { log } from '../lib/logger';

const FAILURE_RATE   = parseFloat(process.env.FAILURE_RATE   ?? '0.15');
const BATCH_SIZE     = 10;

const FAULT_REASONS: Record<OrderState, string[]> = {
  received:  ['Queue capacity exceeded', 'Invalid SKU in order'],
  picking:   ['Item out of stock', 'Picker unit offline', 'Barcode scan mismatch'],
  packing:   ['Weight check failed', 'Packaging material unavailable'],
  shipping:  ['Carrier not available', 'Address label error'],
  delivered: [],
  failed:    [],
};

function shouldFail(): boolean {
  return Math.random() < FAILURE_RATE;
}

function pickReason(state: OrderState): string {
  const reasons = FAULT_REASONS[state];
  return reasons[Math.floor(Math.random() * reasons.length)] ?? 'Unknown error';
}

export async function processBatch(): Promise<void> {
  const { rows } = await pool.query<{ id: string; state: OrderState }>(
    `SELECT id, state FROM orders
     WHERE state NOT IN ('delivered', 'failed')
     ORDER BY priority DESC, created_at ASC
     LIMIT $1
     FOR UPDATE SKIP LOCKED`,
    [BATCH_SIZE]
  );

  for (const order of rows) {
    const current = order.state as OrderState;
    if (isTerminal(current)) continue;

    if (shouldFail()) {
      const reason = pickReason(current);
      await failOrder(order.id, current, reason);
      log.warn({ orderId: order.id, state: current, reason }, 'fault.injected');
    } else {
      const next = nextState(current);
      await transitionOrder(
        order.id,
        current,
        next,
        `Auto-advanced by worker: ${STATE_LABELS[next]}`
      );
    }
  }
}

export function startWorker(): void {
  const intervalMs = parseInt(process.env.WORKER_INTERVAL_MS ?? '2000', 10);
  log.info({ intervalMs, failureRate: FAILURE_RATE }, 'worker.started');

  setInterval(async () => {
    try {
      await processBatch();
    } catch (err) {
      log.error({ err }, 'worker.tick.error');
    }
  }, intervalMs);
}
