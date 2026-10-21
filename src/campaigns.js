// Campaigns: a level above products. A campaign (e.g. "Veggie Deli") has its own public page /boutique/<slug>, its own
// catalogue and its own orders. A campaign has delivery dates; orders are taken for the next one, until `lead_days` days
// before it. With no delivery ahead, or a next delivery closer than that, the shop stays visible but cannot take orders.
const db = require('./db');
const { parseEuros } = require('./catalog');

const slugify = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'campagne';

function uniqueSlug(base, exceptId = null) {
  let slug = base, n = 2;
  while (db.prepare('SELECT id FROM campaigns WHERE slug = ? AND id IS NOT ?').get(slug, exceptId)) slug = `${base.slice(0, 55)}-${n++}`;
  return slug;
}

// ---- delivery dates and the open/closed state they imply (all dates are YYYY-MM-DD, days counted in Paris time)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s) => DATE_RE.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const parisToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(now);
const dayNumber = (s) => Math.round(Date.parse(s + 'T00:00:00Z') / 864e5);
const addDays = (s, n) => new Date((dayNumber(s) + n) * 864e5).toISOString().slice(0, 10);
const deliveries = (campaignId) => db.prepare('SELECT date FROM deliveries WHERE campaign_id = ? ORDER BY date').all(campaignId).map((r) => r.date);

// The campaign's minimum (a weight or an amount) against what has been paid for the next delivery:
// { kind: 'weight' | 'money', value, current, reached } (grams / cents), or null without a minimum
function threshold(c, next) {
  if (!next || !c.min_kind || !(c.min_value > 0)) return null;
  const current = c.min_kind === 'money'
    ? db.prepare("SELECT COALESCE(SUM(total_cents), 0) AS n FROM orders WHERE campaign_id = ? AND status = 'paid' AND delivery_date = ?").get(c.id, next).n
    : db.prepare("SELECT COALESCE(SUM(oi.qty * oi.grams), 0) AS n FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.campaign_id = ? AND o.status = 'paid' AND o.delivery_date = ?").get(c.id, next).n;
  return { kind: c.min_kind, value: c.min_value, current, reached: current >= c.min_value };
}

// { open, reason: 'none' | 'late' | null, next, deadline, dates, threshold }
// next = next delivery (today counts), deadline = last day to order for it
function shopState(c, now = new Date()) {
  const today = parisToday(now), dates = deliveries(c.id), lead = Number(c.lead_days) || 0;
  const next = dates.find((d) => d >= today) || null;
  if (!next) return { open: false, reason: 'none', next: null, deadline: null, dates, threshold: null };
  const deadline = addDays(next, -lead), open = dayNumber(next) - dayNumber(today) >= lead;
  return { open, reason: open ? null : 'late', next, deadline, dates, threshold: threshold(c, next) };
}

const list = () => db.prepare(`SELECT c.*,
  (SELECT COUNT(*) FROM products p WHERE p.campaign_id = c.id) AS products,
  (SELECT COUNT(*) FROM orders o WHERE o.campaign_id = c.id) AS orders,
  (SELECT COUNT(*) FROM orders o WHERE o.campaign_id = c.id AND o.status = 'paid') AS paid_orders
  FROM campaigns c ORDER BY c.id`).all().map((c) => ({ ...c, state: shopState(c) }));
const byId = (id) => db.prepare('SELECT * FROM campaigns WHERE id = ?').get(Number(id) || 0);
const bySlug = (slug) => db.prepare('SELECT * FROM campaigns WHERE slug = ?').get(String(slug));

function check({ name }) {
  const n = String(name ?? '').trim();
  if (!n) return { error: 'Le nom de la campagne est obligatoire.' };
  if (n.length > 80) return { error: 'Nom trop long (80 caractères maximum).' };
  return { name: n };
}

// Copies every product (with variants, sizes, picture, link, description) from one campaign to another.
function copyCatalog(fromId, toId) {
  const nv = db.prepare('INSERT INTO variants (product_id, name, sort, active) VALUES (?,?,?,?)');
  const ns = db.prepare('INSERT INTO sizes (product_id, label, name, grams, units, price_cents, sort, active) VALUES (?,?,?,?,?,?,?,?)');
  for (const p of db.prepare('SELECT * FROM products WHERE campaign_id = ? ORDER BY sort, id').all(fromId)) {
    const pid = Number(db.prepare('INSERT INTO products (campaign_id, name, sort, active, image_url, info_url, description) VALUES (?,?,?,?,?,?,?)')
      .run(toId, p.name, p.sort, p.active, p.image_url, p.info_url, p.description).lastInsertRowid);
    for (const v of db.prepare('SELECT * FROM variants WHERE product_id = ? ORDER BY sort, id').all(p.id)) nv.run(pid, v.name, v.sort, v.active);
    for (const s of db.prepare('SELECT * FROM sizes WHERE product_id = ? ORDER BY sort, id').all(p.id)) ns.run(pid, s.label, s.name, s.grams, s.units, s.price_cents, s.sort, s.active);
  }
}

function create(input) {
  const c = check(input);
  if (c.error) return c;
  const copyFrom = input.copyFrom ? byId(input.copyFrom) : null;
  if (input.copyFrom && !copyFrom) return { error: 'La campagne à copier n’existe pas.' };
  db.exec('BEGIN');
  try {
    const id = Number(db.prepare('INSERT INTO campaigns (name, slug) VALUES (?,?)').run(c.name, uniqueSlug(slugify(c.name))).lastInsertRowid);
    if (copyFrom) copyCatalog(copyFrom.id, id);
    db.exec('COMMIT');
    return { id };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function update(id, input) {
  const cur = byId(id);
  if (!cur) return { error: 'Campagne introuvable.' };
  const c = check(input);
  if (c.error) return c;
  // The page address comes from the name ("Noël 2026" -> noel-2026); it only changes when the name does.
  const slug = c.name === cur.name ? cur.slug : uniqueSlug(slugify(c.name), cur.id);
  // delivery dates: any number, blanks ignored, duplicates merged
  const dates = [...new Set((input.dates || []).map((d) => String(d).trim()).filter(Boolean))].sort();
  const badDate = dates.find((d) => !validDate(d));
  if (badDate) return { error: `Date de livraison invalide : « ${badDate} ».` };
  if (dates.length > 60) return { error: 'Trop de dates de livraison (60 maximum).' };
  const leadText = String(input.lead_days ?? '').trim();
  const lead = leadText === '' ? cur.lead_days : Number(leadText);
  if (!Number.isInteger(lead) || lead < 0 || lead > 365) return { error: 'Le délai maximum de commande doit être un nombre entier de jours (0 à 365).' };
  // header_html: raw HTML written by an admin, shown on the public shop page. null/undefined = leave unchanged.
  const header = input.header_html == null ? cur.header_html : String(input.header_html).trim();
  if (header.length > 20000) return { error: 'En-tête HTML trop long (20 000 caractères maximum).' };
  // minimum to reach for a delivery: a weight (kg) or an amount (€); empty = none, no field at all = unchanged
  let minKind = cur.min_kind, minValue = cur.min_value;
  if (input.min_value != null) {
    const raw = String(input.min_value).trim().replace(',', '.');
    if (raw === '') { minKind = ''; minValue = 0; }
    else if (input.min_unit === 'eur') { minKind = 'money'; minValue = parseEuros(raw); }
    else { minKind = 'weight'; const kg = /^\d{1,6}(\.\d{1,3})?$/.test(raw) ? Number(raw) : NaN; minValue = Math.round(kg * 1000); }
    if (raw !== '' && !(minValue > 0 && minValue <= 1e9)) return { error: 'Le seuil minimum doit être un nombre positif (ex. 50 kg ou 500 €).' };
  }
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE campaigns SET name = ?, slug = ?, header_html = ?, lead_days = ?, min_kind = ?, min_value = ? WHERE id = ?').run(c.name, slug, header, lead, minKind, minValue, cur.id);
    if (input.dates) {                                   // no dates field at all = leave the dates as they are
      db.prepare('DELETE FROM deliveries WHERE campaign_id = ?').run(cur.id);
      for (const d of dates) db.prepare('INSERT INTO deliveries (campaign_id, date) VALUES (?, ?)').run(cur.id, d);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { ok: true };
}

// A campaign that has orders can only be closed, never deleted (its sales history must stay).
function remove(id) {
  const cur = byId(id);
  if (!cur) return { error: 'Campagne introuvable.' };
  if (db.prepare('SELECT COUNT(*) AS n FROM orders WHERE campaign_id = ?').get(cur.id).n)
    return { error: `« ${cur.name} » a des commandes : elle ne peut pas être supprimée.` };
  db.prepare('DELETE FROM campaigns WHERE id = ?').run(cur.id);
  return { ok: true, name: cur.name };
}

module.exports = { list, byId, bySlug, create, update, remove, shopState };
