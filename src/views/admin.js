// Admin screens: campaigns, orders (Produits / Clients tabs), product editor shell, login.
const { fmtWeight } = require('../weight');
const { esc, euros, label, json, layout, frDay, thresholdText } = require('./common');

// admin weights are always grams ("84 910 g"), except the total to prepare which is in kg
const fmtG = (g) => `${String(Math.round(g)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} g`;
const fmtKg = (g) => `${(g / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} kg`;
const orderWeight = (items = []) => { const g = items.reduce((n, i) => n + i.qty * (i.grams || 0), 0); return g ? `<br><small class="hint">Poids : ${fmtG(g)}</small>` : ''; };
// a weighted price is shown as grams ("1 000 g", not "1kg"), preceded by its customer-facing name when it has one ("x2 (160 g)");
// prices sold by the unit / free text keep their label
const sizeG = (size, grams, name = '') => { const g = grams == null ? size : fmtG(grams); return name ? (grams == null ? name : `${name} (${g})`) : g; };
const lineText = (i) => `${i.qty} × ${esc(label(i.product, i.variant, sizeG(i.size, i.grams, i.size_name)))}`;
const STEP_OPTIONS = [['', 'Payée'], ['prepared', 'Préparée'], ['contacted', 'Contactée'], ['collected', 'Retirée'], ['refunded', 'Remboursée']];
const STATUS_FR = { pending: 'En attente', paid: 'Payée', failed: 'Échec', refunding: 'Remboursement en cours', refunded: 'Remboursée' };

// "cdeligeon · Déconnexion" (nothing in the open local admin)
const whoBox = (user) => (user && user.login ? `<form method="post" action="/admin/deconnexion" class="who">${esc(user.login)} · <button class="flat">Déconnexion</button></form>` : '');

// Campaign picker, shown prominently at the top of every campaign-scoped admin page (there is no "all campaigns" view).
// ctx = { campaigns (newest first), campaign (the one being viewed) }
const campaignBar = (ctx, action, mode = '') => `<div class="campbar"><div class="campbar-in">
<a class="back" href="/admin">← Retour</a>
<form method="get" action="${action}">${mode ? `<input type="hidden" name="mode" value="${mode}">` : ''}<label>Campagne
<select name="c" onchange="this.form.submit()">${ctx.campaigns.map((c) => `<option value="${c.id}"${c.id === ctx.campaign.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
<noscript><button>OK</button></noscript></form>${whoBox(ctx.user)}</div></div>`;
// The two ways of looking at a campaign's orders: per product, or per customer (one line per order).
const tabs = (cid, mode) => `<div class="tabs"><a class="tab${mode === 'produits' ? ' on' : ''}" href="/admin/commandes?c=${cid}&mode=produits">Produits</a><a class="tab${mode === 'clients' ? ' on' : ''}" href="/admin/commandes?c=${cid}&mode=clients">Clients</a></div>`;

const kpis = (k) => `<div class="kpis"><div class="kpi"><b>${euros(k.paid_cents)}</b>encaissé (${k.paid_orders} commandes)</div>
<div class="kpi"><b>${fmtKg(k.paid_grams)}</b>total${k.paid_noweight ? `<small class="hint">${k.paid_noweight} article(s) sans poids non comptés</small>` : ''}</div>${k.refunded_orders ? `<div class="kpi"><b>${euros(k.refunded_cents)}</b>remboursé (${k.refunded_orders} commandes)</div>` : ''}</div>`;

function dashboard(k, rows, perDay, msg, ctx) {
  const byProduct = new Map();
  for (const r of rows) {
    const g = byProduct.get(r.product) || { name: r.product, lines: [] };
    g.lines.push(r);
    byProduct.set(r.product, g);
  }
  const table = [...byProduct.values()].map((g) =>
    `<tr class="ph"><td colspan="3"><b>${esc(g.name)}</b></tr>` +
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
    const refund = o.status === 'paid' && ctx.canEdit
      ? `<form method="post" action="/admin/commandes/rembourser" class="refundform" data-confirm="Rembourser intégralement la commande n°${o.number} (${euros(o.total_cents)}) à ${esc(o.first_name)} ${esc(o.last_name)} ? Cette action est définitive." onsubmit="return confirm(this.dataset.confirm)"><input type="hidden" name="id" value="${o.id}"><button class="refund">↩ Rembourser</button></form>`
      : '';
    // a paid order is followed by hand (menu saved on change); "Remboursée" is listed but cannot be picked: only the refund button sets it, and then the menu stays locked on it
    const status = o.status === 'paid'
      ? `<select class="stepsel" data-id="${o.id}" data-prev="${esc(o.step || '')}" aria-label="Étape de la commande n°${o.number}">${STEP_OPTIONS.map(([v, t]) => `<option value="${v}"${v === (o.step || '') ? ' selected' : ''}${v === 'refunded' ? ' disabled' : ''}>${t}</option>`).join('')}</select><span class="stepmsg" role="status"></span>`
      : o.status === 'refunded' ? `<select class="stepsel" disabled aria-label="Commande n°${o.number} remboursée"><option selected>Remboursée</option></select>${o.refunded_at ? `<br><small class="hint">le ${esc(o.refunded_at)}</small>` : ''}`
      : `${esc(STATUS_FR[o.status] || o.status)}`;
    return `<tr${UNPAID.includes(o.status) ? ' class="unpaid"' : ''}><td>${o.number ?? '—'}${o.demo ? '<br><small class="pill demo">démo</small>' : ''}<td>${esc(o.created_at)}<td>${esc(o.first_name)} ${esc(o.last_name)}<br>${esc(o.email)}` +
      `<td>${(itemsByOrder.get(o.id) || []).map(lineText).join('<br>')}${orderWeight(itemsByOrder.get(o.id))}${o.comment ? `<br><i>${esc(o.comment)}</i>` : ''}<td class="num">${euros(o.total_cents)}${refund ? `<br>${refund}` : ''}` +
      `<td class="st ${esc(o.status)}">${status}</tr>`;
  }).join('');
  return layout('Commandes', `<h1>Commandes</h1>${msg ? `<p class="note">${esc(msg)}</p>` : ''}
${kpis(k)}
<div class="actions"><a class="btn" href="/admin/commandes.csv?c=${cid}">Télécharger (CSV)</a></div>
${tabs(cid, 'clients')}
<div class="ordwrap"><table class="orders"><tr><th>N°<th>Date<th>Client<th>Articles<th class="num">Total<th>Statut</tr>${rows}${
    !orders.length ? '<tr><td colspan="6">Aucune commande.</tr>' : nUnpaid === orders.length ? '<tr class="paidnone"><td colspan="6">Aucune commande payée.</tr>' : ''}</table>
<label class="showpending"><input type="checkbox" id="showpending"> Voir les commandes en attente (${nUnpaid})</label></div>`,
  { admin: true, bar: campaignBar(ctx, '/admin/commandes', 'clients'), script: '<script src="/assets/admin-orders.js"></script>' });
}

const COPY_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>';

// Admin: how far the paid orders for the next delivery are from the campaign's minimum
const thresholdHint = (st) => {
  const t = st.threshold; if (!t) return '';
  const cur = t.kind === 'money' ? euros(t.current) : fmtWeight(t.current);
  return `<div class="hint">Vendu : ${esc(cur)} (${t.reached ? '✅' : '❌'} Seuil ${esc(thresholdText(t))})</div>`;
};

// user = { login, role }: a 'precommandes' member only follows the orders (no product editor, no campaign editing, no new campaign)
function campaignsPage(list, msg = '', baseUrl = '', user = null) {
  const canEdit = !user || user.role === 'admin';
  const cards = list.map((c) => `<section class="card camp">
<div class="camphead"><div><h2>${esc(c.name)} <span class="pill ${c.state.open ? 'open' : 'closed'}">${c.state.open ? 'Ouverte' : 'Fermée'}</span></h2>
<div class="hint">${c.state.next ? `Clôture commandes : ${esc(frDay(c.state.deadline))}<br>Livraison : ${esc(frDay(c.state.next))}` : 'Aucune livraison à venir : la boutique reste visible mais ne prend pas de commande.'}</div>
${thresholdHint(c.state)}
<div class="hint shoplink">Lien vers la boutique : <a href="/boutique/${esc(c.slug)}" target="_blank" rel="noopener">${esc(baseUrl)}/boutique/${esc(c.slug)} ↗</a>
<button type="button" class="ibtn copybtn" data-copy="${esc(baseUrl)}/boutique/${esc(c.slug)}" title="Copier le lien" aria-label="Copier le lien vers la boutique">${COPY_ICON}</button><span class="copied-msg" role="status"></span></div></div>
<div class="campbtns">${canEdit ? `<a class="btn" href="/admin/produits?c=${c.id}">Produits</a>` : ''}<a class="btn" href="/admin/commandes?c=${c.id}">Commandes</a></div></div>
${canEdit ? `<details><summary>Modifier la campagne</summary>
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
<button class="flat" ${c.orders ? 'disabled title="Une campagne qui a des commandes ne peut pas être supprimée."' : ''}>🗑 Supprimer la campagne</button></form></details>` : ''}</section>`).join('');
  return layout('Administration des précommandes', `${whoBox(user)}<h1 class="pagetitle">Administration des précommandes</h1>${msg ? `<p class="note">${esc(msg)}</p>` : ''}
<h2>Campagnes (${list.length})</h2>${cards || '<p>Aucune campagne.</p>'}
${canEdit ? `<section class="card newcamp"><h2>Nouvelle campagne</h2><form method="post" action="/admin/campagnes/creer" class="cform">
<label>Nom *<input type="text" name="name" required maxlength="80" placeholder="ex. Noël 2026"></label>
<label>Dupliquer une campagne<select name="copyFrom"><option value="">Aucune : campagne vide</option>${list.map((c) => `<option value="${c.id}">Dupliquer « ${esc(c.name)} »</option>`).join('')}</select></label>
<div class="actions"><button class="primary">Créer la campagne</button></div></form></section>` : ''}`, { admin: true, script: '<script src="/assets/admin-campaigns.js"></script>' });
}

// Admin login page: login (user name or e-mail) and password.
const loginPage = (error = '') => layout('Connexion', `<h1 class="pagetitle">Administration des précommandes</h1>
<section class="card newcamp"><form method="post" action="/admin/connexion" class="cform">
${error ? `<p class="alert">${esc(error)}</p>` : ''}
<label>Identifiant ou e-mail<input type="text" name="login" required autofocus autocomplete="username" autocapitalize="none" spellcheck="false"></label>
<label>Mot de passe<input type="password" name="password" required autocomplete="current-password"></label>
<p class="hint">Les mêmes identifiants que sur le site des membres.</p>
<div class="actions"><button class="primary">Entrer</button></div></form></section>`, { admin: true });

module.exports = { loginPage, campaignsPage, dashboard, ordersPage, productsPage };
