process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { JSDOM } = require('jsdom');
const fs = require('fs');
const B = 'https://localhost:8444';
const assert = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const html = await (await fetch(B + '/boutique/veggie-deli')).text();
  const js = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'order.js'), 'utf8');
  const open = () => { const d = new JSDOM(html, { url: B + '/', runScripts: 'outside-only', pretendToBeVisual: true }); return d; };
  let dom = open(); let w = dom.window; const $ = (s) => w.document.querySelector(s);
  const errors = []; w.addEventListener('error', (e) => errors.push(e.message));
  w.eval(js);
  assert(errors.length === 0, 'script runs without errors ' + errors.join());
  assert($('#pay').disabled && $('#total').textContent === '0,00 €', 'empty cart: pay disabled, total 0,00 €');
  // click "+" three times on the first stepper (Faux-cisses aux herbes 160gr = 5,66 €)
  const first = $('.stepper'); const plus = first.querySelector('.plus'); const input = first.querySelector('input');
  for (let i = 0; i < 3; i++) plus.click();
  assert(input.value === '3', 'plus x3 -> quantity 3');
  const unit = Number(input.dataset.price); const fm = (c) => (c / 100).toFixed(2).replace('.', ',') + ' €';
  assert($('#total').textContent === fm(3 * unit), 'total = 3 x unit = ' + $('#total').textContent);
  assert($('#count').textContent === '3 articles', 'count text: ' + $('#count').textContent);
  assert(!$('#pay').disabled && $('#pay').textContent.includes(fm(3 * unit)), 'pay enabled with amount: ' + $('#pay').textContent);
  assert(!$('#weight') && !$('#gocheckout') && !$('#carttoggle') && !$('#cartpanel') && !$('#cartlines'), 'bottom bar has no weight, no Commander button, no cart toggle/panel');
  assert(/Commander/.test($('#cartbar').textContent) === false && /kg| g\b/.test($('#cartbar').textContent) === false, 'bar text: ' + $('#cartbar').textContent.trim());
  assert($('#recap').children.length === 1 && $('#recap .x'), 'recap has 1 line with a remove button');
  assert(!$('.badge') && !/dans le panier/.test(w.document.body.textContent), 'no "x dans le panier" tag on the products');
  assert($('#pay').textContent === 'Payer ' + fm(3 * unit) + ' avec HelloAsso' && $('#pay .pay-ha'), 'pay label keeps "avec HelloAsso" in a span that phones hide');
  first.querySelector('.minus').click(); assert(input.value === '2', 'minus -> 2');
  // type an arbitrary quantity (12) in another cell
  const other = w.document.querySelectorAll('.stepper input')[7];
  other.value = '12'; other.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert(other.closest('.stepper').classList.contains('on'), 'typed quantity highlights cell');
  assert($('#recap').children.length === 2, 'two recap lines after typing 12');
  other.value = '5000'; other.dispatchEvent(new w.Event('change', { bubbles: true })); assert(other.value === '999', 'quantity clamped to 999');
  other.value = '-4'; other.dispatchEvent(new w.Event('change', { bubbles: true })); assert(other.value === '0', 'negative -> 0');
  // recap: the ✕ removes a product from the cart
  input.value = '2'; input.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert($('#recap').children.length === 1 && $('#recap .lbl').textContent === input.dataset.label, 'recap lists the product');
  $('#recap .x').click(); assert(input.value === '0' && $('#recap .empty') && $('#pay').disabled && $('#count').textContent === '0 article', 'x in the recap removes the line; cart empty, pay disabled');
  // pay button -> popup first (contribution to 0 €), the order is only sent from the popup
  const specFee = (price) => { const T = [[5, .24], [15, .23], [50, .072], [90, .0425], [500, .03], [Infinity, .01]]; let fee = 0, lower = 0; for (const [u, r] of T) { if (price <= lower) break; fee += (Math.min(price, u) - lower) * r; lower = u; } return Math.round(fee * 20) / 20; };
  let sent = 0; w.HTMLFormElement.prototype.requestSubmit = function () { sent++; };
  input.value = '3'; input.dispatchEvent(new w.Event('input', { bubbles: true }));
  const sub = new w.Event('submit', { cancelable: true, bubbles: true }); $('#order-form').dispatchEvent(sub);
  assert(sub.defaultPrevented && $('.modal.fee-modal, .modal .fee-box') && sent === 0, 'pay click is held back and a popup opens');
  const popup = $('.modal'); const ptxt = popup.textContent;
  assert(!popup.querySelector('.modal-title') && !/Paiement effectué par HelloAsso\./.test(ptxt) && !/Sur la page de paiement|cliquez sur/.test(ptxt) && !popup.querySelector('button.flat') && popup.querySelectorAll('button').length === 1, 'no explanatory sentence, no Retour button, only Continuer');
  assert(/^\s*Pensez à mettre la contribution à 0 €/.test(ptxt), 'popup message: ' + ptxt.slice(0, 120));
  const want = specFee(3 * unit / 100).toFixed(2).replace('.', ',') + ' €';
  assert(popup.querySelector('.fee-amount').textContent === want && /Votre contribution au fonctionnement de HelloAsso/.test(ptxt) && popup.querySelector('.fee-modify').textContent === 'Modifier' && popup.querySelector('.fee-zero').textContent === '0€' && popup.querySelector('.fee-arrow'), 'HelloAsso screen redrawn: crossed-out ' + want + ', Modifier boxed, 0€, arrow');
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); assert(!$('.modal') && sent === 0, 'Esc closes the popup, nothing sent');
  $('#order-form').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true })); $('.modal button.primary').click();
  assert(!$('.modal') && sent === 1, 'Continuer vers HelloAsso sends the form');
  { const ev2 = new w.Event('submit', { cancelable: true, bubbles: true }); $('#order-form').dispatchEvent(ev2); assert(!ev2.defaultPrevented, 'the confirmed submit goes through'); $('#order-form').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true })); assert($('.modal'), 'the next click shows the popup again'); w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); }
  // fee algorithm on a few totals (price = cart total in euros)
  for (const price of [3, 5, 20, 22.2, 50, 100, 600]) {
    input.dataset.price = String(Math.round(price * 100)); input.value = '1'; input.dispatchEvent(new w.Event('input', { bubbles: true }));
    $('#order-form').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
    const shown = $('.modal .fee-amount').textContent; w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
    assert(shown === specFee(price).toFixed(2).replace('.', ',') + ' €', `fee for ${price} € shown as ${shown} (spec ${specFee(price)})`);
  }
  input.dataset.price = String(unit); input.value = '0'; input.dispatchEvent(new w.Event('input', { bubbles: true }));
  // persistence
  input.value = '4'; input.dispatchEvent(new w.Event('input', { bubbles: true }));
  w.document.querySelector('[name=first_name]').value = 'Zoé'; w.document.querySelector('[name=first_name]').dispatchEvent(new w.Event('input', { bubbles: true }));
  const saved = w.localStorage.getItem('elefan-cart-veggie-deli'); assert(saved && saved.includes('"Zoé"'), 'cart + contact saved in localStorage');
  const dom2 = new JSDOM(html, { url: B + '/', runScripts: 'outside-only', pretendToBeVisual: true });
  dom2.window.localStorage.setItem('elefan-cart-veggie-deli', saved); dom2.window.eval(js);
  assert(dom2.window.document.querySelector('.stepper input').value === '4' && dom2.window.document.querySelector('[name=first_name]').value === 'Zoé', 'cart + contact restored on reload');
  // no search bar and no "plateforme de test" notice any more
  assert(!$('#search') && !$('.search') && !$('#no-result'), 'no search bar on the store page');
  assert(!/Plateforme de test|bac à sable/.test(w.document.body.textContent), 'no "plateforme de test" notice');
  // submit with empty cart is blocked
  const empty = new JSDOM(html, { url: B + '/', runScripts: 'outside-only' }); empty.window.eval(js);
  const ev = new empty.window.Event('submit', { cancelable: true, bubbles: true });
  empty.window.document.getElementById('order-form').dispatchEvent(ev); assert(ev.defaultPrevented, 'submit with empty cart is blocked');
  // pictures that fail to load are removed
  const links = w.document.querySelectorAll('.pimglink').length; const img0 = w.document.querySelector('.pimg');
  img0.dispatchEvent(new w.Event('error')); assert(w.document.querySelectorAll('.pimglink').length === links - 1, 'broken picture is removed (' + links + ' -> ' + w.document.querySelectorAll('.pimglink').length + ')');
  assert(w.document.querySelectorAll('a.info[target=_blank][rel*=noopener]').length >= 1, 'info links open in a new tab with noopener');
  // inputs posted by the form match what the server expects
  const names = [...w.document.querySelectorAll('input[data-price]')].map((i) => i.name);
  assert(names.length === 60 && names.every((n) => /^q_\d+_\d+$/.test(n)), '60 quantity inputs named q_<size>_<variant>');
})().catch((e) => { console.error('ERROR', e); process.exitCode = 1; });
