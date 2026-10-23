// Sales figures for the admin: queries behind the Produits / Clients tabs and the two CSV exports.
const db = require('./db');
const { csv, eur } = require('./http');

// Paid sales of one campaign per product / option / price: unpaid orders must not make a product appear with 0 sold.
const SALES_SQL = `SELECT oi.product, oi.variant, oi.size, MAX(oi.size_name) AS size_name, MAX(oi.grams) AS grams,
  COALESCE(MIN(p.sort), 1e9) AS psort, COALESCE(MIN(vr.sort), 0) AS vsort, COALESCE(MIN(s.sort), 0) AS ssort,
  SUM(oi.qty) AS paid_qty, COALESCE(SUM(oi.qty*oi.grams),0) AS paid_grams
  FROM order_items oi JOIN orders o ON o.id = oi.order_id
  LEFT JOIN products p ON p.id = oi.product_id LEFT JOIN variants vr ON vr.id = oi.variant_id LEFT JOIN sizes s ON s.id = oi.size_id
  WHERE o.status = 'paid' AND o.campaign_id = ?
  GROUP BY oi.product, oi.variant, oi.size
  ORDER BY psort, oi.product, vsort, oi.variant, ssort, oi.size`;
const salesByProduct = (campaignId) => db.prepare(SALES_SQL).all(campaignId);

// The totals shown above both tabs: money and weight by order status, for one campaign.
function salesTotals(campaignId) {
  const k = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN status='paid' THEN total_cents END),0) AS paid_cents, COALESCE(SUM(status='paid'),0) AS paid_orders,
    COALESCE(SUM(CASE WHEN status='refunded' THEN total_cents END),0) AS refunded_cents, COALESCE(SUM(status='refunded'),0) AS refunded_orders
    FROM orders WHERE campaign_id = ?`).get(campaignId);
  return Object.assign(k, db.prepare(`SELECT COALESCE(SUM(oi.qty*oi.grams),0) AS paid_grams, COALESCE(SUM(CASE WHEN oi.grams IS NULL THEN oi.qty END),0) AS paid_noweight
    FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status='paid' AND o.campaign_id = ?`).get(campaignId));
}

const paymentsPerDay = (campaignId) => db.prepare(`SELECT date(paid_at) AS day, COUNT(*) AS n, SUM(total_cents) AS cents FROM orders WHERE status='paid' AND campaign_id = ? GROUP BY day ORDER BY day DESC`).all(campaignId);
const ordersOf = (campaignId) => db.prepare('SELECT * FROM orders WHERE campaign_id = ? ORDER BY id DESC').all(campaignId);

// order id -> its lines (all orders: one query instead of one per order)
function itemsByOrder() {
  const m = new Map();
  for (const i of db.prepare('SELECT * FROM order_items ORDER BY id').all()) m.set(i.order_id, [...(m.get(i.order_id) || []), i]);
  return m;
}

// "Poids (g)" is the grams of one unit; a price without weight (sold by the unit, free text) shows its label instead.
const totalsCsv = (campaignId) => csv([['Produit', 'Option', 'Nom du prix', 'Poids (g)', 'Quantité', 'Poids total (g)'],
  ...salesByProduct(campaignId).map((r) => [r.product, r.variant, r.size_name, r.grams ?? r.size, r.paid_qty, r.paid_grams])]);

const ordersCsv = (campaignId) => {
  const rows = db.prepare(`SELECT o.*, oi.product, oi.variant, oi.size, oi.size_name, oi.qty, oi.unit_cents, oi.grams FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.campaign_id = ? ORDER BY o.id, oi.id`).all(campaignId);
  return csv([['Commande', 'Date', 'Statut', 'Prénom', 'Nom', 'Email', 'Commentaire', 'Produit', 'Option', 'Nom du prix', 'Poids (g)', 'Quantité', 'Poids total (g)', 'Prix unitaire (€)', 'Ligne (€)'],
    ...rows.map((r) => [r.number ?? '', r.created_at, r.status, r.first_name, r.last_name, r.email, r.comment, r.product, r.variant, r.size_name, r.grams ?? r.size, r.qty, r.grams == null ? '' : r.grams * r.qty, eur(r.unit_cents), eur(r.unit_cents * r.qty)])]);
};

module.exports = { salesByProduct, salesTotals, paymentsPerDay, ordersOf, itemsByOrder, totalsCsv, ordersCsv };
