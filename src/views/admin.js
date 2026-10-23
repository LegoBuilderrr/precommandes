// Admin screens: campaigns, orders (Produits / Clients tabs), product editor shell, login.
const { fmtWeight } = require('../weight');
const { esc, euros, label, json, layout, frDate, thresholdText } = require('./common');

// admin weights are always grams ("84 910 g"), except the total to prepare which is in kg
const fmtG = (g) => `${String(Math.round(g)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} g`;
const fmtKg = (g) => `${(g / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} kg`;
const orderWeight = (items = []) => { const g = items.reduce((n, i) => n + i.qty * (i.grams || 0), 0); return g ? `<br><small class="hint">Poids : ${fmtG(g)}</small>` : ''; };
// a weighted price is shown as grams ("1 000 g", not "1kg"), preceded by its customer-facing name when it has one ("x2 (160 g)");
// prices sold by the unit / free text keep their label
const sizeG = (size, grams, name = '') => { const g = grams == null ? size : fmtG(grams); return name ? (grams == null ? name : `${name} (${g})`) : g; };
const lineText = (i) => `${i.qty} × ${esc(label(i.product, i.variant, sizeG(i.size, i.grams, i.size_name)))}`;
const STATUS_FR = { pending: 'En attente', paid: 'Payée', failed: 'Échec', refunding: 'Remboursement en cours', refunded: 'Remboursée' };

// Campaign picker, shown prominently at the top of every campaign-scoped admin page (there is no "all campaigns" view).
// ctx = { campaigns (newest first), campaign (the one being viewed) }
const campaignBar = (ctx, action, mode = '') => `<div class="campbar"><div class="campbar-in">
<a class="back" href="/admin">← Retour</a>
<form method="get" action="${action}">${mode ? `<input type="hidden" name="mode" value="${mode}">` : ''}<label>Campagne
<select name="c" onchange="this.form.submit()">${ctx.campaigns.map((c) => `<option value="${c.id}"${c.id === ctx.campaign.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
<noscript><button>OK</button></noscript></form></div></div>`;
// The two ways of looking at a campaign's orders: per product, or per customer (one line per order).
const tabs = (cid, mode) => `<div class="tabs"><a class="tab${mode === 'produits' ? ' on' : ''}" href="/admin/commandes?c=${cid}&mode=produits">Produits</a><a class="tab${mode === 'clients' ? ' on' : ''}" href="/admin/commandes?c=${cid}&mode=clients">Clients</a></div>`;

const kpis = (k) => `<div class="kpis"><div class="kpi"><b>${euros(k.paid_cents)}</b>encaissé (${k.paid_orders} commandes)</div>
<div class="kpi"><b>${fmtKg(k.paid_grams)}</b>total${k.paid_noweight ? `<small class="hint">${k.paid_noweight} article(s) sans poids non comptés</small>` : ''}</div>${k.refunded_orders ? `<div class="kpi"><b>${euros(k.refunded_cents)}</b>remboursé (${k.refunded_orders} commandes)</div>` : ''}</div>`;

function dashboard(k, rows, perDay, msg, ctx) {
  const byProduct = new Map();
  for (const r of rows) {
    const g = byProduct.get(r.product) || { name: r.product, qty: 0, grams: 0, lines: [] };
    g.qty += r.paid_qty; g.grams += r.paid_grams; g.lines.push(r);
    byProduct.set(r.product, g);
  }
  const table = [...byProduct.values()].map((g) =>
    `<tr class="ph"><td><b>${esc(g.name)}</b><td class="num">${g.qty}<td class="num">${g.grams ? fmtG(g.grams) : ''}</tr>` +
    g.lines.map((r) => `<tr class="pl"><td>${esc(label(r.variant, sizeG(r.size, r.grams, r.size_name)))}<td class="num">${r.paid_qty}<td class="num">${r.paid_grams ? fmtG(r.paid_grams) : ''}</tr>`).join('')).join('');
  const cid = ctx.campaign.id;
  return layout('Commandes', `<h1>Commandes</h1>${msg ? `<p class="note">${esc(msg)}</p>` : ''}
${kpis(k)}
<div class="actions"><a class="btn" href="/admin/totaux.csv?c=${cid}">Télécharger (CSV)</a></div>
${tabs(cid, 'produits')}
<table class="sales"><tr><th>Produit<th class="num">Vendus<th class="num">Poids</tr>${table || '<tr><td colspan="3">Aucune vente pour le moment.</tr>'}</table>
<h2 class="spaced">Par jour (paiements reçus)</h2><table class="days"><tr><th>Jour<th class="num">Commandes<th class="num">Montant</tr>${
    perDay.map((d) => `<tr><td>${esc(d.day)}<td class="num">${d.n}<td class="num">${euros(d.cents)}</tr>`).join('') || '<tr><td colspan="3">—</tr>'}</table>`,
  { admin: true, bar: campaignBar(ctx, '/admin/commandes', 'produits') });
}

function productsPage(tree, ctx) {
  return layout(`Produits · ${ctx.campaign.name}`, `<div id="app" data-campaign="${ctx.campaign.id}"></div><script id="init" type="application/json">${json(tree)}</script>`,
    { admin: true, bar: campaignBar(ctx, '/admin/produits'), script: '<script src="/assets/admin-products.js"></script>' });
}

// Orders that never got paid (checkout abandoned or refused, or HelloAsso unreachable): hidden until the box under the table is ticked.
const UNPAID = ['pending', 'failed'];

function ordersPage(orders, itemsByOrder, msg, ctx, k) {
  const cid = ctx.campaign.id;
  const nUnpaid = orders.filter((o) => UNPAID.includes(o.status)).length;
  const rows = orders.map((o) => {
    const refund = o.status === 'paid'
      ? `<form method="post" action="/admin/commandes/rembourser" data-confirm="Rembourser intégralement la commande n°${o.number} (${euros(o.total_cents)}) à ${esc(o.first_name)} ${esc(o.last_name)} ? Cette action est définitive." onsubmit="return confirm(this.dataset.confirm)"><input type="hidden" name="id" value="${o.id}"><button class="refund">↩ Rembourser</button></form>`
      : o.status === 'refunded' && o.refunded_at ? `<small class="hint">le ${esc(o.refunded_at)}</small>` : '';
    return `<tr${UNPAID.includes(o.status) ? ' class="unpaid"' : ''}><td>${o.number ?? '—'}${o.demo ? '<br><small class="pill demo">démo</small>' : ''}<td>${esc(o.created_at)}<td>${esc(o.first_name)} ${esc(o.last_name)}<br>${esc(o.email)}` +
      `<td>${(itemsByOrder.get(o.id) || []).map(lineText).join('<br>')}${orderWeight(itemsByOrder.get(o.id))}${o.comment ? `<br><i>${esc(o.comment)}</i>` : ''}<td class="num">${euros(o.total_cents)}` +
      `<td class="st ${esc(o.status)}">${esc(STATUS_FR[o.status] || o.status)}<br>${refund}</tr>`;
  }).join('');
  return layout('Commandes', `<h1>Commandes</h1>${msg ? `<p class="note">${esc(msg)}</p>` : ''}
${kpis(k)}
<div class="actions"><a class="btn" href="/admin/commandes.csv?c=${cid}">Télécharger (CSV)</a></div>
${tabs(cid, 'clients')}
<div class="ordwrap"><table class="orders"><tr><th>N°<th>Date<th>Client<th>Articles<th class="num">Total<th>Statut</tr>${rows}${
    !orders.length ? '<tr><td colspan="6">Aucune commande.</tr>' : nUnpaid === orders.length ? '<tr class="paidnone"><td colspan="6">Aucune commande payée.</tr>' : ''}</table>
<label class="showpending"><input type="checkbox" id="showpending"> Voir les commandes en attente (${nUnpaid})</label></div>`,
  { admin: true, bar: campaignBar(ctx, '/admin/commandes', 'clients') });
}

const COPY_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>';

// Admin: how far the paid orders for the next delivery are from the campaign's minimum
const thresholdHint = (st) => {
  const t = st.threshold; if (!t) return '';
  const cur = t.kind === 'money' ? euros(t.current) : fmtWeight(t.current);
  return `<div class="hint">Seuil minimum : ${esc(thresholdText(t))} · ${t.reached ? `atteint (${esc(cur)})` : `pas encore atteint (${esc(cur)} commandés et payés)`}</div>`;
};

function campaignsPage(list, msg = '', baseUrl = '') {
  const cards = list.map((c) => `<section class="card camp">
<div class="camphead"><div><h2>${esc(c.name)} <span class="pill ${c.state.open ? 'open' : 'closed'}">${c.state.open ? 'Commandes ouvertes' : 'Commandes fermées'}</span></h2>
<div class="hint">${c.state.next ? `Prochaine livraison : ${esc(frDate(c.state.next))}${c.state.open ? ` · commandes jusqu’au ${esc(frDate(c.state.deadline))} inclus` : ` · commandes terminées depuis le ${esc(frDate(c.state.deadline))}`}` : 'Aucune livraison à venir : la boutique reste visible mais ne prend pas de commande.'}</div>
${thresholdHint(c.state)}
<div class="hint shoplink">Lien vers la boutique : <a href="/boutique/${esc(c.slug)}" target="_blank" rel="noopener">${esc(baseUrl)}/boutique/${esc(c.slug)} ↗</a>
<button type="button" class="ibtn copybtn" data-copy="${esc(baseUrl)}/boutique/${esc(c.slug)}" title="Copier le lien" aria-label="Copier le lien vers la boutique">${COPY_ICON}</button><span class="copied-msg" role="status"></span></div></div>
<div class="campbtns"><a class="btn" href="/admin/produits?c=${c.id}">Produits</a><a class="btn" href="/admin/commandes?c=${c.id}">Commandes</a></div></div>
<details><summary>Modifier la campagne</summary>
<form method="post" action="/admin/campagnes/enregistrer" class="cform"><input type="hidden" name="id" value="${c.id}">
<label>Nom<input type="text" name="name" value="${esc(c.name)}" required maxlength="80"></label>
<fieldset class="dates"><legend>Dates de livraison</legend>
<div class="datelist">${[...c.state.dates, ''].map((d) => `<div class="daterow"><input type="date" name="delivery_date" value="${esc(d)}"><button type="button" class="ibtn rmdate" title="Retirer cette date" aria-label="Retirer cette date">✕</button></div>`).join('')}</div>
<button type="button" class="flat adddate">+ Ajouter une date</button></fieldset>
<label>Délai maximum de commande (jours avant la livraison)<input type="number" name="lead_days" min="0" max="365" step="1" value="${Number(c.lead_days) || 0}" required></label>
<label>Seuil minimum (poids ou montant)<span class="minrow"><input type="number" name="min_value" min="0" step="any" placeholder="aucun" value="${c.min_kind === 'money' ? c.min_value / 100 : c.min_kind === 'weight' ? c.min_value / 1000 : ''}">
<select name="min_unit" aria-label="Unité du seuil"><option value="kg"${c.min_kind !== 'money' ? ' selected' : ''}>kg</option><option value="eur"${c.min_kind === 'money' ? ' selected' : ''}>€</option></select></span></label>
<label>En-tête HTML (optionnel)<textarea name="header_html" rows="6" class="code" maxlength="20000" placeholder="&lt;div&gt;Bienvenue ! …&lt;/div&gt;">${esc(c.header_html)}</textarea></label>
<div class="actions"><button>Enregistrer</button></div></form>
<form method="post" action="/admin/campagnes/supprimer" onsubmit="return confirm('Supprimer cette campagne et ses produits ?')"><input type="hidden" name="id" value="${c.id}">
<button class="flat" ${c.orders ? 'disabled title="Une campagne qui a des commandes ne peut pas être supprimée."' : ''}>🗑 Supprimer la campagne</button></form></details></section>`).join('');
  return layout('Administration des précommandes', `<h1 class="pagetitle">Administration des précommandes</h1>${msg ? `<p class="note">${esc(msg)}</p>` : ''}
<h2>Campagnes (${list.length})</h2>${cards || '<p>Aucune campagne.</p>'}
<section class="card newcamp"><h2>Nouvelle campagne</h2><form method="post" action="/admin/campagnes/creer" class="cform">
<label>Nom *<input type="text" name="name" required maxlength="80" placeholder="ex. Noël 2026"></label>
<label>Produits de départ<select name="copyFrom"><option value="">Aucun : campagne vide</option>${list.map((c) => `<option value="${c.id}">Copier les produits de « ${esc(c.name)} »</option>`).join('')}</select></label>
<div class="actions"><button class="primary">Créer la campagne</button></div></form></section>`, { admin: true, script: '<script src="/assets/admin-campaigns.js"></script>' });
}

// Admin login page: one password field.
const loginPage = (error = '') => layout('Connexion', `<h1 class="pagetitle">Administration des précommandes</h1>
<section class="card newcamp"><form method="post" action="/admin/connexion" class="cform">
${error ? `<p class="alert">${esc(error)}</p>` : ''}
<label>Mot de passe<input type="password" name="password" required autofocus autocomplete="current-password"></label>
<div class="actions"><button class="primary">Entrer</button></div></form></section>`, { admin: true });

module.exports = { loginPage, campaignsPage, dashboard, ordersPage, productsPage };
