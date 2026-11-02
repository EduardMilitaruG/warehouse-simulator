import { describe, expect, it } from 'vitest';
import { isUuid, validateCreateOrder } from '../../src/lib/validation';

const item = { sku: 'SKU-001', quantity: 1 };

describe('validateCreateOrder', () => {
  it.each([
    ['one item', { items: [item] }],
    ['several items', { items: [item, { sku: 'SKU-002', quantity: 3 }] }],
    ['priority at lower bound', { items: [item], priority: 1 }],
    ['priority at upper bound', { items: [item], priority: 5 }],
    ['external_ref of exactly 64 chars', { items: [item], external_ref: 'x'.repeat(64) }],
  ])('accepts %s', (_name, body) => {
    expect(validateCreateOrder(body)).toBeNull();
  });

  it.each([
    ['missing body', undefined, /items/],
    ['missing items', {}, /items/],
    ['items not an array', { items: 'SKU-001' }, /items/],
    ['empty items', { items: [] }, /items/],
    ['null item', { items: [null] }, /sku/],
    ['numeric sku', { items: [{ sku: 1, quantity: 1 }] }, /sku/],
    ['empty sku', { items: [{ sku: '', quantity: 1 }] }, /sku/],
    ['zero quantity', { items: [{ sku: 'SKU-001', quantity: 0 }] }, /quantity/],
    ['negative quantity', { items: [{ sku: 'SKU-001', quantity: -2 }] }, /quantity/],
    ['fractional quantity', { items: [{ sku: 'SKU-001', quantity: 1.5 }] }, /quantity/],
    ['quantity as string', { items: [{ sku: 'SKU-001', quantity: '2' }] }, /quantity/],
    ['priority 0', { items: [item], priority: 0 }, /priority/],
    ['priority 6', { items: [item], priority: 6 }, /priority/],
    ['fractional priority', { items: [item], priority: 2.5 }, /priority/],
    ['external_ref of 65 chars', { items: [item], external_ref: 'x'.repeat(65) }, /external_ref/],
    ['numeric external_ref', { items: [item], external_ref: 42 }, /external_ref/],
  ])('rejects %s', (_name, body, message) => {
    expect(validateCreateOrder(body)).toMatch(message);
  });
});

describe('isUuid', () => {
  it.each([
    ['3f2504e0-4f89-11d3-9a0c-0305e82c3301', true],
    ['3F2504E0-4F89-11D3-9A0C-0305E82C3301', true],
    ['not-a-uuid', false],
    ['123', false],
    ['3f2504e0-4f89-11d3-9a0c-0305e82c330', false],
    ["3f2504e0-4f89-11d3-9a0c-0305e82c3301' OR 1=1 --", false],
  ])('%s -> %s', (value, expected) => {
    expect(isUuid(value)).toBe(expected);
  });
});
