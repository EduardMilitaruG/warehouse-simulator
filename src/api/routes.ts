import { Router, Request, Response } from 'express';
import {
  createOrder,
  getOrderById,
  listOrders,
  getOrderItems,
  getStateHistory,
  getMetrics,
} from '../db/orders';
import { pool } from '../db/pool';
import { log } from '../lib/logger';

export const router = Router();

// POST /orders — create a new order
router.post('/orders', async (req: Request, res: Response) => {
  const { items, external_ref, priority } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items must be a non-empty array' });
  }

  for (const item of items) {
    if (!item.sku || typeof item.sku !== 'string') {
      return res.status(400).json({ error: 'each item must have a string sku' });
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      return res.status(400).json({ error: 'each item must have quantity >= 1' });
    }
  }

  try {
    const order = await createOrder(items, external_ref, priority);
    return res.status(201).json(order);
  } catch (err: any) {
    log.error({ err }, 'api.create_order.error');
    if (err.code === '23503') {
      return res.status(400).json({ error: 'One or more SKUs do not exist in inventory' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /orders — list recent orders
router.get('/orders', async (_req: Request, res: Response) => {
  try {
    const orders = await listOrders(100);
    return res.json(orders);
  } catch (err) {
    log.error({ err }, 'api.list_orders.error');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /orders/:id — single order with items + history
router.get('/orders/:id', async (req: Request, res: Response) => {
  const id = String(req.params['id']);
  try {
    const [order, items, history] = await Promise.all([
      getOrderById(id),
      getOrderItems(id),
      getStateHistory(id),
    ]);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    return res.json({ ...order, items, history });
  } catch (err) {
    log.error({ err, orderId: id }, 'api.get_order.error');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /inventory — see stock levels
router.get('/inventory', async (_req: Request, res: Response) => {
  const { rows } = await pool.query(`SELECT * FROM inventory ORDER BY sku`);
  return res.json(rows);
});

// GET /metrics — operator dashboard data
router.get('/metrics', async (_req: Request, res: Response) => {
  try {
    return res.json(await getMetrics());
  } catch (err) {
    log.error({ err }, 'api.metrics.error');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /health — liveness check
router.get('/health', async (_req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ status: 'ok', db: 'connected', ts: new Date().toISOString() });
  } catch {
    return res.status(503).json({ status: 'error', db: 'unreachable' });
  }
});
