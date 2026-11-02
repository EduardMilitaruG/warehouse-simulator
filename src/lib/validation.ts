import { OrderItemInput } from '../db/orders';

export interface CreateOrderInput {
  items: OrderItemInput[];
  external_ref?: string;
  priority?: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Validates a POST /orders body. Returns an error message, or null if valid.
 * Mirrors the DB constraints so bad input gets a 400 instead of a 500.
 */
export function validateCreateOrder(body: any): string | null {
  const { items, external_ref, priority } = body ?? {};

  if (!Array.isArray(items) || items.length === 0) {
    return 'items must be a non-empty array';
  }
  for (const item of items) {
    if (!item || !item.sku || typeof item.sku !== 'string') {
      return 'each item must have a string sku';
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      return 'each item must have quantity >= 1';
    }
  }
  if (external_ref !== undefined && (typeof external_ref !== 'string' || external_ref.length > 64)) {
    return 'external_ref must be a string of at most 64 characters';
  }
  if (priority !== undefined && (!Number.isInteger(priority) || priority < 1 || priority > 5)) {
    return 'priority must be an integer between 1 and 5';
  }
  return null;
}
