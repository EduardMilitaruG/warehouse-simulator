import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app';
import { pool, resetDb } from './db';

beforeEach(resetDb);
afterAll(() => pool.end());

const validOrder = { items: [{ sku: 'SKU-001', quantity: 2 }], external_ref: 'PO-1', priority: 3 };

describe('POST /api/orders', () => {
  it('creates an order in state received and records the first transition', async () => {
    const created = await request(app).post('/api/orders').send(validOrder).expect(201);

    expect(created.body).toMatchObject({ state: 'received', external_ref: 'PO-1', priority: 3 });

    const detail = await request(app).get(`/api/orders/${created.body.id}`).expect(200);
    expect(detail.body.items).toEqual([
      expect.objectContaining({ sku: 'SKU-001', quantity: 2, location: 'A-01-1' }),
    ]);
    expect(detail.body.history).toEqual([
      expect.objectContaining({ from_state: null, to_state: 'received', note: 'Order created' }),
    ]);
  });

  it('defaults priority to 1', async () => {
    const res = await request(app).post('/api/orders').send({ items: validOrder.items }).expect(201);
    expect(res.body.priority).toBe(1);
  });

  it('returns 400 for a SKU that is not in inventory and stores nothing', async () => {
    const res = await request(app)
      .post('/api/orders')
      .send({ items: [{ sku: 'SKU-001', quantity: 1 }, { sku: 'NOPE', quantity: 1 }] })
      .expect(400);

    expect(res.body.error).toMatch(/do not exist/);
    // The transaction must roll back: no half-created order.
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM orders');
    expect(rows[0].n).toBe(0);
  });

  // Before validation was added these reached Postgres, hit a CHECK constraint
  // and came back as 500 Internal Server Error.
  it.each([
    ['priority above range', { ...validOrder, priority: 9 }],
    ['priority below range', { ...validOrder, priority: 0 }],
    ['external_ref too long', { ...validOrder, external_ref: 'x'.repeat(65) }],
    ['zero quantity', { items: [{ sku: 'SKU-001', quantity: 0 }] }],
    ['no items', { items: [] }],
  ])('returns 400, not 500, for %s', async (_name, body) => {
    const res = await request(app).post('/api/orders').send(body).expect(400);
    expect(res.body).toHaveProperty('error');
  });
});

describe('GET /api/orders/:id', () => {
  it('returns 404 for a well-formed id that does not exist', async () => {
    await request(app).get('/api/orders/3f2504e0-4f89-11d3-9a0c-0305e82c3301').expect(404);
  });

  // Before the fix Postgres rejected the cast to uuid and the API answered 500.
  it.each(['abc', '123', "1' OR '1'='1"])('returns 400, not 500, for malformed id %s', async (id) => {
    const res = await request(app).get(`/api/orders/${encodeURIComponent(id)}`).expect(400);
    expect(res.body.error).toMatch(/UUID/);
  });
});

describe('GET /api/orders', () => {
  it('lists newest first', async () => {
    const first = await request(app).post('/api/orders').send(validOrder);
    const second = await request(app).post('/api/orders').send(validOrder);

    const res = await request(app).get('/api/orders').expect(200);
    expect(res.body.map((o: { id: string }) => o.id)).toEqual([second.body.id, first.body.id]);
  });
});

describe('GET /api/inventory', () => {
  it('returns the seeded SKUs sorted', async () => {
    const res = await request(app).get('/api/inventory').expect(200);
    expect(res.body).toHaveLength(8);
    expect(res.body[0]).toMatchObject({ sku: 'SKU-001', location: 'A-01-1' });
  });
});

describe('GET /api/metrics', () => {
  it('counts orders by state', async () => {
    await request(app).post('/api/orders').send(validOrder);
    await request(app).post('/api/orders').send(validOrder);

    const res = await request(app).get('/api/metrics').expect(200);
    expect(res.body).toEqual({
      by_state: { received: 2 },
      delivered_last_hour: 0,
      avg_fulfillment_secs: 0,
      stuck_orders: 0,
    });
  });
});

describe('GET /api/health', () => {
  it('reports the database as connected', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'connected' });
  });
});
