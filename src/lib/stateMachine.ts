/**
 * Order state machine.
 *
 * Valid transitions:
 *
 *  received → picking → packing → shipping → delivered
 *      │           │        │          │
 *      └───────────┴────────┴──────────┴──→ failed
 *
 * Any state except 'delivered' and 'failed' can fail.
 */

export type OrderState =
  | 'received'
  | 'picking'
  | 'packing'
  | 'shipping'
  | 'delivered'
  | 'failed';

const TRANSITIONS: Record<OrderState, OrderState[]> = {
  received:  ['picking', 'failed'],
  picking:   ['packing', 'failed'],
  packing:   ['shipping', 'failed'],
  shipping:  ['delivered', 'failed'],
  delivered: [],
  failed:    [],
};

export function nextState(current: OrderState): OrderState {
  const opts = TRANSITIONS[current].filter((s) => s !== 'failed');
  if (opts.length === 0) throw new Error(`No forward transition from '${current}'`);
  return opts[0];
}

export function canTransition(from: OrderState, to: OrderState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(state: OrderState): boolean {
  return state === 'delivered' || state === 'failed';
}

// Human-readable descriptions shown in logs and the dashboard
export const STATE_LABELS: Record<OrderState, string> = {
  received:  'Order received',
  picking:   'Picking items from shelf',
  packing:   'Packing order',
  shipping:  'Shipping / dispatch',
  delivered: 'Delivered',
  failed:    'Failed',
};
