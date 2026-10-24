// Order form behaviour: +/- steppers, live cart (bottom bar with count and total, recap with ✕), picture popup, remembered cart.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const form = $('order-form');
  const inputs = [...form.querySelectorAll('input[data-price]')];
  const fmt = (c) => (c / 100).toFixed(2).replace('.', ',') + ' €';
  const clamp = (v) => Math.max(0, Math.min(999, parseInt(v, 10) || 0));
  const KEY = 'elefan-cart-' + (form.dataset.campaign || '');
  const contact = ['first_name', 'last_name', 'email', 'comment'];

  // A picture that fails to load is removed (the text then uses the full width).
  for (const img of form.querySelectorAll('.pimg')) {
    const hide = () => { const a = img.closest('.pimglink'); if (a) a.remove(); };
    img.addEventListener('error', hide);
    if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) hide();
  }

  // Click a picture: show it larger in a popup (closes on click, on the ✕ button or with Esc).
  // Without JavaScript the link still opens the picture in a new tab.
  function openLightbox(link) {
    const img = link.querySelector('img');
    const box = document.createElement('div'); box.className = 'lightbox'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', img.alt);
    const fig = document.createElement('figure');
    const big = document.createElement('img'); big.src = link.href; big.alt = img.alt;
    const cap = document.createElement('figcaption'); cap.textContent = img.alt;
    const x = document.createElement('button'); x.type = 'button'; x.className = 'lb-close'; x.setAttribute('aria-label', 'Fermer'); x.textContent = '✕';
    fig.append(big, cap); box.append(fig, x); document.body.append(box);
    document.body.style.overflow = 'hidden';
    const close = () => { box.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', onKey); link.focus(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey); box.addEventListener('click', close); x.focus();
  }
  form.addEventListener('click', (e) => {
    const link = e.target.closest('a.pimglink');
    if (link) { e.preventDefault(); openLightbox(link); }
  });

  if (!$('pay')) return;   // closed shop: the page is only to look at, there is nothing to order

  const cartLines = () => inputs.map((input) => ({ input, qty: clamp(input.value) })).filter((l) => l.qty > 0);
  const setQty = (input, q) => { input.value = clamp(q); update(); };

  // Récapitulatif: one line per product with its quantity, amount and a ✕ that removes it from the cart.
  function renderRecap(ul, lines) {
    ul.replaceChildren();
    if (!lines.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Votre panier est vide.'; ul.append(li); return; }
    for (const { input, qty } of lines) {
      const li = document.createElement('li');
      const lbl = document.createElement('span'); lbl.className = 'lbl'; lbl.textContent = input.dataset.label;
      const q = document.createElement('span'); q.className = 'qty'; q.textContent = '× ' + qty;
      const amt = document.createElement('span'); amt.className = 'amt'; amt.textContent = fmt(qty * Number(input.dataset.price));
      const x = document.createElement('button'); x.type = 'button'; x.className = 'x'; x.textContent = '✕'; x.title = 'Retirer du panier'; x.setAttribute('aria-label', 'Retirer ' + input.dataset.label + ' du panier'); x.onclick = () => setQty(input, 0);
      li.append(lbl, q, amt, x);
      ul.append(li);
    }
  }

  function update() {
    const lines = cartLines();
    const total = lines.reduce((s, l) => s + l.qty * Number(l.input.dataset.price), 0);
    const count = lines.reduce((s, l) => s + l.qty, 0);
    $('total').textContent = fmt(total);
    $('count').textContent = count + (count > 1 ? ' articles' : ' article');
    renderRecap($('recap'), lines);
    const pay = $('pay');
    pay.disabled = !lines.length;
    // "Payer 27,86 € avec HelloAsso": the HelloAsso part is hidden on phones (style.css)
    if (lines.length) { const ha = document.createElement('span'); ha.className = 'pay-ha'; ha.textContent = ' avec HelloAsso'; pay.replaceChildren(`Payer ${fmt(total)}`, ha); }
    else pay.textContent = 'Choisissez au moins un produit';
    for (const l of inputs) l.closest('.stepper').classList.toggle('on', clamp(l.value) > 0);
    save();
  }

  function save() {
    try {
      const q = {}; for (const i of inputs) if (clamp(i.value)) q[i.name] = clamp(i.value);
      const c = {}; for (const n of contact) c[n] = form.elements[n].value;
      localStorage.setItem(KEY, JSON.stringify({ q, c }));
    } catch (e) { /* storage unavailable */ }
  }
  function restore() {
    if (form.dataset.serverValues) return; // the server re-rendered the form after an error: keep its values
    try {
      const { q = {}, c = {} } = JSON.parse(localStorage.getItem(KEY) || '{}');
      for (const i of inputs) if (q[i.name]) i.value = clamp(q[i.name]);
      for (const n of contact) if (c[n] && !form.elements[n].value) form.elements[n].value = c[n];
    } catch (e) { /* ignore corrupt storage */ }
  }

  form.addEventListener('click', (e) => {
    const b = e.target.closest('.stepper button');
    if (!b) return;
    const input = b.parentElement.querySelector('input');
    setQty(input, clamp(input.value) + (b.classList.contains('plus') ? 1 : -1));
  });
  form.addEventListener('input', (e) => { if (e.target.matches('input[data-price]')) update(); else if (e.target.name) save(); });
  form.addEventListener('change', (e) => { if (e.target.matches('input[data-price]')) e.target.value = clamp(e.target.value); });
  form.addEventListener('focusin', (e) => { if (e.target.matches('.stepper input:not([readonly])')) e.target.select(); });
  // Approximate "contribution" HelloAsso suggests on its payment page: each slice of the price is charged at the rate of
  // its tier, then rounded to the nearest 0.05 €.
  const TIERS = [[5, 0.24], [15, 0.23], [50, 0.072], [90, 0.0425], [500, 0.03], [Infinity, 0.01]];
  function helloassoFee(price) {
    let fee = 0, lower = 0;
    for (const [upper, rate] of TIERS) {
      if (price <= lower) break;
      fee += (Math.min(price, upper) - lower) * rate;
      lower = upper;
    }
    return Math.round(fee * 20) / 20;
  }
  const feeText = (e) => e.toFixed(2).replace('.', ',') + ' €';

  // Clicking the pay button first shows a reminder: set HelloAsso's contribution to 0 €. The form is only sent from the popup.
  function openFeeNotice(total) {
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const box = el('div', 'modal'); box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Paiement effectué par HelloAsso');
    const card = el('div', 'modal-box fee-box');
    const msg = el('p', 'fee-msg'); msg.append(el('b', 'fee-red', 'Pensez à mettre la contribution à 0 €.'));
    // The HelloAsso screen, redrawn in HTML: the proposed contribution is crossed out and replaced by 0 €.
    const mock = el('div', 'fee-mock'); mock.setAttribute('aria-hidden', 'true');
    const amount = el('span', 'fee-amount', feeText(helloassoFee(total / 100)));
    const modify = el('span', 'fee-modify', 'Modifier');
    const zero = el('div', 'fee-zero', '0€');
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); arrow.setAttribute('class', 'fee-arrow');
    const right = el('div', 'fee-right'); right.append(amount, zero);   // 0€ sits right under the crossed-out amount
    mock.append(el('div', 'fee-label', 'Votre contribution au fonctionnement de HelloAsso'), right, el('div', 'fee-row2', null), arrow);
    mock.querySelector('.fee-row2').append(modify);
    const actions = el('div', 'modal-actions');
    const go = el('button', 'primary', 'Continuer vers HelloAsso'); go.type = 'button';
    actions.append(go);
    card.append(msg, mock, actions); box.append(card); document.body.append(box);
    // Red arrow from the "Modifier" box to the crossed-out amount, drawn in pixels so the head keeps its shape.
    const drawArrow = () => {
      const m = mock.getBoundingClientRect(), a = modify.getBoundingClientRect(), t = amount.getBoundingClientRect(), z = zero.getBoundingClientRect();
      const x1 = a.right - m.left + 8, y1 = a.top - m.top + a.height / 2;
      const x2 = Math.min(t.left, z.left) - m.left - 10, y2 = t.top - m.top + t.height / 2 + 6;
      const ang = Math.atan2(y2 - y1, x2 - x1), L = 16, W = 7, c = Math.cos(ang), n = Math.sin(ang);
      const bx = x2 - L * c, by = y2 - L * n;                         // base of the head
      arrow.setAttribute('width', m.width); arrow.setAttribute('height', m.height); arrow.setAttribute('viewBox', `0 0 ${m.width} ${m.height}`);
      arrow.innerHTML = `<line x1="${x1}" y1="${y1}" x2="${bx + 2 * c}" y2="${by + 2 * n}"/><polygon points="${x2},${y2} ${bx - W * n},${by + W * c} ${bx + W * n},${by - W * c}"/>`;
    };
    drawArrow(); window.addEventListener('resize', drawArrow);
    const done = () => { box.remove(); document.removeEventListener('keydown', onKey); window.removeEventListener('resize', drawArrow); };
    const close = () => { done(); $('pay').focus(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    box.addEventListener('click', (e) => { if (e.target === box) close(); });
    go.onclick = () => { done(); confirmed = true; form.requestSubmit(); };
    go.focus();
  }
  let confirmed = false;
  form.addEventListener('submit', (e) => {
    const lines = cartLines();
    if (!lines.length) { e.preventDefault(); return; }
    if (!confirmed) { e.preventDefault(); openFeeNotice(lines.reduce((s, l) => s + l.qty * Number(l.input.dataset.price), 0)); return; }
    confirmed = false;   // the next click on the pay button shows the reminder again
    $('pay').disabled = true; $('pay').textContent = 'Redirection vers HelloAsso…';
  });

  restore();
  update();
})();
