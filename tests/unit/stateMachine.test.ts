import { describe, expect, it } from 'vitest';
import { canTransition, isTerminal, nextState, OrderState } from '../../src/lib/stateMachine';

const STATES: OrderState[] = ['received', 'picking', 'packing', 'shipping', 'delivered', 'failed'];

// The only transitions the business allows. Everything else must be rejected.
const ALLOWED = new Set([
  'received>picking',
  'picking>packing',
  'packing>shipping',
  'shipping>delivered',
  'received>failed',
  'picking>failed',
  'packing>failed',
  'shipping>failed',
]);

describe('canTransition', () => {
  // Full 6x6 matrix: 36 cases, so a new edge added by mistake is caught.
  const matrix = STATES.flatMap((from) => STATES.map((to) => [from, to] as const));

  it.each(matrix)('%s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(ALLOWED.has(`${from}>${to}`));
  });
});

describe('nextState', () => {
  it('walks the happy path from received to delivered', () => {
    const path: OrderState[] = ['received'];
    while (!isTerminal(path[path.length - 1])) path.push(nextState(path[path.length - 1]));
    expect(path).toEqual(['received', 'picking', 'packing', 'shipping', 'delivered']);
  });

  it('never chooses failed as the next state', () => {
    for (const s of STATES.filter((s) => !isTerminal(s))) {
      expect(nextState(s)).not.toBe('failed');
    }
  });

  it.each(['delivered', 'failed'] as const)('throws for terminal state %s', (s) => {
    expect(() => nextState(s)).toThrow(/No forward transition/);
  });
});

describe('isTerminal', () => {
  it.each(STATES)('%s', (s) => {
    expect(isTerminal(s)).toBe(s === 'delivered' || s === 'failed');
  });
});
