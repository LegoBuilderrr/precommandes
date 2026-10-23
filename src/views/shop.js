// Customer-facing pages: campaigns list, a campaign's shop, and the confirmation page after paying.
const { fmtWeight } = require('../weight');
const { esc, euros, label, layout, frDate, days, thresholdText } = require('./common');

// ---------- public order form ----------
function stepper(name, s, lbl, values) {
  const q = Number(values[name]) > 0 ? Number(values[name]) : 0;
  return `<div class="stepper${q ? ' on' : ''}"><button type="button" class="minus" aria-label="Retirer">−</button>` +
    `<input type="number" min="0" max="999" inputmode="numeric" name="${name}" value="${q}" data-price="${s.price_cents}" data-grams="${s.grams ?? ''}" data-label="${esc(lbl)}" aria-label="${esc(lbl)}">` +
    '<button type="button" class="plus" aria-label="Ajouter">+</button></div>';
}

function productCard(p, values) {
  let grid;
  if (p.variants.length) {
    grid = '<div class="scroll"><table class="grid"><tr><th></th>' +
      p.sizes.map((s) => `<th>${esc(s.name || s.label)}<small>${euros(s.price_cents)}</small></th>`).join('') + '</tr>' +
      p.variants.map((v) => `<tr><th class="vname">${esc(v.name)}</th>` +
        p.sizes.map((s) => `<td data-size="${esc(s.name || s.label)}" data-price="${euros(s.price_cents)}">${stepper(`q_${s.id}_${v.id}`, s, label(p.name, v.name, s.name || s.label), values)}</td>`).join('') + '</tr>').join('') +
      '</table></div>';
  } else {
    grid = '<div class="opts">' + p.sizes.map((s) =>
      `<div class="opt"><span class="osize">${esc(s.name || s.label)}</span><small>${euros(s.price_cents)}</small>${stepper(`q_${s.id}_0`, s, label(p.name, s.name || s.label), values)}</div>`).join('') + '</div>';
  }
  const img = p.image_url ? `<a class="pimglink" href="${esc(p.image_url)}" target="_blank" rel="noopener" title="Agrandir"><img class="pimg" src="${esc(p.image_url)}" alt="${esc(p.name)}" width="110" height="110" loading="lazy"></a>` : '';
  const info = p.info_url ? `<a class="info" href="${esc(p.info_url)}" target="_blank" rel="noopener noreferrer">En savoir plus ↗</a>` : '';
  return `<section class="card" data-product><div class="pintro">${img}<div class="ptext"><div class="ptop"><div class="ctext"><h2>${esc(p.name)}</h2>${info}</div></div>${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}</div></div>${grid}</section>`;
}

// Home page (/ and /precommandes): a bare list of the campaigns open to the public.
function landing(campaigns) {
  const list = campaigns.length
    ? `<ul class="shoplist">${campaigns.map((c) => `<li><a href="/boutique/${esc(c.slug)}">${esc(c.name)}</a></li>`).join('')}</ul>`
    : '<p class="lead">Aucune précommande ouverte pour le moment.</p>';
  return layout('Précommandes', `<h1 class="header">Précommandes</h1>${list}`);
}

// Title of a campaign's shop page: always "Précommandes <name>" (a name that already starts with "Précommande(s)" is not doubled).
const shopTitle = (c) => `Précommandes ${String(c.name).replace(/^pr[ée]-?commandes?\s*[:\-–—]?\s*/i, '')}`.trim();
const campaignHeader = (c) => (c.header_html ? `<div class="campaign-header">${c.header_html}</div>` : '');

// Under the title of a shop page: the next delivery and, when orders are closed, why (the page itself stays viewable).
const deliveryNote = (c, st) => {
  // a minimum to reach: the delivery only happens if enough is ordered
  const subject = st.threshold && !st.threshold.reached ? ` (sous réserve d’atteindre notre seuil de ${esc(thresholdText(st.threshold))})` : '';
  const box = (html) => `<div class="deliverybox">${html}</div>`;
  const next = st.next ? box(`<p class="delivery">🚚 Prochaine livraison : <b>${esc(frDate(st.next))}</b>${subject}</p>`) : '';
  // open with a lead time: the deadline comes first, the delivery it is for second
  if (st.open) return Number(c.lead_days) > 0
    ? box(`<p class="delivery">Commandes ouvertes jusqu’au <b>${esc(frDate(st.deadline))}</b> inclus</p><p class="hint deadline">🚚 pour une livraison le <b>${esc(frDate(st.next))}</b>${subject}</p>`)
    : next;
  const why = st.reason === 'none' ? 'Aucune livraison n’est prévue pour le moment.'
    : `La date limite pour commander était le ${esc(frDate(st.deadline))} (${days(Number(c.lead_days))} avant la livraison).`;
  return next + `<div class="warn banner"><b>Les commandes sont fermées pour le moment.</b><br>${why}</div>`;
};

function orderForm(campaign, tree, values = {}, error = '', state = { open: true }) {
  const field = (name, lbl, type = 'text', extra = '') =>
    `<label>${lbl}<input type="${type}" name="${name}" required value="${esc(values[name])}" ${extra}></label>`;
  const open = state.open !== false;
  const body = `<h1 class="header">${esc(shopTitle(campaign))}</h1>${campaignHeader(campaign)}${deliveryNote(campaign, state)}
${error ? `<p class="alert">${esc(error)}</p>` : ''}
<form id="order-form" ${open ? `method="post" action="/commander"` : 'onsubmit="return false"'} data-campaign="${esc(campaign.slug)}" data-server-values="${Object.keys(values).length ? 1 : ''}">
<input type="hidden" name="campaign" value="${esc(campaign.slug)}">
${open ? '<div id="products">' : '<fieldset id="products" class="plain" disabled>'}${tree.map((p) => productCard(p, values)).join('')}${open ? '</div>' : '</fieldset>'}
${open ? `<section class="card checkout" id="checkout"><div class="cohead"><h2>Vos coordonnées et paiement</h2></div><div class="cobody">
<div class="two">${field('first_name', 'Prénom *', 'text', 'autocomplete="given-name" minlength="2" maxlength="60"')}${field('last_name', 'Nom *', 'text', 'autocomplete="family-name" minlength="2" maxlength="60"')}</div>
${field('email', 'Adresse mail *', 'email', 'autocomplete="email"')}
<label>Commentaires (optionnel)<textarea name="comment" rows="3">${esc(values.comment)}</textarea></label>
<h3>Récapitulatif</h3><ul id="recap" class="lines recap"></ul>
<button class="primary big" id="pay" disabled>Choisissez au moins un produit</button>
${state.next ? `<p class="paydelivery">🚚 Livraison prévue le <b>${esc(frDate(state.next))}</b></p>` : ''}
<p class="secure">🔒 Paiement sécurisé</p></div></section>
<div class="cartbar" id="cartbar"><div class="barrow"><span class="cartinfo">🛒 <span id="count">0 article</span></span><b id="total">0,00 €</b></div></div>` : ''}
</form><script src="/assets/order.js"></script>`;
  return layout(shopTitle(campaign), body);
}

const paris = (d) => { const t = new Date(d); return Number.isNaN(t.getTime()) ? '' : t.toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Paris' }); };
const dl = (rows) => `<dl class="dl">${rows.filter((r) => r[1]).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;

// Confirmation page. `pay` = { receipt, date, means, id } from HelloAsso (or null while unpaid).
function returnPage(o, status, items, pay, slug = '') {
  const home = slug ? `/boutique/${esc(slug)}` : '/';
  const banner = {
    paid: ['ok', '✅ Paiement reçu, merci !', `Votre pré-commande n°${o.id} est enregistrée. Conservez cette page ou le reçu ci-dessous comme preuve de paiement.`],
    pending: ['warn', 'Paiement en attente de confirmation', 'Si vous venez de payer, patientez quelques secondes : cette page se met à jour automatiquement. Sinon, vous pouvez reprendre le paiement.'],
    failed: ['alert', 'Le paiement n’a pas pu être lancé', 'Aucun paiement n’a été effectué. Vous pouvez recommencer votre commande.'],
    refunded: ['warn', 'Commande remboursée', `Cette commande a été remboursée${o.refunded_at ? ` le ${paris(`${o.refunded_at.replace(' ', 'T')}Z`)}` : ''}. Le délai d’arrivée des fonds dépend de votre banque.`],
    refunding: ['warn', 'Remboursement en cours', 'Un remboursement est en cours de traitement pour cette commande.'],
  }[status] || ['alert', 'Statut inconnu', ''];
  const lines = items.map((i) => `<tr><td>${esc(label(i.product, i.variant))}<td>${esc(i.size_name || i.size)}<td class="num">${euros(i.unit_cents)}<td class="num">${i.qty}<td class="num">${euros(i.unit_cents * i.qty)}</tr>`).join('');
  const units = items.reduce((n, i) => n + i.qty, 0);
  const grams = items.reduce((n, i) => n + i.qty * (i.grams || 0), 0);
  const means = { Card: 'Carte bancaire', Sepa: 'Prélèvement SEPA' }[pay && pay.means] || (pay && pay.means) || '';
  const receipt = pay && /^https:\/\/www\.helloasso(-sandbox)?\.com\//.test(pay.receipt || '') ? `<a class="btn" href="${esc(pay.receipt)}" target="_blank" rel="noopener noreferrer">Voir le reçu de paiement ↗</a>` : '';
  const actions = ['paid', 'refunded', 'refunding'].includes(status)
    ? `<button type="button" class="btn flat" onclick="window.print()">🖨 Imprimer</button>${status === 'paid' ? receipt : ''}<a class="btn" href="${home}">Nouvelle commande</a>`
    : status === 'pending'
      ? `<a class="btn" href="/retour?o=${o.id}">↻ Vérifier à nouveau</a>${o.redirect_url ? `<a class="btn" href="${esc(o.redirect_url)}">Reprendre le paiement</a>` : ''}<a class="btn flat" href="${home}">Retour à la boutique</a>`
      : `<a class="btn" href="${home}">Recommencer ma commande</a>`;
  const statusText = { paid: 'Payée ✓', pending: 'En attente', failed: 'Non aboutie', refunded: 'Remboursée', refunding: 'Remboursement en cours' }[status];
  const body = `<h1 class="header">Commande n°${o.id}</h1>${o.campaign ? `<p class="lead">${esc(o.campaign)}</p>` : ''}
<div class="${banner[0]} banner"><b>${banner[1]}</b><br>${esc(banner[2])}</div>
<section class="card"><h2>Récapitulatif de la commande</h2>
<div class="scroll"><table class="recapt"><tr><th>Produit<th>Poids<th class="num">Prix unitaire<th class="num">Qté<th class="num">Total</tr>${lines}
<tr class="tot"><td colspan="3"><b>Total</b><td class="num"><b>${units}</b><td class="num"><b>${euros(o.total_cents)}</b></tr></table></div>${grams ? `<p class="hint">Poids total : <b>${fmtWeight(grams)}</b>${items.some((i) => i.grams == null) ? ' (hors articles sans poids)' : ''}</p>` : ''}</section>
<div class="cols"><section class="card"><h2>Vos informations</h2>${dl([
    ['Nom', esc(`${o.first_name} ${o.last_name}`)], ['Adresse mail', esc(o.email)], ['Commentaire', esc(o.comment)]])}</section>
<section class="card"><h2>Paiement</h2>${dl([
    ['Campagne', esc(o.campaign)], ['Statut', `<b class="st ${esc(status)}">${statusText}</b>`], ['Montant', euros(o.total_cents)], ['Moyen de paiement', esc(means)],
    ['Date du paiement', esc(pay && pay.date ? paris(pay.date) : '')], ['Commande créée le', esc(paris(`${o.created_at.replace(' ', 'T')}Z`))],
    ['Référence HelloAsso', pay && pay.id ? `paiement n°${esc(pay.id)}` : '']])}</section></div>
<div class="actions noprint">${actions}</div>${status === 'paid' && slug ? `<script>try{localStorage.removeItem("elefan-cart-${esc(slug)}")}catch(e){}</script>` : ''}`;
  return layout(`Commande n°${o.id}`, body, { head: status === 'pending' ? '<meta http-equiv="refresh" content="10">' : '' });
}

module.exports = { landing, orderForm, returnPage };
