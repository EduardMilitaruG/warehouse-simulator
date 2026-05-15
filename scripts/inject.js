/**
 * Fault injection demo: sends orders then polls metrics to show the
 * error rate climb. Useful for live demos and interview walkthroughs.
 *
 * Usage: FAILURE_RATE=1.0 node scripts/inject.js
 * (the server must be restarted with the high FAILURE_RATE env var;
 *  this script just seeds orders and streams metrics so you can watch)
 */
const BASE  = process.env.BASE_URL ?? 'http://localhost:3000';
const SKUS  = ['SKU-001','SKU-002','SKU-003','SKU-004','SKU-005','SKU-006','SKU-007','SKU-008'];
const TICKS = parseInt(process.argv[2] ?? '10', 10);

function randomItems() {
  const n    = Math.floor(Math.random() * 2) + 1;
  const skus = [...SKUS].sort(() => Math.random() - 0.5).slice(0, n);
  return skus.map(sku => ({ sku, quantity: Math.ceil(Math.random() * 3) }));
}

async function postOrder(i) {
  const res  = await fetch(`${BASE}/api/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: randomItems(), external_ref: `INJECT-${i}`, priority: 3 }),
  });
  const d = await res.json();
  return d.id;
}

async function printMetrics() {
  const m = await fetch(`${BASE}/api/metrics`).then(r => r.json());
  const s = m.by_state ?? {};
  console.log(
    `  state → recv:${s.received??0} pick:${s.picking??0} pack:${s.packing??0}` +
    ` ship:${s.shipping??0} done:${s.delivered??0} FAIL:${s.failed??0}` +
    `  |  stuck:${m.stuck_orders}  throughput/hr:${m.delivered_last_hour}`
  );
}

async function main() {
  console.log(`\nFault injection demo — seeding 5 orders then watching metrics (${TICKS} ticks)\n`);
  for (let i = 0; i < 5; i++) {
    const id = await postOrder(i + 1);
    console.log(`  created ${id}`);
  }
  console.log('\nStreaming metrics every 2s  (Ctrl-C to stop)\n');
  for (let t = 0; t < TICKS; t++) {
    await new Promise(r => setTimeout(r, 2000));
    await printMetrics();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
