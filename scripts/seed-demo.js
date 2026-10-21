// Fills the app with dummy orders so the sales views have something to show.
//   npm run demo            add ~45 demo orders to every campaign (does nothing if demo orders already exist)
//   npm run demo -- --reset delete the existing demo orders first
// Demo orders are flagged (orders.demo = 1): they show a "démo" label, have no real HelloAsso payment,
// and "Rembourser" only simulates the refund for them.
const db = require('../src/db');
const catalog = require('../src/catalog');
const campaigns = require('../src/campaigns');

if (process.argv.includes('--reset')) db.exec('DELETE FROM orders WHERE demo = 1');
if (db.prepare('SELECT COUNT(*) AS n FROM orders WHERE demo = 1').get().n) {
  console.log('Demo orders already exist (use --reset to replace them).');
  process.exit(0);
}

let seed = 20261018;                                   // deterministic: same dummy data every time
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const FIRST = ['Camille', 'Léa', 'Hugo', 'Inès', 'Lucas', 'Chloé', 'Nathan', 'Manon', 'Louis', 'Jade', 'Arthur', 'Sarah', 'Jules', 'Emma', 'Adam', 'Lina', 'Raphaël', 'Zoé', 'Thomas', 'Clara', 'Maël', 'Alice', 'Noé', 'Louise'];
const LAST = ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier', 'Girard', 'Bonnet', 'Dupont', 'Lambert'];
const COMMENTS = ['', '', '', '', 'Retrait jeudi soir si possible', 'Merci beaucoup !', 'Je passe en fin de journée', 'Pour une fête de famille', 'Sans emballage plastique svp'];
const QTY = [1, 1, 1, 1, 2, 2, 3, 4, 6];
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const stamp = (daysAgo, hour) => new Date(Date.UTC(2026, 9, 18 - daysAgo, hour, Math.floor(rnd() * 60), Math.floor(rnd() * 60))).toISOString().slice(0, 19).replace('T', ' ');

const insOrder = db.prepare(`INSERT INTO orders (created_at, campaign_id, campaign, first_name, last_name, member_no, email, comment, total_cents, status, paid_at, ha_raw, refunded_at, demo)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)`);
const insItem = db.prepare('INSERT INTO order_items (order_id, product_id, variant_id, size_id, product, variant, size, unit_cents, qty, grams) VALUES (?,?,?,?,?,?,?,?,?,?)');

let total = 0;
for (const c of campaigns.list()) {
  const tree = catalog.loadTree({ campaignId: c.id, forOrder: true });
  if (!tree.length) continue;
  for (let n = 0; n < 45; n++) {
    const lines = [];
    for (let k = 1 + Math.floor(rnd() * 4); k > 0; k--) {          // 1 to 4 lines per order
      const p = pick(tree), s = pick(p.sizes), v = p.variants.length ? pick(p.variants) : null;
      if (!lines.some((l) => l.p === p && l.s === s && l.v === v)) lines.push({ p, s, v, qty: pick(QTY) });
    }
    const cents = lines.reduce((sum, l) => sum + l.s.price_cents * l.qty, 0);
    const roll = rnd();
    const status = roll < 0.84 ? 'paid' : roll < 0.94 ? 'refunded' : 'failed';          // no pending orders in the demo
    const created = stamp(Math.floor(rnd() * 26), 8 + Math.floor(rnd() * 13));
    const first = pick(FIRST), last = pick(LAST);
    const paidAt = status === 'paid' || status === 'refunded' ? created.replace(/:\d\d$/, ':59') : null;
    const raw = paidAt ? JSON.stringify({ order: { payments: [{ date: paidAt.replace(' ', 'T') + 'Z', paymentMeans: 'Card', amount: cents, state: 'Authorized' }] } }) : null;
    const id = Number(insOrder.run(created, c.id, c.name, first, last, String(1000 + Math.floor(rnd() * 9000)), `${slug(first)}.${slug(last)}@example.org`, pick(COMMENTS),
      cents, status, paidAt, raw, status === 'refunded' ? paidAt : null).lastInsertRowid);
    for (const l of lines) insItem.run(id, l.p.id, l.v ? l.v.id : null, l.s.id, l.p.name, l.v ? l.v.name : '', l.s.label, l.s.price_cents, l.qty, l.s.grams);
    total++;
  }
}
console.log(`Added ${total} demo orders.`);
