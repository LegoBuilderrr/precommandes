// Admin routes (the caller has already checked the password):
//   GET  /admin                        campaigns: create, edit, delete          POST /admin/campagnes/{creer,enregistrer,supprimer}
//   GET  /admin/commandes?c=&mode=     orders of a campaign (mode produits | clients), CSV exports, refunds
//   GET  /admin/produits?c=            product editor                           POST /admin/api/{catalogue,televerser}
// The admin always looks at ONE campaign: ?c=<id>, or the latest one by default (there is no "all campaigns" view).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');
const catalog = require('./catalog');
const campaigns = require('./campaigns');
const ha = require('./helloasso');
const v = require('./views');
const reports = require('./reports');
const { BASE_URL, UPLOAD_DIR } = require('./config');
const { send, redirect, sendJson, download, msgUrl, readBuffer, readBody, readForm, sniffImage, eur } = require('./http');
const { paymentInfo } = require('./orders');

const latestCampaign = () => db.prepare('SELECT * FROM campaigns ORDER BY id DESC LIMIT 1').get();
const CSV_TYPE = 'text/csv; charset=utf-8';
const CAMPAIGN_PAGES = ['/admin/commandes', '/admin/produits', '/admin/totaux.csv', '/admin/commandes.csv'];

// POST /admin/commandes/rembourser : full refund of a paid order through HelloAsso (simulated for demo orders)
async function refundOrder(req, res) {
  const f = await readForm(req);
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(f.get('id')) || 0);
  const back = (m) => redirect(res, msgUrl(`/admin/commandes?c=${(o && o.campaign_id) || (latestCampaign() || {}).id}&mode=clients`, m));
  if (!o) return back('Commande introuvable.');
  if (o.status !== 'paid') return back(`La commande n°${o.id} n’est pas payée : rien à rembourser.`);
  const pay = paymentInfo(o);
  if (!o.demo && !(pay && pay.id)) return back(`Remboursement impossible : la référence du paiement HelloAsso de la commande n°${o.id} est introuvable. Remboursez-la depuis l’espace HelloAsso.`);
  // Lock first: a second click (or a second admin) cannot refund the same order twice.
  if (!db.prepare("UPDATE orders SET status = 'refunding' WHERE id = ? AND status = 'paid'").run(o.id).changes) return back('Un remboursement est déjà en cours pour cette commande.');
  let r;
  if (o.demo) r = { ok: true, text: 'demo order: refund simulated, no HelloAsso call' };
  else try { r = await ha.refundPayment(pay.id); } catch (e) { r = { ok: false, status: 0, text: String(e.message) }; }
  if (r.ok) {
    db.prepare("UPDATE orders SET status = 'refunded', refunded_at = datetime('now'), refund_raw = ? WHERE id = ?").run(r.text.slice(0, 4000), o.id);
    return back(`Commande n°${o.id} remboursée (${eur(o.total_cents)} €)${o.demo ? ' : simulation, commande de démonstration' : ''}.`);
  }
  db.prepare("UPDATE orders SET status = 'paid', refund_raw = ? WHERE id = ?").run(`HTTP ${r.status}: ${r.text.slice(0, 500)}`, o.id);
  return back(`HelloAsso a refusé le remboursement de la commande n°${o.id} (code ${r.status || 'réseau'}). La commande reste payée.`);
}

// POST /admin/api/televerser : a picture for a product (kept in UPLOAD_DIR, served as /uploads/<name>)
async function uploadPicture(req, res) {
  let buf;
  try { buf = await readBuffer(req, 3e6); } catch { return sendJson(res, 413, { ok: false, error: 'Image trop lourde (3 Mo maximum).' }); }
  const ext = sniffImage(buf);
  if (!ext) return sendJson(res, 400, { ok: false, error: 'Format non pris en charge (JPEG, PNG, WebP ou GIF).' });
  const name = `${crypto.randomBytes(8).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return sendJson(res, 200, { ok: true, url: `/uploads/${name}` });
}

// POST /admin/api/catalogue?c= : saves the whole product tree of a campaign
async function saveCatalogue(req, res, url) {
  const campaign = campaigns.byId(url.searchParams.get('c'));
  if (!campaign) return sendJson(res, 404, { ok: false, error: 'Campagne introuvable.' });
  let input;
  try { input = JSON.parse(await readBody(req, 5e6)); } catch { return sendJson(res, 400, { ok: false, error: 'Requête invalide.' }); }
  const r = catalog.saveTree(campaign.id, input);
  return r.error ? sendJson(res, 400, { ok: false, error: r.error }) : sendJson(res, 200, { ok: true, tree: r.tree });
}

async function admin(req, res, url) {
  const p = url.pathname, post = req.method === 'POST', msg = url.searchParams.get('msg') || '';
  const campaign = campaigns.byId(url.searchParams.get('c')) || latestCampaign();
  const cid = campaign ? campaign.id : null;
  const ctx = () => ({ campaigns: campaigns.list().reverse(), campaign });          // newest first in the picker

  if (!post) {
    if (CAMPAIGN_PAGES.includes(p) && !campaign) return redirect(res, msgUrl('/admin', 'Créez d’abord une campagne.'));
    if (p === '/admin') return send(res, 200, v.campaignsPage(campaigns.list(), msg, BASE_URL));
    if (p === '/admin/commandes') {
      const totals = reports.salesTotals(cid);
      return send(res, 200, url.searchParams.get('mode') === 'clients'
        ? v.ordersPage(reports.ordersOf(cid), reports.itemsByOrder(), msg, ctx(), totals)
        : v.dashboard(totals, reports.salesByProduct(cid), reports.paymentsPerDay(cid), msg, ctx()));
    }
    if (p === '/admin/produits') return send(res, 200, v.productsPage(catalog.loadTree({ campaignId: cid }), ctx()));
    if (p === '/admin/totaux.csv') return send(res, 200, reports.totalsCsv(cid), CSV_TYPE, download('totaux-par-produit.csv'));
    if (p === '/admin/commandes.csv') return send(res, 200, reports.ordersCsv(cid), CSV_TYPE, download('commandes.csv'));
  } else {
    if (p === '/admin/commandes/rembourser') return refundOrder(req, res);
    if (p === '/admin/campagnes/creer') {
      const f = await readForm(req);
      const r = campaigns.create({ name: f.get('name'), copyFrom: f.get('copyFrom') });
      return redirect(res, r.error ? msgUrl('/admin', r.error) : `/admin/produits?c=${r.id}`);
    }
    if (p === '/admin/campagnes/enregistrer') {
      const f = await readForm(req);
      const r = campaigns.update(f.get('id'), {
        name: f.get('name'), header_html: f.get('header_html'), dates: f.getAll('delivery_date'), lead_days: f.get('lead_days'),
        min_value: f.get('min_value'), min_unit: f.get('min_unit'),
      });
      return redirect(res, msgUrl('/admin', r.error || 'Campagne enregistrée.'));
    }
    if (p === '/admin/campagnes/supprimer') {
      const r = campaigns.remove((await readForm(req)).get('id'));
      return redirect(res, msgUrl('/admin', r.error || `Campagne « ${r.name} » supprimée.`));
    }
    if (p === '/admin/api/televerser') return uploadPicture(req, res);
    if (p === '/admin/api/catalogue') return saveCatalogue(req, res, url);
  }
  send(res, 404, v.layout('404', '<p>Page introuvable.</p>', { admin: true }));
}

module.exports = { admin };
