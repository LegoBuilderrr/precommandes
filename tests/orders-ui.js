// Orders tab (Clients): sorting by N° / Date / Client and the bulk step change (jsdom against the test server on :8444)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { JSDOM } = require('jsdom');
const fs = require('fs');
const B = 'https://localhost:8444';
const assert = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const js = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'admin-orders.js'), 'utf8');
(async () => {
  const { DatabaseSync } = require('node:sqlite'); const sdb = new DatabaseSync('/tmp/t4.db');
  const ins = sdb.prepare("insert into orders (campaign_id,campaign,number,first_name,last_name,member_no,email,total_cents,status,created_at) values (1,'Veggie Deli',?,?,?,'1','x@example.org',1000,?,?)");
  // number, first name, last name, status, created_at (deliberately not in the same order as the numbers or the names)
  ins.run(1, 'Zoé', 'Martin', 'paid', '2026-11-03 10:00:00');
  ins.run(2, 'Alice', 'Zola', 'paid', '2026-11-01 09:00:00');
  ins.run(3, 'Émile', 'Durand', 'paid', '2026-11-05 08:00:00');
  ins.run(4, 'Bob', 'Aubert', 'paid', '2026-11-02 12:00:00');
  ins.run(null, 'Pat', 'Pending', 'pending', '2026-11-06 12:00:00');
  ins.run(5, 'Rita', 'Remb', 'refunded', '2026-11-04 12:00:00');
  const html = await (await fetch(B + '/admin/commandes?c=1&mode=clients')).text();
  const dom = new JSDOM(html, { url: B + '/admin/commandes?c=1&mode=clients', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, d = w.document; const $ = (s, r = d) => r.querySelector(s), $$ = (s, r = d) => [...r.querySelectorAll(s)];
  w.fetch = (u, o) => fetch(B + u, o);
  const errors = []; w.addEventListener('error', (e) => errors.push(e.message));
  w.eval(js);
  assert(!errors.length, 'script runs without errors ' + errors.join());
  const order = () => $$('tr[data-id]').filter((r) => !r.classList.contains('unpaid') && r.dataset.num).map((r) => r.dataset.num).join(',');
  const col = (n) => $$('.orders tr[data-id]').map((r) => r.children[n].textContent);

  // ---- markup
  assert($$('.orders th .sortbtn').map((b) => b.textContent).join() === 'N°,Date,Client' && $('#selall'), 'headers N°, Date, Client are sort buttons; a select-all box heads the first column');
  assert($$('input.rowsel').length === 4 && $$('tr.unpaid input.rowsel').length === 0, 'only the 4 paid orders have a box (not the pending nor the refunded one)');
  assert($('.bulkbar').hidden, 'the bulk bar is hidden while nothing is ticked');
  assert($('th[aria-sort]').textContent.trim() === 'N°' && $('th[aria-sort]').getAttribute('aria-sort') === 'descending', 'initial order shown as N° descending');

  // ---- sorting
  const click = (key) => $(`.sortbtn[data-key="${key}"]`).click();
  click('num'); assert(order() === '1,2,3,4,5' && $('th[aria-sort]').getAttribute('aria-sort') === 'ascending', 'N°: first click ascending (' + order() + ')');
  click('num'); assert(order() === '5,4,3,2,1' && $('th[aria-sort]').getAttribute('aria-sort') === 'descending', 'N°: second click descending (' + order() + ')');
  click('date'); assert(order() === '2,4,1,5,3' && $$('th[aria-sort]').length === 1 && $('th[aria-sort] .sortbtn').dataset.key === 'date', 'Date: oldest first (' + order() + '), one sorted column only');
  click('date'); assert(order() === '3,5,1,4,2', 'Date: newest first (' + order() + ')');
  click('name'); assert(order() === '4,3,1,5,2', 'Client: A to Z (' + order() + ')');
  const names = $$('tr[data-id]').filter((r) => r.dataset.num).map((r) => r.dataset.name);
  assert(names.join('|') === [...names].sort((a, b) => a.localeCompare(b, 'fr')).join('|'), 'Client: alphabetical on last name then first name, accents ignored');
  click('name'); assert($$('tr[data-id]').filter((r) => r.dataset.num).map((r) => r.dataset.name).join('|') === [...names].reverse().join('|'), 'Client: Z to A');
  assert($$('.orders tr[data-id]').length === 6, 'sorting keeps all rows (the pending one included)');

  // ---- selection
  const boxes = $$('input.rowsel'), step = (id) => sdb.prepare('select step from orders where id=?').get(id).step;
  boxes[0].click(); boxes[1].click();
  assert(!$('.bulkbar').hidden && $('.bulkcount').textContent === '2 commandes sélectionnées' && $('#selall').indeterminate && $$('tr.picked').length === 2, 'ticking two boxes shows the bar with the count; select-all is half ticked');
  $('#selall').click(); assert($$('input.rowsel:checked').length === 4 && $('#selall').checked && !$('#selall').indeterminate && $('.bulkcount').textContent === '4 commandes sélectionnées', 'select-all ticks every paid order');
  $('#selall').click(); assert($$('input.rowsel:checked').length === 0 && $('.bulkbar').hidden, 'select-all again clears everything and hides the bar');
  boxes[0].click(); $('#bulkclear').click(); assert($$('input.rowsel:checked').length === 0 && $('.bulkbar').hidden, '“Tout désélectionner” clears the selection');
  assert($$('#bulkstep option').map((o) => o.textContent).join() === 'Payée,Préparée,Contactée,Retirée', 'bulk menu: Payée, Préparée, Contactée, Retirée (no Remboursée)');

  // ---- bulk change
  const idOf = (num) => sdb.prepare('select id from orders where number=?').get(num).id;
  const tick = (num) => $(`input.rowsel[data-id="${idOf(num)}"]`).click();
  tick(1); tick(3); $('#bulkstep').value = 'prepared'; $('#bulkapply').click();
  await new Promise((r) => setTimeout(r, 400));
  assert(step(idOf(1)) === 'prepared' && step(idOf(3)) === 'prepared' && step(idOf(2)) === '' && step(idOf(4)) === '', 'the two ticked orders are saved as Préparée, the others are untouched');
  assert($(`select.stepsel[data-id="${idOf(1)}"]`).value === 'prepared' && $(`select.stepsel[data-id="${idOf(3)}"]`).dataset.prev === 'prepared' && $(`select.stepsel[data-id="${idOf(2)}"]`).value === '', 'the row menus follow without reloading');
  assert($('.bulkmsg').textContent === '✓ 2 commandes passées à « Préparée »' && !$('#bulkapply').disabled, 'confirmation message: ' + $('.bulkmsg').textContent);
  $('#selall').click(); $('#bulkstep').value = 'collected'; $('#bulkapply').click();
  await new Promise((r) => setTimeout(r, 400));
  assert([1, 2, 3, 4].every((n) => step(idOf(n)) === 'collected'), 'select-all + Retirée changes all four paid orders');
  $('#bulkstep').value = 'paid'; $('#bulkapply').click();
  await new Promise((r) => setTimeout(r, 400));
  assert([1, 2, 3, 4].every((n) => step(idOf(n)) === '') && $(`select.stepsel[data-id="${idOf(2)}"]`).value === '', 'Payée puts the step back to empty');
  assert(sdb.prepare("select step from orders where number=5").get().step === '' && sdb.prepare("select status from orders where number=5").get().status === 'refunded', 'the refunded order is never touched');

  // ---- the server refuses what it must
  const post = (body) => fetch(B + '/admin/commandes/etapes', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  let r = await post('step=refunded&id=' + idOf(1)); assert(r.status === 400 && step(idOf(1)) === '', 'bulk: “refunded” cannot be set');
  r = await post('step=prepared'); assert(r.status === 400, 'bulk: no order selected is refused');
  const pend = sdb.prepare("select id from orders where status='pending'").get().id, rem = sdb.prepare("select id from orders where status='refunded'").get().id;
  r = await post(`step=prepared&id=${pend}&id=${rem}&id=${idOf(1)}&id=abc&id=999999`); const j = await r.json();
  assert(r.status === 200 && j.changed === 1 && j.skipped === 3 && step(idOf(1)) === 'prepared' && step(pend) === '' && step(rem) === '', `bulk: only paid orders change (changed ${j.changed}, skipped ${j.skipped})`);

  // ---- the choice of sort is kept while the tab stays open
  const dom2 = new JSDOM(html, { url: B + '/admin/commandes?c=1&mode=clients', runScripts: 'outside-only', pretendToBeVisual: true });
  const w2 = dom2.window; w2.fetch = w.fetch;
  w2.sessionStorage.setItem('ordersSort', JSON.stringify(['name', 'ascending'])); w2.eval(js);
  assert(w2.document.querySelector('th[aria-sort]').getAttribute('aria-sort') === 'ascending' && w2.document.querySelector('th[aria-sort] .sortbtn').dataset.key === 'name', 'a saved sort choice is applied when the page loads');
  void col;
})();
