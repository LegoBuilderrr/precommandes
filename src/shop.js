// Public routes: the campaigns list, a campaign's shop, placing an order, and the page customers come back to after paying.
const db = require('./db');
const catalog = require('./catalog');
const campaigns = require('./campaigns');
const ha = require('./helloasso');
const v = require('./views');
const { BASE_URL } = require('./config');
const { SHOP_HEADERS, send, redirect, readForm } = require('./http');
const { refreshOrder, paymentInfo } = require('./orders');

const notFound = (res, what) => send(res, 404, v.layout('Introuvable', `<p>${what} introuvable.</p>`));

// GET / : the campaigns (a single one: straight to its shop)
function home(res) {
  const all = campaigns.list().reverse();                                  // newest first
  if (all.length === 1) return send(res, 302, '', 'text/plain', { Location: `/boutique/${all[0].slug}` });
  return send(res, 200, v.landing(all));
}

// GET /boutique/<slug>
function shopPage(res, slug) {
  const c = campaigns.bySlug(slug);
  if (!c) return notFound(res, 'Campagne');
  return send(res, 200, v.orderForm(c, catalog.loadTree({ campaignId: c.id, forOrder: true }), {}, '', campaigns.shopState(c)), undefined, SHOP_HEADERS);
}

// POST /commander : checks the cart against the catalogue, stores the order, sends the customer to HelloAsso to pay
async function submitOrder(req, res) {
  const values = Object.fromEntries(await readForm(req));
  const campaign = campaigns.bySlug(values.campaign || '');
  if (!campaign) return notFound(res, 'Campagne');
  const state = campaigns.shopState(campaign);                                   // orders go to the next delivery, while it is open
  const tree = catalog.loadTree({ campaignId: campaign.id, forOrder: true });   // only this campaign's products can be bought
  if (!state.open) return send(res, 403, v.orderForm(campaign, tree, {}, '', state), undefined, SHOP_HEADERS);
  const fail = (msg) => send(res, 400, v.orderForm(campaign, tree, values, msg, state), undefined, SHOP_HEADERS);

  const customer = { first: (values.first_name || '').trim(), last: (values.last_name || '').trim(), email: (values.email || '').trim(), comment: (values.comment || '').trim() };
  if (!customer.first || !customer.last || !customer.email) return fail('Merci de remplir tous les champs obligatoires.');
  if (customer.first.length < 2 || customer.last.length < 2) return fail('Prénom et nom : 2 caractères minimum chacun.');
  if (!/^[^@\s]+@[^@\s]+$/.test(customer.email)) return fail('Adresse mail invalide.');

  // What can be bought now: size id -> product; variant id -> variant (prices always come from the DB).
  const sizes = new Map(), unavailable = 'Un produit n\'est plus disponible : vérifiez votre panier.';
  for (const p of tree) for (const s of p.sizes) sizes.set(s.id, { p, s });
  const lines = [];
  for (const [key, raw] of Object.entries(values)) {
    const m = /^q_(\d+)_(\d+)$/.exec(key);                                       // q_<size id>_<variant id, 0 without options>
    const qtyText = raw.trim();
    if (!m || qtyText === '' || qtyText === '0') continue;
    if (!/^\d{1,3}$/.test(qtyText)) return fail('Quantité invalide.');
    const hit = sizes.get(Number(m[1]));
    if (!hit) return fail(unavailable);
    const variantId = Number(m[2]);
    const variant = hit.p.variants.length ? hit.p.variants.find((x) => x.id === variantId) : null;
    if (hit.p.variants.length ? !variant : variantId !== 0) return fail(unavailable);
    lines.push({ p: hit.p, variant, s: hit.s, qty: Number(qtyText) });
  }
  if (!lines.length) return fail('Choisissez au moins un produit.');
  const total = lines.reduce((sum, l) => sum + l.s.price_cents * l.qty, 0);

  db.exec('BEGIN');
  let orderId;
  try {
    // the member number column is kept but not asked for now
    orderId = Number(db.prepare(`INSERT INTO orders (campaign_id, campaign, first_name, last_name, member_no, email, comment, total_cents, delivery_date) VALUES (?,?,?,?,'',?,?,?,?)`)
      .run(campaign.id, campaign.name, customer.first, customer.last, customer.email, customer.comment, total, state.next).lastInsertRowid);
    const ins = db.prepare('INSERT INTO order_items (order_id, product_id, variant_id, size_id, product, variant, size, size_name, unit_cents, qty, grams) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    for (const l of lines) ins.run(orderId, l.p.id, l.variant ? l.variant.id : null, l.s.id, l.p.name, l.variant ? l.variant.name : '', l.s.label, l.s.name || '', l.s.price_cents, l.qty, l.s.grams);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  try {
    const intent = await ha.createCheckout({
      orderId, campaignName: campaign.name, firstName: customer.first, lastName: customer.last, email: customer.email, comment: customer.comment,
      items: lines.map((l) => ({ product: l.p.name, variant: l.variant ? l.variant.name : '', size: l.s.name || l.s.label, qty: l.qty })),
      totalCents: total, baseUrl: BASE_URL,
    });
    db.prepare('UPDATE orders SET intent_id = ?, redirect_url = ? WHERE id = ?').run(intent.id, intent.redirectUrl, orderId);
    redirect(res, intent.redirectUrl);
  } catch (e) {
    db.prepare("UPDATE orders SET status = 'failed', ha_raw = ? WHERE id = ?").run(String(e.message), orderId);
    console.error('checkout failed for order', orderId, e.message);
    send(res, 502, v.orderForm(campaign, tree, values, e.userMessage ? `Paiement refusé par HelloAsso : ${e.userMessage}` : 'Paiement indisponible, réessayez plus tard.', state), undefined, SHOP_HEADERS);
  }
}

// GET /retour?o=<order id> : where HelloAsso sends the customer back; shows the order with its refreshed status
async function returnPage(url, res) {
  const id = url.searchParams.get('o') || '';
  const o = /^\d+$/.test(id) ? db.prepare('SELECT * FROM orders WHERE id = ?').get(id) : null;
  if (!o) return notFound(res, 'Commande');
  const status = await refreshOrder(o);
  const fresh = db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(o.id);
  const camp = fresh.campaign_id ? campaigns.byId(fresh.campaign_id) : null;
  send(res, 200, v.returnPage(fresh, status, items, paymentInfo(fresh), camp ? camp.slug : ''));
}

module.exports = { home, shopPage, submitOrder, returnPage };
