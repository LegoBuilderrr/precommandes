// Pieces shared by the shop and admin templates: escaping, the page frame, French dates, the campaign minimum text.
// Everything user-supplied goes through esc().
const { fmtWeight } = require('../weight');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const euros = (cents) => (cents / 100).toFixed(2).replace('.', ',') + ' €';
const label = (...parts) => parts.filter(Boolean).join(' ');
// JSON that is safe to put inside a <script> element
const json = (x) => JSON.stringify(x).replace(/</g, '\\u003c');

// Look and feel follow https://membres.lelefan.org/ (light-blue navbar, orange black_jack headings, Raleway).
const layout = (title, body, { admin = false, script = '', head = '', bar = '' } = {}) =>
  `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${head}<title>${esc(title)} @ l'éléfàn</title>` +
  '<link rel="icon" href="/assets/favicon.png"><link rel="stylesheet" href="/assets/style.css"><body class="' + (admin ? 'admin' : 'shop') + '">' +
  '<header><nav class="topnav"><div class="navin"><a class="brand" href="/"><span class="long">Pré-commandes @ l\'éléfàn</span><span class="short">L\'éléfàn</span></a>' +
  '</div></nav></header>' + bar +
  `<main>${body}</main><footer class="pagefoot">© L'éléfàn · Un problème sur cette page ? <a href="https://barrissement.lelefan.org/adherents/channels/incidents-suggestions-informatique" target="_blank" rel="noopener noreferrer">Contactez l'équipe informatique</a></footer>${script}</body></html>`;

// Dates are written in French ("mardi 3 novembre 2026"); `iso` is YYYY-MM-DD.
// the year is only written when it is not the current one (Paris time)
const frDate = (iso) => {
  const d = new Date(iso + 'T12:00:00Z'), thisYear = new Date().toLocaleDateString('en-CA', { year: 'numeric', timeZone: 'Europe/Paris' });
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', ...(iso.slice(0, 4) === thisYear ? {} : { year: 'numeric' }), timeZone: 'Europe/Paris' });
};
// "5 novembre" (no weekday), with the year only when it is not the current one
const frDay = (iso) => frDate(iso).replace(/^\S+ /, '');
const days = (n) => `${n} jour${n > 1 ? 's' : ''}`;

// "50 kg" or "500,00 €": the campaign's minimum to reach
const thresholdText = (t) => (t.kind === 'money' ? euros(t.value) : fmtWeight(t.value));

module.exports = { esc, euros, label, json, layout, frDate, frDay, days, thresholdText };
