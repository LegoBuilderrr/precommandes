// Volumes (cL / L) and the picture link of the campaign description (server + jsdom against the test server on :8444)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path');
const B = 'https://localhost:8444';
const assert = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const cellsOf = (t) => t.replace(/^\uFEFF/, '').trim().split(/\r?\n/).map((l) => l.split(';').map((c) => c.replace(/^"|"$/g, '')));
const form = (o) => new URLSearchParams(o).toString();
const post = (u, body, type = 'application/x-www-form-urlencoded') => fetch(B + u, { method: 'POST', headers: { 'Content-Type': type }, body, redirect: 'manual' });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
(async () => {
  const { DatabaseSync } = require('node:sqlite'); const sdb = new DatabaseSync('/tmp/t4.db');
  // a campaign with drinks
  let r = await post('/admin/campagnes/creer', form({ name: 'Boissons' })); const cid = Number(/c=(\d+)/.exec(r.headers.get('location'))[1]);
  const prod = (sizes) => [{ name: 'Jus de pomme', active: true, description: '', image_url: '', info_url: '', variants: [], sizes }];
  const save = async (sizes) => { const x = await post(`/admin/api/catalogue?c=${cid}`, JSON.stringify(prod(sizes)), 'application/json'); return { status: x.status, j: await x.json() }; };
  let o = await save([{ unit: 'cL', amount: '33', price: '2,50', active: true }, { unit: 'cL', amount: '75', price: '4', active: true }, { unit: 'L', amount: '1,5', price: '5,50', active: true }, { unit: 'L', amount: '1', price: '3,50', active: true }, { unit: 'g', amount: '500', price: '6', active: true }]);
  assert(o.status === 200 && o.j.ok, 'sizes in cL and L are saved ' + (o.j.error || ''));
  const sizes = sdb.prepare('select s.label, s.ml, s.grams from sizes s join products p on p.id=s.product_id where p.campaign_id=? order by s.sort').all(cid);
  assert(sizes.map((s) => s.label).join() === '33cL,75cL,1,5L,1L,500gr', 'labels: ' + sizes.map((s) => s.label).join());
  assert(sizes.map((s) => s.ml).join() === '330,750,1500,1000,' && sizes[4].grams === 500 && sizes[0].grams === null, 'stored in millilitres, a weight keeps its grams');
  const tree = o.j.tree[0].sizes; assert(tree[0].ml === 330 && tree[2].ml === 1500, 'the saved tree returns ml');
  for (const [unit, amount] of [['L', ''], ['L', 'abc'], ['cL', '0'], ['L', '-2'], ['cL', '2000000']]) { o = await save([{ unit, amount, price: '1', active: true }]); assert(o.status === 400 && /volume invalide/.test(o.j.error), `invalid volume « ${amount} ${unit} » refused`); }
  o = await save([{ unit: 'cL', amount: '33', price: '2,50', active: true }, { unit: 'cL', amount: '33', price: '3', active: true }]); assert(o.status === 400, 'the same volume twice is refused');
  // the editor shows a saved volume back in its own unit
  const dom = new JSDOM(await (await fetch(B + `/admin/produits?c=${cid}`)).text(), { url: B + '/admin/produits', runScripts: 'outside-only', pretendToBeVisual: true });
  o = await save([{ unit: 'cL', amount: '33', price: '2,50', active: true }, { unit: 'L', amount: '1,5', price: '5,50', active: true }]);
  const dom2 = new JSDOM(await (await fetch(B + `/admin/produits?c=${cid}`)).text(), { url: B + '/admin/produits', runScripts: 'outside-only', pretendToBeVisual: true });
  dom2.window.eval(read('admin-products.js')); const d2 = dom2.window.document;
  d2.querySelector('.phead .ibtn[title="Déplier"]').click();
  assert([...d2.querySelectorAll('.sunit')].map((s) => s.value).join() === 'cL,L' && [...d2.querySelectorAll('.srow .slabel')].map((i) => i.value).join() === '33,1,5', 'editor: 33 cL and 1,5 L come back with their unit and number');
  void dom;

  // orders: 2 x 33cL + 1 x 1,5L (paid) and a weighted one; everything shown in litres
  const sz = sdb.prepare('select s.id, s.label, s.ml, s.price_cents from sizes s join products p on p.id=s.product_id where p.campaign_id=? order by s.sort').all(cid);
  sdb.exec(`insert into orders (campaign_id,campaign,number,first_name,last_name,member_no,email,total_cents,status,comment) values (${cid},'Boissons',901,'Lou','Test','1','l@example.org',1050,'paid','')`);
  const oid = sdb.prepare('select id from orders where number=901').get().id;
  const it = sdb.prepare("insert into order_items (order_id,product_id,size_id,product,variant,size,unit_cents,qty,grams,ml) values (?,?,?,'Jus de pomme','',?,?,?,NULL,?)");
  const pid = sdb.prepare('select id from products where campaign_id=?').get(cid).id;
  it.run(oid, pid, sz[0].id, sz[0].label, sz[0].price_cents, 2, sz[0].ml); it.run(oid, pid, sz[1].id, sz[1].label, sz[1].price_cents, 1, sz[1].ml);
  let html = await (await fetch(B + `/admin/commandes?c=${cid}&mode=produits`)).text();
  assert(html.includes('0,66 L') && html.includes('1,5 L') && html.includes('<th class="num">Volume<') && html.includes('2,16 L'.replace('2,16', '2,16')), 'Produits tab: litres per line, a Volume column, total 2,16 L');
  assert(/<b>2,16 L<\/b>volume total/.test(html), 'summary box: total volume in litres');
  assert(html.includes('0,33 L') && html.includes('1,5 L'), 'sizes are written in litres in the table (0,33 L, 1,5 L)');
  assert(!/sans poids non comptés/.test(html), 'a volume is not counted as an article without weight');
  html = await (await fetch(B + `/admin/commandes?c=${cid}&mode=clients`)).text();
  assert(html.includes('2 × Jus de pomme 0,33 L') && html.includes('Volume : 2,16 L'), 'Clients tab: lines and order volume in litres');
  const tc = cellsOf(await (await fetch(B + `/admin/totaux.csv?c=${cid}`)).text());
  assert(tc[0].slice(-2).join() === 'Volume (L),Volume total (L)', 'totaux.csv has the volume columns');
  const l33 = tc.find((l) => l.join(';').includes('33')); assert(l33 && l33.slice(3).join('|') === '|2|0|0,33|0,66', 'totaux.csv: 33cL line (' + (l33 && l33.slice(3).join('|')) + ')');
  const oc = cellsOf(await (await fetch(B + `/admin/commandes.csv?c=${cid}`)).text());
  assert(oc[1].slice(-2).join('|') === '0,33|0,66', 'commandes.csv: volume per unit and for the line (' + oc[1].slice(-2).join('|') + ')');
  // what is sold keeps its volume on the order lines, and a copy of the campaign keeps the volumes
  const { DatabaseSync: D2 } = require('node:sqlite');
  r = await post('/admin/campagnes/creer', form({ name: 'Boissons bis', copyFrom: String(cid) })); const cid2 = Number(/c=(\d+)/.exec(r.headers.get('location'))[1]);
  assert(new D2('/tmp/t4.db').prepare('select group_concat(s.ml) m from sizes s join products p on p.id=s.product_id where p.campaign_id=?').get(cid2).m === '330,1500', 'duplicating a campaign copies the volumes');

  // ---- minimum in litres: 0 = none, 20 L stored as millilitres, counted from the paid volumes of the next delivery
  const day = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const setMin = (value, unit) => post('/admin/campagnes/enregistrer', form({ id: String(cid), name: 'Boissons', lead_days: '0', delivery_date: day, min_value: value, min_unit: unit }));
  const camp = () => sdb.prepare('select min_kind k, min_value v from campaigns where id=?').get(cid);
  const shopText = async () => (await (await fetch(B + '/boutique/boissons')).text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  await setMin('3', 'L'); assert(camp().k === 'volume' && camp().v === 3000, 'minimum 3 L is stored as 3000 mL (' + JSON.stringify(camp()) + ')');
  assert(/seuil de 3 L\)/.test(await shopText()), 'shop: « sous réserve d’atteindre notre seuil de 3 L »');
  html = await (await fetch(B + '/admin')).text(); assert(/<option value="L" selected>/.test(html) && /value="3"/.test(html) && html.includes('Vendu : 0 L (❌ Seuil 3 L)'), 'admin card: volume progress 0 L, unit L selected in the editor');
  sdb.prepare('update orders set delivery_date=? where id=?').run(day, oid);
  html = await (await fetch(B + '/admin')).text(); assert(html.includes('Vendu : 2,16 L (❌ Seuil 3 L)'), 'paid volumes of the delivery are counted: 2,16 L of 3 L');
  await setMin('2', 'L'); html = await (await fetch(B + '/admin')).text(); assert(html.includes('Vendu : 2,16 L (✅ Seuil 2 L)') && !/sous réserve/.test(await shopText()), 'minimum reached: ✅ and no notice on the shop');
  await setMin('0', 'L'); html = await (await fetch(B + '/admin')).text(); assert(camp().k === '' && camp().v === 0 && !html.includes('Seuil 2 L') && !/sous réserve/.test(await shopText()), '0 removes the minimum');
  r = await setMin('-1', 'L'); assert(/seuil/i.test(decodeURIComponent(r.headers.get('location'))) && camp().k === '', 'a negative minimum is refused');

  // ---- picture for the campaign description
  html = await (await fetch(B + '/admin')).text();
  assert(html.includes('upimg"') && html.includes('class="upfile"') && html.includes('accept="image/jpeg,image/png,image/webp,image/gif"'), 'campaigns page: “Téléverser une image” under the description');
  const dom3 = new JSDOM(html, { url: B + '/admin', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom3.window, d = w.document; // node's fetch cannot send a jsdom File: send the matching bytes instead
  w.fetch = (u, o) => fetch(B + u, o && o.body && o.body.name ? { ...o, body: o.body.type === 'image/png' ? PNG : Buffer.from('hello') } : o);
  const errors = []; w.addEventListener('error', (e) => errors.push(e.message)); w.eval(read('admin-campaigns.js'));
  assert(!errors.length, 'campaigns script runs without errors ' + errors.join());
  const up = d.querySelector('.upfile'), file = new w.File([PNG], 'pixel.png', { type: 'image/png' });
  Object.defineProperty(up, 'files', { value: [file], configurable: true }); up.dispatchEvent(new w.Event('change', { bubbles: true }));
  for (let i = 0; i < 30 && !d.querySelector('.modal'); i++) await new Promise((x) => setTimeout(x, 100));
  const pop = d.querySelector('.modal'), box = pop && pop.querySelector('.linkbox');
  assert(pop && /Image téléversée/.test(pop.textContent) && box && /^https:\/\/localhost:8444\/uploads\/[0-9a-f]{16}\.png$/.test(box.value), 'popup with the image link: ' + (box && box.value));
  assert(pop.querySelector('.linkprev') && !pop.textContent.includes('<img'), 'popup: preview and the link only (no <img> tag text)');
  const got = await fetch(box.value.replace(/^https:\/\/localhost:8444/, B)); assert(got.status === 200 && /image\/png/.test(got.headers.get('content-type')), 'the link serves the uploaded image');
  let copied = ''; Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async (t) => { copied = t; } }, configurable: true });
  pop.querySelector('button.primary').click(); await new Promise((x) => setTimeout(x, 50));
  assert(copied === box.value && pop.querySelector('.copied-msg').textContent === 'Copié !', '“Copier le lien” puts the link on the clipboard');
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); assert(!d.querySelector('.modal'), 'Esc closes the popup');
  // a file that is not a picture: no popup, the message goes under the button
  const bad = new w.File(['hello'], 'x.txt', { type: 'text/plain' }); Object.defineProperty(up, 'files', { value: [bad], configurable: true }); up.dispatchEvent(new w.Event('change', { bubbles: true }));
  await new Promise((x) => setTimeout(x, 600));
  assert(!d.querySelector('.modal') && /Format non pris en charge/.test(up.parentElement.querySelector('.hint').textContent), 'a non-image file is refused with a message and no popup');
})();
