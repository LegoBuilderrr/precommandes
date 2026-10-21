process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { JSDOM } = require('jsdom');
const fs = require('fs');
const B = 'https://localhost:8444';
const assert = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const js = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'admin-products.js'), 'utf8');
const loadTree = async () => JSON.parse((await (await fetch(B + '/admin/produits')).text()).match(/id="init" type="application\/json">([\s\S]*?)<\/script>/)[1]);
(async () => {
  // a paid order for "Rôti de dingue": the product and its size must be protected from deletion
  const { DatabaseSync } = require('node:sqlite'); const sdb = new DatabaseSync('/tmp/t4.db');
  const pr = sdb.prepare("select p.id pid, s.id sid from products p join sizes s on s.product_id=p.id where p.name='Rôti de dingue'").get();
  sdb.exec("insert into orders (campaign_id,campaign,first_name,last_name,member_no,email,total_cents,status) values (1,'Veggie Deli','a','b','1','a@b.c',1847,'paid')");
  sdb.prepare("insert into order_items (order_id,product_id,size_id,product,variant,size,unit_cents,qty,grams) values (1,?,?,'Rôti de dingue','','500gr',1847,1,500)").run(pr.pid, pr.sid);
  const html = await (await fetch(B + '/admin/produits')).text();
  const dom = new JSDOM(html, { url: B + '/admin/produits', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, d = w.document; const $ = (s, r = d) => r.querySelector(s), $$ = (s, r = d) => [...r.querySelectorAll(s)];
  w.fetch = (u, o) => fetch(B + u, o); w.confirm = () => true;
  const errors = []; w.addEventListener('error', (e) => errors.push(e.message));
  w.eval(js);
  assert(!errors.length, 'script runs without errors ' + errors.join());
  const n0 = $$('.pcard').length; const names = () => $$('.pcard .pname').map((i) => i.value);
  const type = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
  assert(n0 >= 13 && $('#save').disabled, `${n0} products shown, Save disabled while unchanged`);
  // bought items: the delete icon stays (greyed out); clicking it explains why instead of deleting. No lock icons anywhere.
  const roti = $$('.pcard').find((c) => $('.pname', c).value === 'Rôti de dingue'), pas = $$('.pcard').find((c) => $('.pname', c).value === 'Pas-trami');
  assert(!/🔒/.test(d.body.textContent), 'no lock icon anywhere');
  const delOf = (card) => $$('.phead button', card).find((b) => b.textContent === '🗑');
  assert(delOf(roti).classList.contains('locked') && delOf(roti).getAttribute('aria-disabled') === 'true' && !delOf(pas).classList.contains('locked'), 'bought product: the 🗑 is greyed out; an unbought one is normal');
  const nProducts = $$('.pcard').length; delOf(roti).click();
  const pop = () => d.querySelector('.modal');
  assert(pop() && /^ErreurSuppression impossible : produit déjà acheté\. Mais vous pouvez le masquer de la boutique\.OK$/.test(pop().textContent) && !/👁|rembours/.test(pop().textContent) && $$('.pcard').length === nProducts, 'clicking the greyed-out 🗑 opens an error popup and deletes nothing');
  assert(pop().getAttribute('role') === 'alertdialog' && pop().querySelector('button').textContent === 'OK' && d.activeElement === pop().querySelector('button'), 'popup has an OK button, focused');
  assert($('#status').textContent === '' && !$('#status').classList.contains('err'), 'the message is not shown in the toolbar any more');
  pop().querySelector('button').click(); assert(!pop() && d.activeElement === delOf(roti), 'OK closes the popup and returns focus to the delete icon');
  delOf(roti).click(); d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); assert(!pop(), 'Esc closes the popup');
  delOf(roti).click(); pop().dispatchEvent(new w.MouseEvent('click', { bubbles: true })); assert(!pop(), 'clicking outside the box closes the popup');
  assert($$('.phead', roti)[0].firstElementChild.title === 'Déplier', 'the expand arrow is the first icon of the row');
  $$('.phead .ibtn', roti).find((b) => b.title === 'Déplier').click();
  const rotiOpen = () => $$('.pcard').find((c) => $('.pname', c).value === 'Rôti de dingue');
  const lockedX = $$('.srow button', rotiOpen()).find((b) => b.textContent === '✕');
  assert(lockedX && lockedX.classList.contains('locked'), 'bought size: the ✕ is greyed out');
  const rows0 = $$('.srow', rotiOpen()).length; lockedX.click();
  assert(pop() && /Suppression impossible/.test(pop().textContent) && $$('.srow', rotiOpen()).length === rows0, 'clicking the greyed-out ✕ opens the popup and keeps the row');
  pop().querySelector('button').click();
  assert(!$$('.toolbar button').some((b) => /déplier|replier/i.test(b.textContent)), 'no "Tout déplier" / "Tout replier" buttons');
  assert(!/🔒 =|Glissez|JPEG, PNG/.test(d.body.textContent), 'no leftover help texts');
  // renamed sections / buttons, no note field
  assert(!/ariante/.test($$('.pbody', rotiOpen()).map((x) => x.innerHTML.replace(/data-v=/g, '')).join('')) && $$('input', rotiOpen()).some((i) => i.placeholder === 'Nouvelle option…'), 'no "variante" left in the editor; the add field says "Nouvelle option…"');
  const body0 = rotiOpen(); const h3s = $$('h3', body0).map((x) => x.textContent);
  assert(h3s.join() === 'Description,Image,Options,Prix', 'section titles: ' + h3s.join(' | '));
  assert(!/Image et lien|Poids et prix/.test(body0.textContent) && $$('button', body0).some((b) => b.textContent === '+ Ajouter un prix') && !$$('button', body0).some((b) => /Ajouter un poids/.test(b.textContent)), 'button is "+ Ajouter un prix"');
  assert($$('label', body0).some((l) => l.firstChild.textContent === 'Fiche produit (lien) :' && l.querySelector('input')), 'link field is labelled "Fiche produit (lien) :"');
  assert(!$('.pnote', roti) && !/Note \(ex/.test(d.body.innerHTML), 'no note field on products');
  // click the product row to unfold / fold it (not on fields, buttons or the drag handle)
  const fresh = () => $$('.pcard').find((c) => $('.pname', c).value === 'Pas-trami');
  const isOpen = () => !!$('.pbody', fresh());
  if (isOpen()) $$('.phead .ibtn', fresh()).find((b) => b.title === 'Replier').click();
  assert(!isOpen() && $('.phead', fresh()).querySelector('.sum'), 'collapsed product shows its summary');
  $('.phead .sum', fresh()).click(); assert(isOpen(), 'clicking the summary text of the row unfolds the product');
  $('.phead', fresh()).click(); assert(!isOpen(), 'clicking the row folds it again');
  $('.pname', fresh()).click(); $('.phead .grip', fresh()).click(); assert(!isOpen(), 'clicking the name field or the drag handle does not unfold it');
  $('.phead', fresh()).click(); assert(isOpen(), 'clicking the empty part of the row unfolds it');
  $('.pbody h3', fresh()).click(); $('.pbody', fresh()).click(); $('.pdesc', fresh()).click(); assert(isOpen(), 'clicks inside the open editor never fold it');
  const imgs = $('.thumb', fresh()); if (imgs) { imgs.click(); assert(!isOpen(), 'clicking the thumbnail folds it'); $('.phead', fresh()).click(); }
  $$('.phead .ibtn', fresh()).find((b) => b.title === 'Replier').click(); assert(!isOpen(), 'the arrow button still works (and does not toggle twice)');
  // texts removed in this round
  assert(!/affichée sous son nom/.test(d.body.innerHTML) && !/Aucune : le produit est vendu tel quel/.test(d.body.innerHTML), 'removed help texts are gone');
  $('.phead', fresh()).click();
  assert($('.pdesc', fresh()).placeholder === 'Une phrase pour présenter le produit', 'description placeholder: "Une phrase pour présenter le produit"');
  const noOpts = $$('.pcard').filter((c) => $('.pbody', c) && !$$('.chip', c).length); assert(noOpts.every((c) => !$('.pbody .hint', c)), 'products without options show no help paragraph');
  $$('.phead .ibtn', fresh()).find((b) => b.title === 'Replier').click();
  // add product
  $$('.toolbar button').find((b) => b.textContent.includes('Nouveau produit')).click();
  assert($$('.pcard').length === n0 + 1, 'new product card added');
  assert(d.activeElement && d.activeElement.classList.contains('pname'), 'new product name field focused');
  assert(!$('#save').disabled && $('#status').textContent.includes('non enregistrées'), 'dirty state shown, Save enabled');
  const card = $$('.pcard')[n0];
  type($('.pname', card), 'Tofu fumé'); type($('.pdesc', card), 'Un tofu fumé maison.'); type($('.slabel', card), '200'); type($('.sprice', card), '4,5');
  $('.sprice', card).dispatchEvent(new w.Event('blur')); assert($('.sprice', card).value === '4,50', 'price normalised on blur: ' + $('.sprice', card).value);
  // add variants
  const addv = $('.addv input', card);
  type(addv, 'nature'); $$('.addv button', card)[0].click();
  const addv2 = $('.addv input', $$('.pcard')[n0]); type(addv2, 'basilic'); addv2.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert($$('.chip', $$('.pcard')[n0]).length === 2, 'two variants added (button + Enter key)');
  // add second size
  $$('.pbody button', $$('.pcard')[n0]).find((b) => b.textContent.includes('Ajouter un prix')).click();
  assert($$('.srow', $$('.pcard')[n0]).length === 2, 'second size row added');
  type($$('.slabel', $$('.pcard')[n0])[1], '500'); type($$('.sprice', $$('.pcard')[n0])[1], '10');
  // drag variants: move "basilic" before "nature"
  const drag = (list, from, to, after, axis) => {
    const items = list, src = items[from], dst = items[to];
    const dt = { effectAllowed: '', setData() {} };
    const mk = (type, extra = {}) => { const e = new w.MouseEvent(type, { bubbles: true, cancelable: true, ...extra }); Object.defineProperty(e, 'dataTransfer', { value: dt }); return e; };
    $('.grip', src).dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true }));
    src.dispatchEvent(mk('dragstart'));
    dst.dispatchEvent(mk('dragover', axis === 'x' ? { clientX: after ? 10 : -10 } : { clientY: after ? 10 : -10 }));
    dst.dispatchEvent(mk('drop'));
    src.dispatchEvent(mk('dragend'));
  };
  drag($$('.chip', $$('.pcard')[n0]), 1, 0, false, 'x');
  assert($$('.chip input', $$('.pcard')[n0]).map((i) => i.value).join() === 'basilic,nature', 'variant drag: basilic now before nature');
  drag($$('.srow', $$('.pcard')[n0]), 0, 1, true, 'y');
  assert($$('.slabel', $$('.pcard')[n0]).map((i) => i.value).join() === '500,200', 'size drag: 500 now before 200');
  // drag product: move the new last product to the top
  drag($$('.pcard'), n0, 0, false, 'y');
  assert(names()[0] === 'Tofu fumé', 'product drag: new product is now first (' + names()[0] + ')');
  // nested drag must not reorder products: drag a chip over a product card
  const before = names().join('|');
  const dt = { setData() {} }; const mk = (t) => { const e = new w.MouseEvent(t, { bubbles: true, cancelable: true }); Object.defineProperty(e, 'dataTransfer', { value: dt }); return e; };
  const chip = $$('.chip', $$('.pcard')[0])[0]; $('.grip', chip).dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true }));
  chip.dispatchEvent(mk('dragstart')); $$('.pcard')[3].dispatchEvent(mk('dragover')); $$('.pcard')[3].dispatchEvent(mk('drop')); chip.dispatchEvent(mk('dragend'));
  assert(names().join('|') === before, 'dragging a chip over a product does not reorder products');
  // save
  $('#save').click(); await new Promise((r) => setTimeout(r, 600));
  assert($('#status').textContent === 'Enregistré ✓' && $('#save').disabled, 'saved: ' + $('#status').textContent);
  // a price can have a name, shown to customers instead of its weight (e.g. 160 g -> "x2")
  { const card = $$('.pcard').find((c) => $('.pname', c).value === 'Tofu fumé');
    assert($('.sname', card) && $('.sname', card).placeholder === 'Nom (ex. x2)' && $$('.srow', card).every((r) => $('.sname', r)), 'every price row has an optional name field');
    type($('.sname', card), 'x2'); assert(!$('#save').disabled, 'typing a name marks the editor as changed');
    $('#save').click(); await new Promise((r) => setTimeout(r, 600));
    const saved = (await loadTree()).find((p) => p.name === 'Tofu fumé');
    assert(saved && saved.sizes[0].name === 'x2' && $('#status').textContent === 'Enregistré ✓', 'the price name is saved: ' + (saved && saved.sizes[0].name));
    assert($('.sname', $$('.pcard').find((c) => $('.pname', c).value === 'Tofu fumé')).value === 'x2', 'and shown again after saving');
    type($('.sname', $$('.pcard').find((c) => $('.pname', c).value === 'Tofu fumé')), ''); $('#save').click(); await new Promise((r) => setTimeout(r, 600));
    assert((await loadTree()).find((p) => p.name === 'Tofu fumé').sizes[0].name === '', 'an emptied name goes back to showing the weight'); }
  const t = await loadTree(); const p = t[0];
  assert(p.name === 'Tofu fumé' && p.variants.map((v) => v.name).join() === 'basilic,nature' && p.sizes.map((s) => s.label + '=' + s.price).join() === '500gr=10,00,200gr=4,50', 'server stored order, variants, sizes and prices');
  assert(p.id && p.variants.every((v) => v.id) && p.sizes.every((s) => s.id), 'new rows got database ids');
  assert(p.description === 'Un tofu fumé maison.', 'description saved: ' + p.description);
  assert($('.pdesc', $$('.pcard')[0]).value === 'Un tofu fumé maison.', 'description shown again after save');
  // units: add a size, choose "unité", then "kg"
  const wait = (ms = 500) => new Promise((r) => setTimeout(r, ms));
  const c0 = () => $$('.pcard')[0], rowsOf = () => $$('.srow', c0()), lastRow = () => rowsOf()[rowsOf().length - 1];
  const setUnit = (row, v) => { const sel = $('.sunit', row); sel.value = v; sel.dispatchEvent(new w.Event('change', { bubbles: true })); };
  $$('.pbody button', c0()).find((b) => b.textContent.includes('Ajouter un prix')).click();
  assert($$('.sunit option', lastRow()).map((o) => o.value).join() === 'g,kg,unit,text', 'unit choices: g, kg, unité, texte libre');
  assert($$('.sunit option', lastRow()).find((o) => o.value === 'unit').textContent === 'unité', 'the unit is labelled "unité"');
  setUnit(lastRow(), 'unit'); type($('.slabel', lastRow()), '6'); type($('.sprice', lastRow()), '30');
  $('#save').click(); await wait();
  let t0 = (await loadTree())[0]; let sz = t0.sizes[t0.sizes.length - 1];
  assert(sz.label === '6 unités' && sz.units === 6 && sz.grams === null, 'unité saved as units: ' + JSON.stringify({ label: sz.label, units: sz.units, grams: sz.grams }));
  assert($('.sunit', lastRow()).value === 'unit' && $('.slabel', lastRow()).value === '6', 'unité round-trips in the editor');
  setUnit(lastRow(), 'kg'); type($('.slabel', lastRow()), '1,5'); $('#save').click(); await wait();
  t0 = (await loadTree())[0]; sz = t0.sizes[t0.sizes.length - 1];
  assert(sz.label === '1,5kg' && sz.grams === 1500 && sz.units === null, 'kg saved as grams: ' + JSON.stringify({ label: sz.label, grams: sz.grams }));
  assert($('.sunit', lastRow()).value === 'kg' && $('.slabel', lastRow()).value === '1,5', 'kg round-trips as 1,5');
  assert(t0.sizes.find((s) => s.label === '500gr').grams === 500, '500 g stored as 500 grams');
  type($('.slabel', lastRow()), 'abc'); $('#save').click(); await wait();
  assert($('#status').classList.contains('err') && /poids invalide/.test($('#status').textContent), 'invalid weight rejected: ' + $('#status').textContent);
  type($('.slabel', lastRow()), '1,5'); $('#save').click(); await wait();
  // image: click the picture (or the "+ Image" box) to upload; no buttons
  const card0 = $$('.pcard')[0];
  if (!$('.pbody', card0)) $$('.phead .ibtn', card0).find((b) => b.title === 'Déplier').click();
  const open0 = $$('.pcard')[0];
  assert(!$$('button', open0).some((b) => /Téléverser|Changer l|Retirer l/.test(b.textContent)), 'no "Téléverser / Changer l’image / Retirer l’image" buttons');
  assert(!$$('input', open0).some((i) => /adresse de l.image/i.test(i.getAttribute('aria-label') || '')), 'no image URL field in the editor');
  assert($$('input[type=file]', open0).length === 1 && $$('input', open0).some((i) => /Fiche produit/.test(i.getAttribute('aria-label') || '')), 'upload input + info link field present');
  const fileInput = $('input[type=file]', open0); let picks = 0; fileInput.click = () => { picks++; };
  const drop = $('.imgdrop', open0); assert(drop && /Image/.test(drop.textContent), 'product without a picture shows a "+ Image" box');
  drop.click(); assert(picks === 1, 'clicking the "+ Image" box opens the file picker');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  Object.defineProperty(fileInput, 'files', { value: [new Blob([png], { type: 'image/png' })] });
  fileInput.dispatchEvent(new w.Event('change')); await new Promise((r) => setTimeout(r, 800));
  const prev = $('.preview', $$('.pcard')[0]); assert(prev && /^\/uploads\/[a-f0-9]{16}\.png$/.test(prev.getAttribute('src')), 'uploaded image is previewed: ' + (prev && prev.getAttribute('src')));
  assert(!$('.imgdrop', $$('.pcard')[0]) && prev.classList.contains('pick') && /Cliquer pour changer/.test(prev.title), 'the picture itself is now the click target');
  const fi2 = $('input[type=file]', $$('.pcard')[0]); let picks2 = 0; fi2.click = () => { picks2++; }; prev.click(); assert(picks2 === 1, 'clicking the picture opens the file picker (replace)');
  assert($('.thumb', $$('.pcard')[0]) != null, 'thumbnail shown in the product header');
  $('#save').click(); await new Promise((r) => setTimeout(r, 500));
  assert((await loadTree())[0].image_url === prev.getAttribute('src'), 'image path saved on the server');
  // hide (eye) + validation error
  $$('.phead .ibtn', $$('.pcard')[0]).find((b) => /Visible sur|Masqué/.test(b.title)).click(); assert($$('.pcard')[0].classList.contains('off'), 'eye toggles product to hidden');
  type($$('.pname')[0], ''); $('#save').click(); await new Promise((r) => setTimeout(r, 400));
  assert($('#status').classList.contains('err') && $('#status').textContent.includes('pas de nom'), 'validation error shown: ' + $('#status').textContent);
  assert((await loadTree())[0].name === 'Tofu fumé', 'nothing saved after the error');
  type($$('.pname')[0], 'Tofu fumé'); $('#save').click(); await new Promise((r) => setTimeout(r, 400));
  assert((await loadTree())[0].active === false, 'hidden state saved');
  // delete the test product
  $$('.phead .del', $$('.pcard')[0])[0].click(); $('#save').click(); await new Promise((r) => setTimeout(r, 400));
  assert((await loadTree()).length === n0, 'delete + save removes the product');
  // Ctrl+S saves
  type($$('.pname')[0], $$('.pname')[0].value + ' ');
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })); await new Promise((r) => setTimeout(r, 400));
  assert($('#status').textContent === 'Enregistré ✓', 'Ctrl+S saves');
})().catch((e) => { console.error('ERROR', e); process.exitCode = 1; });
