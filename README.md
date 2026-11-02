# Warehouse Order Simulator

[![CI](https://github.com/EduardMilitaruG/warehouse-simulator/actions/workflows/ci.yml/badge.svg)](https://github.com/EduardMilitaruG/warehouse-simulator/actions/workflows/ci.yml)

A learning project simulating a simplified warehouse order fulfilment pipeline.
Built to practise the system-thinking, observability, and diagnostic patterns
relevant to warehouse automation software — state machines, structured logging,
PostgreSQL diagnostics, REST integration, and fault injection.

> **Scope disclaimer:** this is a single-process simulation, not a real WMS.
> A production system would add PLC integration, conveyor event streams,
> multi-warehouse routing, and years of edge-case handling.
> The goal here is to practise the *operational thinking*, not to replicate
> the product.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Client (curl / Postman / seed script)                           │
└───────────────────────────┬──────────────────────────────────────┘
                            │ POST /api/orders
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  Express API  (src/api/routes.ts)                                │
│                                                                  │
│  POST /api/orders          → create order + items                │
│  GET  /api/orders          → list recent orders                  │
│  GET  /api/orders/:id      → detail + state history              │
│  GET  /api/inventory       → stock levels                        │
│  GET  /api/metrics         → operator KPIs                       │
│  GET  /api/health          → liveness check (pings DB)           │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  PostgreSQL                                                      │
│  orders · order_items · inventory · state_transitions            │
└───────────────────────────┬──────────────────────────────────────┘
                            │  (polled every WORKER_INTERVAL_MS)
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  Background Worker  (src/worker/processor.ts)                    │
│  Advances orders through state machine; injects faults           │
└───────────────────────────┬──────────────────────────────────────┘
                            │
              ┌─────────────┼────────────────┐
              ▼             ▼                ▼
        JSON logs     /api/metrics     Live dashboard
        (logs/)       (operator KPIs)  (public/index.html)
```

---

## Order state machine

```
             ┌──────────┐
   create ──▶│ received │
             └────┬─────┘
                  │ worker tick
                  ▼
             ┌──────────┐
             │ picking  │  ← items located on shelf
             └────┬─────┘
                  │
                  ▼
             ┌──────────┐
             │ packing  │  ← items consolidated, labelled
             └────┬─────┘
                  │
                  ▼
             ┌──────────┐
             │ shipping │  ← dispatched to carrier
             └────┬─────┘
                  │
                  ▼
             ┌───────────┐
             │ delivered │  (terminal)
             └───────────┘

  Any non-terminal state can transition to → failed  (terminal)
  via fault injection (FAILURE_RATE env var, default 15%).
```

Allowed transitions are enforced in `src/lib/stateMachine.ts`.
Any attempt to jump states is rejected. The full history of every
transition (with timestamp and note) is stored in `state_transitions`.

---

## Quick start

### With Docker (recommended — mirrors Linux deployment)

```bash
git clone <repo>
cd warehouse-simulator
cp .env.example .env
docker compose up --build -d   # postgres + app in ~30s
make seed                       # fire 10 random orders
```

Open [http://localhost:3000](http://localhost:3000) for the live dashboard.

### Without Docker (local postgres required)

```bash
cp .env.example .env            # edit credentials
psql -U postgres -c "CREATE USER warehouse WITH PASSWORD 'warehouse';"
psql -U postgres -c "CREATE DATABASE warehouse OWNER warehouse;"
psql -U warehouse -d warehouse -f sql/001_schema.sql
npm run dev
```

---

## Makefile operations

```
make up            Start Docker stack (postgres + app)
make down          Stop stack
make dev           Run locally with ts-node hot-reload
make logs          Tail + pretty-print structured logs
make psql          Open psql console
make seed          POST 10 random orders to the API
make metrics       Pretty-print /api/metrics
make health        Pretty-print /api/health
make reset         Drop and recreate schema (local only)
```

---

## Environment variables

| Variable             | Default  | Description                                    |
|----------------------|----------|------------------------------------------------|
| `PORT`               | `3000`   | HTTP server port                               |
| `PGHOST`             | localhost | Postgres host                                 |
| `PGPORT`             | `5432`   | Postgres port                                  |
| `PGDATABASE`         | warehouse| Database name                                  |
| `PGUSER`             | warehouse| DB user                                        |
| `PGPASSWORD`         | warehouse| DB password                                    |
| `FAILURE_RATE`       | `0.15`   | Fault injection probability per worker tick (0–1) |
| `WORKER_INTERVAL_MS` | `2000`   | Worker poll interval in milliseconds           |

---

## Testing

97 tests run with [Vitest](https://vitest.dev) on every push and pull request
([CI workflow](.github/workflows/ci.yml)). Integration tests use a real
PostgreSQL 16 database, not mocks, because most of the interesting behaviour
lives in SQL: transactions, row locks and CHECK constraints.

| Suite | Tests | What it covers |
|---|---:|---|
| `tests/unit/stateMachine.test.ts` | 46 | Every pair in the 6×6 transition matrix, the happy path, terminal states |
| `tests/unit/validation.test.ts` | 27 | Boundary values for priority, quantity and `external_ref`; UUID format |
| `tests/integration/orders.api.test.ts` | 16 | HTTP contract via Supertest: status codes, rollback on bad SKU, ordering, metrics |
| `tests/integration/worker.test.ts` | 8 | Worker ticks, fault injection, priority order, concurrent workers, audit log integrity |

```bash
docker compose up -d db      # Postgres on :5432
npm test                     # unit + integration
npm run test:unit            # no database needed
npm run test:integration -- --coverage
```

The worker takes `failureRate` and `rng` as options, so fault injection is
deterministic in tests instead of depending on `Math.random()`.

### Bugs the tests found

Each of these has a test that fails on the code before the fix.

| # | Input / situation | Before | After |
|---|---|---|---|
| 1 | `POST /api/orders` with `priority: 9` or a 65-char `external_ref` | 500, Postgres CHECK / length violation | 400 with a message |
| 2 | `GET /api/orders/abc` | 500, invalid cast to `uuid` | 400 `Order id must be a UUID` |
| 3 | `transitionOrder()` on an order another worker already moved | `UPDATE` matched 0 rows but the audit row was still inserted, so `state_transitions` recorded a move that never happened | Throws `StaleTransitionError`, writes nothing |
| 4 | `failOrder()` on a delivered order | Order flipped from `delivered` to `failed` | Rejected by the state machine |
| 5 | `transitionOrder(id, 'received', 'shipping')` | Accepted, skipping two stages | Rejected as an invalid transition |

The worker's `SELECT ... FOR UPDATE SKIP LOCKED` also ran outside a
transaction, so its row locks were released as soon as the query returned.
The whole batch now runs in one transaction.

---

## Diagnostic walkthrough

This section documents the troubleshooting loop I'd run if orders were stuck
or error rates were spiking — the same loop a commissioning engineer would
run during a go-live.

### Scenario: orders stuck in `picking` state

**1. Spot the symptom via metrics**
```bash
curl -s http://localhost:3000/api/metrics | python3 -m json.tool
```
Look for a large `picking` count with low `delivered_last_hour` throughput,
and a non-zero `stuck_orders` value.

**2. Find stuck orders in the DB**
```sql
SELECT id, external_ref, state, updated_at,
       NOW() - updated_at AS age
FROM orders
WHERE state = 'picking'
  AND updated_at < NOW() - INTERVAL '2 minutes'
ORDER BY updated_at ASC;
```

**3. Check state history for a specific order**
```sql
SELECT from_state, to_state, occurred_at, note
FROM state_transitions
WHERE order_id = '<uuid>'
ORDER BY occurred_at;
```
If the transition into `picking` exists but no exit transition does,
the worker tick either hasn't run or is failing silently.

**4. Check the worker logs**
```bash
# In production: tail the log file and filter for errors and fault events
tail -f logs/warehouse.log | grep -E '"level":50|fault.injected|worker.tick.error'

# Or with pino-pretty:
make logs
```

**5. Check inventory for the affected SKUs**
```sql
SELECT oi.sku, oi.quantity AS ordered, i.quantity AS in_stock, i.location
FROM order_items oi
JOIN inventory i ON i.sku = oi.sku
WHERE oi.order_id = '<uuid>';
```
If `in_stock = 0` for any item, that's your root cause — the picker
has nothing to scan.

**6. Check error distribution across states**
```sql
SELECT from_state, COUNT(*) AS failures, note
FROM state_transitions
WHERE to_state = 'failed'
GROUP BY from_state, note
ORDER BY failures DESC;
```
This shows which stage is generating the most failures and why,
equivalent to reading a machine error log grouped by error code.

**7. Throughput over time**
```sql
SELECT
  date_trunc('minute', occurred_at) AS minute,
  COUNT(*) AS delivered
FROM state_transitions
WHERE to_state = 'delivered'
  AND occurred_at >= NOW() - INTERVAL '1 hour'
GROUP BY 1
ORDER BY 1;
```
A sudden drop-off in this chart means something broke at that minute —
correlate the timestamp with the worker log.

### Scenario: simulating a total site failure

Set `FAILURE_RATE=1.0` in your environment and restart the app.
All orders in non-terminal states will fail on the next worker tick.
Watch the failure column on the dashboard climb to 100%.

To recover: set `FAILURE_RATE` back to normal and restart.
Orders already in `failed` state are terminal — you'd need to
re-queue them (not implemented, but would be a `POST /orders/retry`
endpoint in a real system).

---

## API reference

### POST /api/orders
Create a new order.

```json
{
  "items": [
    { "sku": "SKU-001", "quantity": 2 },
    { "sku": "SKU-005", "quantity": 10 }
  ],
  "external_ref": "PO-2024-001",
  "priority": 2
}
```
`priority` is 1–5 (5 = highest). Higher-priority orders are processed first.

Returns the created order object with `id` (UUID).

### GET /api/orders/:id
Returns the order, its items, and full state transition history.

```json
{
  "id": "...",
  "state": "picking",
  "priority": 2,
  "items": [
    { "sku": "SKU-001", "quantity": 2, "description": "...", "location": "A-01-1" }
  ],
  "history": [
    { "from_state": null,       "to_state": "received", "occurred_at": "..." },
    { "from_state": "received", "to_state": "picking",  "occurred_at": "..." }
  ]
}
```

### GET /api/metrics
Operator KPIs used by the dashboard.

```json
{
  "by_state": { "received": 2, "picking": 5, "delivered": 14, "failed": 3 },
  "delivered_last_hour": 8,
  "avg_fulfillment_secs": 12.4,
  "stuck_orders": 1
}
```

### GET /api/health
Liveness probe — pings the DB. Returns `503` if unreachable.

---

## Known limitations vs a real WMS

| This simulator | Real warehouse software |
|----------------|------------------------|
| Single process, in-memory worker loop | Distributed workers, message queues (MQTT/AMQP) |
| Random fault injection | Real hardware signals: scanner offline, conveyor jam, E-stop |
| No inventory reservation | Concurrent pick locking, FIFO/FEFO rotation |
| Single warehouse | Multi-site routing, zone picking, sorter integration |
| No auth | Role-based access: operator, supervisor, admin |
| State machine in code | Potentially PLC-driven state via OPC-UA or proprietary protocol |
| Fake latency (timer) | Real dwell time from hardware handshake acknowledgements |

Knowing where your model ends is as important as knowing what it covers.

---

## Tech stack

- **Runtime:** Node.js 22 + TypeScript
- **Framework:** Express 5
- **Database:** PostgreSQL 16
- **Logging:** Pino (structured JSON → stdout + file)
- **Testing:** Vitest, Supertest, real PostgreSQL in GitHub Actions
- **Deployment:** Docker Compose (single command, Linux-compatible)
