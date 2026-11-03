import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { failOrder, StaleTransitionError, transitionOrder } from '../../src/db/orders';
import { processBatch } from '../../src/worker/processor';
import { makeOrder, pool, resetDb, stateOf, transitionsOf } from './db';

beforeEach(resetDb);
afterAll(() => pool.end());

const neverFail = { failureRate: 0 };
const alwaysFail = { failureRate: 1, rng: () => 0 };

describe('processBatch', () => {
  it('moves an order one step per tick until it is delivered', async () => {
    const order = await makeOrder();
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      await processBatch(neverFail);
      seen.push(await stateOf(order.id));
    }

    expect(seen).toEqual(['picking', 'packing', 'shipping', 'delivered', 'delivered']);
    expect((await transitionsOf(order.id)).map((t) => t.to_state)).toEqual([
      'received', 'picking', 'packing', 'shipping', 'delivered',
    ]);
  });

  it('fails an order with a reason from its current stage', async () => {
    const order = await makeOrder();
    await processBatch(alwaysFail);

    const { rows } = await pool.query('SELECT state, error_msg FROM orders WHERE id = $1', [order.id]);
    expect(rows[0]).toEqual({ state: 'failed', error_msg: 'Queue capacity exceeded' });
    expect((await transitionsOf(order.id)).at(-1)).toEqual({ from_state: 'received', to_state: 'failed' });
  });

  it('leaves terminal orders alone', async () => {
    const order = await makeOrder();
    await processBatch(alwaysFail);
    expect(await processBatch(neverFail)).toBe(0);
    expect(await stateOf(order.id)).toBe('failed');
  });

  it('processes higher priority orders first when the batch is full', async () => {
    const low = await Promise.all(Array.from({ length: 10 }, () => makeOrder(1)));
    const urgent = await makeOrder(5);

    await processBatch(neverFail);

    expect(await stateOf(urgent.id)).toBe('picking');
    const lowStates = await Promise.all(low.map((o) => stateOf(o.id)));
    expect(lowStates.filter((s) => s === 'received')).toHaveLength(1);
  });

  // The batch holds its FOR UPDATE SKIP LOCKED row locks for the whole
  // transaction, so a second worker skips rows the first one is moving.
  it('two workers running at once never advance the same order twice', async () => {
    const orders = await Promise.all(Array.from({ length: 10 }, () => makeOrder()));

    const results = await Promise.allSettled([processBatch(neverFail), processBatch(neverFail)]);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    for (const o of orders) {
      expect(await stateOf(o.id)).toBe('picking');
      expect(await transitionsOf(o.id)).toHaveLength(2);
    }
  });
});

describe('transitionOrder', () => {
  // Regression: the UPDATE matched 0 rows but the audit row was still written,
  // so state_transitions claimed a move that never happened.
  it('writes nothing when the order is no longer in the expected state', async () => {
    const order = await makeOrder();
    await transitionOrder(order.id, 'received', 'picking');

    await expect(transitionOrder(order.id, 'received', 'picking')).rejects.toBeInstanceOf(StaleTransitionError);
    expect(await transitionsOf(order.id)).toHaveLength(2);
  });

  it('rejects transitions the state machine does not allow', async () => {
    const order = await makeOrder();
    await expect(transitionOrder(order.id, 'received', 'shipping')).rejects.toThrow(/Invalid transition/);
    expect(await stateOf(order.id)).toBe('received');
  });
});

describe('failOrder', () => {
  // Regression: failOrder had no state guard and could turn a delivered order into failed.
  it('cannot fail an order that was already delivered', async () => {
    const order = await makeOrder();
    for (let i = 0; i < 4; i++) await processBatch(neverFail);

    await expect(failOrder(order.id, 'delivered', 'late')).rejects.toThrow(/Invalid transition/);
    await expect(failOrder(order.id, 'shipping', 'late')).rejects.toBeInstanceOf(StaleTransitionError);
    expect(await stateOf(order.id)).toBe('delivered');
  });
});
