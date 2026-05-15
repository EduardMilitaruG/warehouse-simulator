/**
 * Seed script: fires N random orders at the API.
 * Usage: node scripts/seed.js [count]
 */
const COUNT = parseInt(process.argv[2] ?? '10', 10);
const BASE  = process.env.BASE_URL ?? 'http://localhost:3000';

const SKUS = ['SKU-001','SKU-002','SKU-003','SKU-004','SKU-005','SKU-006','SKU-007','SKU-008'];

function randomItems() {
  const n = Math.floor(Math.random() * 3) + 1;
  const picked = SKUS.sort(() => Math.random() - 0.5).slice(0, n);
  return picked.map(sku => ({ sku, quantity: Math.floor(Math.random() * 4) + 1 }));
}

async function main() {
  console.log(`Seeding ${COUNT} orders → ${BASE}/api/orders`);
  for (let i = 0; i < COUNT; i++) {
    const body = {
      items:        randomItems(),
      external_ref: `SEED-${String(i + 1).padStart(4, '0')}`,
      priority:     Math.ceil(Math.random() * 3),
    };
    const res  = await fetch(`${BASE}/api/orders`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const data = await res.json();
    console.log(`  [${res.status}] ${data.id ?? data.error}  (${body.external_ref})`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
