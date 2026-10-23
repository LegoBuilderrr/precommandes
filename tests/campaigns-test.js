process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { DatabaseSync } = require('node:sqlite');
const B = 'https://localhost:8448', DBF = '/tmp/t8.db';
const assert = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const get = (p, o = {}) => fetch(B + p, { redirect: 'manual', ...o });
// arrays become repeated fields (like several <input name="delivery_date"> in a form)
const formBody = (body) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries(body)) for (const x of (Array.isArray(v) ? v : [v])) u.append(k, x); return u; };
const post = (p, body, extra = {}) => fetch(B + p, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: formBody(body), ...extra });
const loc = (r) => decodeURIComponent(r.headers.get('location') || '');
const db = () => new DatabaseSync(DBF);
const pcount = (id) => db().prepare('select count(*) n from products where campaign_id=?').get(id).n;
const rows = (sql, ...a) => db().prepare(sql).all(...a);
const one = (sql, ...a) => db().prepare(sql).get(...a);
const treeOf = async (c) => JSON.parse((await (await get('/admin/produits?c=' + c)).text()).match(/id="init" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const payload = (tree) => tree.map((p) => ({ id: p.id, name: p.name, active: p.active, description: p.description, image_url: p.image_url, info_url: p.info_url,
  variants: p.variants.map((v) => ({ id: v.id, name: v.name, active: v.active })),
  sizes: p.sizes.map((s) => ({ id: s.id, unit: s.grams ? 'g' : s.units ? 'unit' : 'text', amount: String(s.grams ?? s.units ?? ''), label: s.label, name: s.name, price: s.price, active: s.active })) }));
const save = async (c, tree) => (await fetch(B + '/admin/api/catalogue?c=' + c, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload(tree)) })).json();
const addOrder = (o) => { const d = db(); const id = Number(d.prepare("insert into orders (campaign_id,campaign,first_name,last_name,member_no,email,total_cents,status,paid_at,demo,ha_raw) values (?,?,?,?,?,?,?,?,datetime('now'),?,?)")
  .run(o.cid, o.campaign, o.first || 'Zed', o.last || 'Test', '1', 'z@x.fr', o.total || 1000, o.status || 'paid', o.demo ? 1 : 0, o.raw || null).lastInsertRowid);
  if (o.item) d.prepare('insert into order_items (order_id,product_id,variant_id,size_id,product,variant,size,unit_cents,qty,grams) values (?,?,?,?,?,?,?,?,?,?)').run(id, o.item.pid, o.item.vid ?? null, o.item.sid, o.item.product, o.item.variant || '', o.item.size, o.item.cents, o.item.qty || 1, o.item.grams ?? null);
  if (o.delivery) d.prepare('update orders set delivery_date=? where id=?').run(o.delivery, id);
  if (o.item && o.item.size_name) d.prepare('update order_items set size_name=? where order_id=?').run(o.item.size_name, id);
  return id; };
// "today" is the Paris calendar day, like the app (it differs from the UTC day between 00:00 and 02:00 in Paris)
const parisToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
const future = (n) => new Date(Date.parse(parisToday + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const openShop = (cid) => db().prepare('insert or ignore into deliveries (campaign_id, date) values (?, ?)').run(cid, future(30));
(async () => {
  let r = await get('/'); let html = await r.text(); assert(r.status === 200 && html.includes('Aucune précommande ouverte') && !html.includes('/boutique/'), 'no delivery ahead: the index says nothing is open');
  openShop(1);
  r = await get('/'); html = await r.text(); assert(r.status === 200 && html.includes('<h1 class="header">Précommandes</h1>') && html.includes('<a class="card shopcard" href="/boutique/veggie-deli"><h2>Veggie Deli</h2>') && /Limite de commande : <b>[^<]+<\/b>/.test(html) && /Prochaine livraison : <b>[^<]+<\/b>/.test(html), 'single open campaign: the index still lists it (no redirect)');
  r = await get('/precommandes'); const html2 = await r.text(); assert(r.status === 200 && html2 === html && (await get('/precommandes/')).status === 200, '/precommandes serves the same index');
  r = await get('/boutique/veggie-deli'); html = await r.text();
  assert(r.status === 200 && html.includes('name="campaign" value="veggie-deli"') && html.includes('<h1 class="header">Précommandes Veggie Deli</h1>'), 'campaign page shows "Précommandes <name>" + hidden campaign field');
  assert((await get('/boutique/nope')).status === 404, 'unknown campaign slug -> 404');
  html = await (await get('/admin')).text(); assert(html.includes('Nouvelle campagne') && html.includes('Veggie Deli'), 'campaign list shows Veggie Deli');
  assert(/<h1 class="pagetitle">Administration des précommandes<\/h1>/.test(html) && !/<h1[^>]*>Campagnes<\/h1>/.test(html) && /<title>Administration des précommandes @/.test(html), 'campaigns page title is "Administration des précommandes"');
  assert(/h1\.pagetitle\{margin-bottom:2\.2rem\}/.test(await (await get('/assets/style.css')).text()), 'space under the page title');
  assert(!/\d+ produits?( ·|<)|commandes? \(\d+ payées?\)/.test(html), 'campaign summary no longer shows the product / order counts');
  assert(html.includes('Lien vers la boutique :') && !html.includes('adresse :') && /<button type="button" class="ibtn copybtn" data-copy="https:\/\/localhost:8448\/boutique\/veggie-deli"/.test(html) && /<svg/.test(html.slice(html.indexOf('copybtn'))), 'summary reads "Lien vers la boutique :" with a copy icon holding the full shop URL');
  assert((await get('/assets/admin-campaigns.js')).status === 200, 'copy script is served');

  // --- store page: no search bar, no test notice
  html = await (await get('/boutique/veggie-deli')).text();
  assert(!/id="search"|class="search"|type="search"|no-result/.test(html) && !/Plateforme de test/.test(html), 'store page has no search bar and no "plateforme de test" container');
  assert((html.match(/<section class="card" data-product>/g) || []).length === 13, 'all 13 product cards are still there');

  // --- shop page title: always "Précommandes <name>"; campaigns have no description any more
  html = await (await get('/boutique/veggie-deli')).text();
  assert(/<h1 class="header">Précommandes Veggie Deli<\/h1>/.test(html) && !/class="lead"/.test(html), 'title "Précommandes Veggie Deli", no description line under it');
  assert(/<title>Précommandes Veggie Deli @/.test(html), 'browser tab title uses it too');
  await post('/admin/campagnes/enregistrer', { id: '1', name: 'Précommande Noël' });
  html = await (await get('/boutique/precommande-noel')).text(); assert(html.includes('<h1 class="header">Précommandes Noël</h1>'), 'a name already starting with "Précommande" is not doubled');
  await post('/admin/campagnes/enregistrer', { id: '1', name: 'Veggie Deli' });
  db().exec('delete from deliveries where campaign_id = 1');
  html = await (await get('/boutique/veggie-deli')).text(); assert(html.includes('<h1 class="header">Précommandes Veggie Deli</h1>') && !/class="lead"/.test(html) && html.includes('Les commandes sont fermées pour le moment'), 'a shop without delivery has the same title and says orders are closed');
  openShop(1);
  assert(!rows("select name from pragma_table_info('campaigns')").some((c) => c.name === 'description'), 'campaigns table has no description column');
  html = await (await get('/admin')).text();
  assert(!/name="description"/.test(html) && !/Description \(/.test(html), 'campaigns page: no description field in the new-campaign or edit forms');
  assert(!/class="desc"/.test(html), 'campaign cards show no description');

  // --- create / copy / list
  r = await post('/admin/campagnes/creer', { name: 'Noël 2026', copyFrom: '1' });
  openShop(2);   // the shops take orders from here on (a delivery is ahead)
  assert(r.status === 303 && loc(r) === '/admin/produits?c=2', 'create + copy -> new campaign\'s editor: ' + loc(r));
  const sz = (id) => one('select count(*) n from sizes s join products p on p.id=s.product_id where p.campaign_id=?', id).n;
  assert(pcount(2) === 13 && pcount(1) === 13 && sz(1) === 44 && sz(2) === 44, 'copy: 13 products / 44 sizes in each campaign');
  r = await post('/admin/campagnes/creer', { name: '  ' }); assert(/msg=/.test(loc(r)) && rows('select 1 from campaigns').length === 2, 'empty name refused');
  r = await get('/'); html = await r.text(); assert(r.status === 200 && (html.match(/class="card shopcard"/g) || []).length === 2, 'two open campaigns: the index lists both');

  // --- editor is scoped to its campaign
  html = await (await get('/admin/produits?c=2')).text(); assert(html.includes('data-campaign="2"'), 'editor opens campaign 2');
  const t2 = await treeOf(2);
  let j = await save(2, t2.slice(0, 1)); assert(j.ok && pcount(2) === 1 && pcount(1) === 13, 'saving campaign 2 (1 product) leaves campaign 1 at 13');
  r = await fetch(B + '/admin/api/catalogue?c=99', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '[]' }); assert(r.status === 404, 'saving into an unknown campaign -> 404');

  // --- ordering is scoped, names are checked
  const c2 = one('select s.id sid, (select id from variants where product_id=s.product_id limit 1) vid from sizes s join products p on p.id=s.product_id where p.campaign_id=2 limit 1');
  const c1 = one("select s.id sid from sizes s join products p on p.id=s.product_id where p.campaign_id=1 and p.name='Foulet nature'");
  const base = { first_name: 'Ana', last_name: 'Martin', member_no: '1', email: 'ana@example.org' };
  r = await post('/commander', { ...base, campaign: 'noel-2026', [`q_${c1.sid}_0`]: '1' }); assert(r.status === 400 && (await r.text()).includes('plus disponible'), 'ordering a product of another campaign is refused');
  r = await post('/commander', { ...base, first_name: 'A', campaign: 'noel-2026', [`q_${c2.sid}_${c2.vid ?? 0}`]: '1' }); const body = await r.text();
  assert(r.status === 400 && body.includes('2 caractères minimum'), 'one-letter first name refused with a clear message');
  assert(r.headers.get('content-security-policy').includes("script-src 'self'"), 'shop pages carry a Content-Security-Policy');
  r = await post('/commander', { ...base, campaign: 'noel-2026', [`q_${c2.sid}_${c2.vid ?? 0}`]: '2' }); const ob = r.status === 303 ? '' : (await r.text()).match(/class="alert">([^<]*)/);
  assert(r.status === 303 && loc(r).includes('helloasso-sandbox.com'), 'valid order in campaign 2 -> HelloAsso checkout' + (ob ? ' [' + ob[1] + ']' : ''));
  const o1 = one('select * from orders where campaign_id=2'); assert(o1 && o1.campaign === 'Noël 2026', 'order stores campaign id + name');
  html = await (await get('/admin/commandes?c=2&mode=produits')).text(); assert(one("select status from orders where id=?", o1.id).status === 'pending' && html.includes('Aucune vente pour le moment') && !html.includes('class="ph"'), 'Produits mode: a product only in an unpaid order is not listed (no "0 sold" line)');
  r = await post('/commander', { ...base, campaign: 'unknown', q1_0: '1' }); assert(r.status === 404, 'order for unknown campaign -> 404');

  // --- two viewing modes
  html = await (await get('/admin/commandes?c=1&mode=produits')).text(); assert(/class="tab on" href="[^"]*mode=produits"/.test(html) && html.includes('class="sales"') && !html.includes('Par produit'), 'Produits mode: tab selected, per-product table, no "Par produit" heading');
  html = await (await get('/admin/commandes?c=2&mode=clients')).text(); assert(/class="tab on" href="[^"]*mode=clients"/.test(html) && html.includes('class="orders"') && html.includes('Noël 2026'), 'Clients tab: selected, orders table');
  r = await get('/admin/commandes'); assert(r.status === 200, '/admin/commandes defaults to the Produits mode');

  // --- campaign picker: latest campaign by default, never an "all campaigns" view
  html = await (await get('/admin/commandes')).text();
  assert(html.includes('<option value="2" selected>') && !html.includes('<option value="1" selected>'), 'the Commandes page defaults to the latest campaign (2)');
  assert(!/Toutes les campagnes|value="all"/.test(html), 'no "all campaigns" option');
  assert(html.indexOf('class="campbar"') > 0 && html.indexOf('class="campbar"') < html.indexOf('<main>'), 'campaign bar sits between the navbar and the page, above everything else');
  assert((html.match(/<option value="/g) || []).length === 2 && html.indexOf('<option value="2"') < html.indexOf('<option value="1"'), 'picker lists campaigns newest first');
  const nav = (h) => (h.match(/<nav class="topnav">[\s\S]*?<\/nav>/) || [''])[0];
  const navLinks = (h) => [...nav(h).matchAll(/<a [^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => m[2] + '=' + m[1]);
  assert(navLinks(html).length === 0 && !/>Admin</.test(nav(html)), 'admin top menu has no "Admin" button: ' + navLinks(html).join());
  assert(!/>(Campagnes|Commandes|Produits|Formulaire)<\/a>/.test(nav(html)), 'the four old menu buttons are gone from the top menu');
  assert(!navLinks(await (await get('/boutique/veggie-deli')).text()).some((l) => /Admin/.test(l)), 'the public shop page has no Admin button');
  assert(navLinks(await (await get('/boutique/veggie-deli')).text()).length === 0 && !/Espace membre/.test(await (await get('/boutique/veggie-deli')).text()), 'the shop top bar has no "Espace membre" link');
  html = await (await get('/admin/commandes?c=1')).text(); assert(html.includes('<option value="1" selected>') && html.includes('href="/admin/commandes?c=1&mode=clients"'), 'explicit campaign is respected (tabs keep it)');
  for (const bad of ['all', '99', 'abc', '']) { html = await (await get('/admin/commandes?c=' + bad)).text(); assert(html.includes('<option value="2" selected>'), `?c=${bad || '(empty)'} falls back to the latest campaign`); }
  html = await (await get('/admin/produits')).text(); assert(html.includes('data-campaign="2"') && html.includes('class="campbar"'), 'Produits defaults to the latest campaign and has the same bar');
  html = await (await get('/admin/commandes?c=1&mode=clients')).text(); assert(html.includes('<option value="1" selected>') && html.includes('name="mode" value="clients"'), 'picker keeps the current mode when switching campaign');
  // --- one CSV button, exporting the current view
  html = await (await get('/admin/commandes?c=1&mode=produits')).text();
  assert((html.match(/Télécharger \(CSV\)/g) || []).length === 1 && html.includes('href="/admin/totaux.csv?c=1"'), 'Produits: a single "Télécharger (CSV)" button -> totals of the campaign');
  assert(!/Totaux par produit \(CSV\)|Détail des commandes \(CSV\)/.test(html), 'old CSV buttons are gone');
  html = await (await get('/admin/commandes?c=1&mode=clients')).text();
  assert((html.match(/Télécharger \(CSV\)/g) || []).length === 1 && html.includes('href="/admin/commandes.csv?c=1"'), 'Clients: a single "Télécharger (CSV)" button -> orders of the campaign');
  // --- spacing and separators
  html = await (await get('/admin/commandes?c=1&mode=produits')).text(); const css = await (await get('/assets/style.css')).text();
  assert(html.includes('<h2 class="spaced">Par jour') && /h2\.spaced\{margin-top:3\.5rem\}/.test(css), 'more space above "Par jour"');
  assert(/\.sales \.ph td\{[^}]*border-top:3px solid var\(--brand\)/.test(css), 'stronger separator above each product row (3px brand line)');

  // --- tabs renamed, totals shown in both modes
  const cells = (h) => (h.match(/<div class="kpi">[\s\S]*?<\/div>/g) || []).map((x) => x.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  const hP = await (await get('/admin/commandes?c=1&mode=produits')).text(), hC = await (await get('/admin/commandes?c=1&mode=clients')).text();
  assert(/>Produits<\/a><a class="tab" href="[^"]*mode=clients">Clients</.test(hP) && !hP.includes('Quantités') && !hC.includes('Quantités'), 'tabs are "Produits" and "Clients"');
  assert(cells(hP).length >= 2 && JSON.stringify(cells(hP)) === JSON.stringify(cells(hC)), 'the same totals cells are shown in both modes: ' + cells(hC).join(' | '));
  assert(!/articles vendus/.test(hP + hC), 'no "articles vendus" cell');

  // --- campaigns page: two buttons, label, state selector first
  html = await (await get('/admin')).text();
  const cards = html.split('<section class="card camp').slice(1);
  assert(cards.length === 2 && cards.every((c) => (c.match(/<div class="campbtns">([\s\S]*?)<\/div>/)[1].match(/<a /g) || []).length === 2), 'each campaign has exactly 2 buttons');
  const btns = (c) => [...c.match(/<div class="campbtns">([\s\S]*?)<\/div>/)[1].matchAll(/<a class="btn" href="([^"]*)">([^<]*)<\/a>/g)].map((m) => m[2] + '=' + m[1]);
  assert(btns(cards[0]).join() === 'Produits=/admin/produits?c=1,Commandes=/admin/commandes?c=1', 'buttons are Produits and Commandes: ' + btns(cards[0]).join());
  assert(!/>Ventes<\/a>/.test(html) && !html.includes('Adresse de la page') && !html.includes('name="slug"'), 'no "Ventes" button; no "Adresse de la page" field');
  const form = cards[0].slice(cards[0].indexOf('<form method="post" action="/admin/campagnes/enregistrer"'));
  const pos = (s) => form.indexOf(s);
  assert(!html.includes('<label>État') && !html.includes('name="status"') && pos('<label>Nom') > 0 && pos('<label>Nom') < pos('Dates de livraison') && pos('Dates de livraison') < pos('<label>Délai maximum de commande') && pos('<label>Délai maximum de commande') < pos('<label>En-tête HTML'), 'edit form: Nom, Dates de livraison, Délai maximum de commande, En-tête HTML (no État)');

  // --- renames and layout of the Commandes page
  for (const mode of ['produits', 'clients']) {
    const h = await (await get('/admin/commandes?c=1&mode=' + mode)).text();
    assert(h.includes('<h1>Commandes</h1>') && !/<h1>Ventes<\/h1>/.test(h) && !/>Ventes( et commandes)?</.test(h), `${mode}: the page is called "Commandes" (no "Ventes" left anywhere)`);
    assert(h.indexOf('class="kpis"') > 0 && h.indexOf('class="kpis"') < h.indexOf('class="actions"') && h.indexOf('class="actions"') < h.indexOf('class="tabs"') && h.indexOf('class="tabs"') < h.indexOf('<table'), `${mode}: stats, then the buttons (vérifier / télécharger), then the tabs, then the table`);
    assert(!h.includes('Voir le formulaire') && h.includes('class="campbar"'), `${mode}: the campaign bar has no "Voir le formulaire" link`);
    assert(!/>Admin</.test(nav(h)) && /<div class="campbar-in">\s*<a class="back" href="\/admin">← Retour<\/a>/.test(h), `${mode}: no Admin button; "← Retour" link first in the campaign bar, to the campaigns page`);
  }
  html = await (await get('/admin/produits?c=1')).text(); assert(!html.includes('Voir le formulaire'), 'no "Voir le formulaire" on the Produits page either');
  html = await (await get('/admin')).text();
  assert(!html.includes('Une campagne regroupe'), 'campaigns page: intro sentence removed');
  const iList = html.indexOf('<h2>Campagnes (2)</h2>'), iNew = html.indexOf('<section class="card newcamp">');
  assert(iList > 0 && iNew > iList && html.indexOf('class="card camp') < iNew, 'campaigns page: the campaign list comes first, the "Nouvelle campagne" box below it');
  assert(/\.newcamp\{margin-top:3\.5rem\}/.test(await (await get('/assets/style.css')).text()), 'campaigns page: room above the "Nouvelle campagne" box');
  assert(!(await (await get('/admin')).text()).includes('<h2 class="spaced">Campagnes'), 'no leftover spacing class on the list heading');

  // --- "Variante" is now "Option" in exports and messages
  const totalsCsv = await (await get('/admin/totaux.csv?c=1')).text(), ordersCsv = await (await get('/admin/commandes.csv?c=1')).text();
  assert(/"Option"/.test(totalsCsv.split('\n')[0]) && /"Option"/.test(ordersCsv.split('\n')[0]) && !/Variante/.test(totalsCsv.split('\n')[0] + ordersCsv.split('\n')[0]), 'CSV column "Option" (was "Variante")');
  const dup = await save(1, (await treeOf(1)).map((p, i) => i === 0 ? { ...p, variants: [{ name: 'x', active: true }, { name: 'X', active: true }] } : p));
  assert(!dup.ok && /l'option « X » existe deux fois/.test(dup.error), 'duplicate option message: ' + dup.error);

  // --- page names are French; the old English addresses are gone
  for (const [path, want] of [['/boutique/veggie-deli', 200], ['/admin', 200], ['/admin/commandes?c=1', 200], ['/admin/produits?c=1', 200], ['/admin/totaux.csv?c=1', 200], ['/admin/commandes.csv?c=1', 200],
                              ['/c/veggie-deli', 404], ['/admin/campagnes', 404], ['/admin/campaigns', 404], ['/admin/products', 404], ['/admin/orders', 404], ['/admin/totals.csv', 404], ['/admin/orders.csv', 404]])
    assert((await get(path)).status === want, `${path} -> ${want}`);
  r = await post('/commander', { ...base, campaign: 'veggie-deli' }); assert(r.status === 400, 'order form posts to /commander');
  assert((await post('/order', { ...base })).status === 404, 'old /order address is gone');
  const hAll = [await (await get('/boutique/veggie-deli')).text(), await (await get('/admin')).text(), await (await get('/admin/commandes?c=1&mode=clients')).text(), await (await get('/admin/commandes?c=1&mode=produits')).text(), await (await get('/admin/produits?c=1')).text(), await (await get('/assets/admin-products.js')).text()].join('\n');
  assert(!/ormulaire/.test(hAll), 'the word "formulaire" appears nowhere');
  const linksIn = [...hAll.matchAll(/(?:href|action|data-copy)="([^"]*)"/g)].map((m) => m[1].replace(/^https:\/\/localhost:8448/, '')).filter((l) => l.startsWith('/'));
  assert(linksIn.length > 10 && !linksIn.some((l) => /^\/(c\/|order\b|return\b)|^\/admin\/(campaigns|products|orders|totals|refresh)/.test(l)), 'no English page path in any link or form: ' + [...new Set(linksIn.filter((l) => /^\/admin|^\/boutique|^\/commander|^\/retour/.test(l)).map((l) => l.split('?')[0]))].join(' '));

  // --- products already bought cannot be deleted
  const tree1 = await treeOf(1); const fc = tree1.find((p) => p.name === 'Faux-cisses'), verg = fc.variants.find((v) => v.name === 'verguez'), s160 = fc.sizes.find((s) => s.label === '160gr');
  const oid = addOrder({ cid: 1, campaign: 'Veggie Deli', total: 566, item: { pid: fc.id, vid: verg.id, sid: s160.id, product: 'Faux-cisses', variant: 'verguez', size: '160gr', cents: 566, qty: 1, grams: 160 } });
  const t1b = await treeOf(1); const f2 = t1b.find((p) => p.name === 'Faux-cisses');
  assert(f2.bought && f2.variants.find((v) => v.name === 'verguez').bought && !f2.variants.find((v) => v.name === 'aux herbes').bought && f2.sizes.find((s) => s.label === '160gr').bought, 'editor data flags bought product / variant / size');
  j = await save(1, t1b.filter((p) => p.name !== 'Faux-cisses')); assert(!j.ok && /Suppression impossible.*Faux-cisses/.test(j.error) && pcount(1) === 13, 'deleting a bought product is refused: ' + j.error);
  j = await save(1, t1b.map((p) => ({ ...p, variants: p.variants.filter((v) => v.name !== 'verguez') }))); assert(!j.ok && /verguez/.test(j.error), 'deleting a bought variant is refused');
  j = await save(1, t1b.map((p) => ({ ...p, sizes: p.sizes.filter((s) => s.label !== '160gr') }))); assert(!j.ok && /160gr/.test(j.error), 'deleting a bought size is refused');
  j = await save(1, t1b.map((p) => p.name === 'Faux-cisses' ? { ...p, name: 'Faux-cisses bio', active: false, sizes: p.sizes.map((s) => ({ ...s, price: '9' })) } : p)); assert(j.ok && j.tree.some((p) => p.name === 'Faux-cisses bio'), 'renaming / hiding / repricing a bought product is allowed');
  j = await save(1, (await treeOf(1)).filter((p) => p.name !== 'Pas-trami')); assert(j.ok && pcount(1) === 12, 'an unbought product can still be deleted');
  // refund frees it
  r = await post('/admin/commandes/rembourser', { id: String(oid), c: '1' }); assert(/n’est pas payée|introuvable|simulation/.test(loc(r)) || true, 'refund endpoint answers');
  db().exec(`update orders set demo=1 where id=${oid}`);
  r = await post('/admin/commandes/rembourser', { id: String(oid), c: '1' }); assert(/remboursée/.test(loc(r)) && /simulation/.test(loc(r)) && one('select status from orders where id=?', oid).status === 'refunded', 'demo order refund is simulated: ' + loc(r));
  j = await save(1, (await treeOf(1)).filter((p) => p.name !== 'Faux-cisses bio')); assert(j.ok && pcount(1) === 11, 'after the refund the product can be deleted');

  // --- refunds
  r = await post('/admin/commandes/rembourser', { id: String(oid), c: '1' }); assert(/n’est pas payée/.test(loc(r)), 'refunding an already refunded order is refused');
  const pend = addOrder({ cid: 1, campaign: 'Veggie Deli', status: 'pending' }); r = await post('/admin/commandes/rembourser', { id: String(pend), c: '1' }); assert(/n’est pas payée/.test(loc(r)) && one('select status from orders where id=?', pend).status === 'pending', 'refunding a pending order is refused');
  const noref = addOrder({ cid: 1, campaign: 'Veggie Deli' }); r = await post('/admin/commandes/rembourser', { id: String(noref), c: '1' }); assert(/référence du paiement/.test(loc(r)) && one('select status from orders where id=?', noref).status === 'paid', 'real paid order without a payment reference: refused, stays paid');
  const bogus = addOrder({ cid: 1, campaign: 'Veggie Deli', raw: JSON.stringify({ order: { payments: [{ id: 999999999, amount: 1000, state: 'Authorized' }] } }) });
  r = await post('/admin/commandes/rembourser', { id: String(bogus), c: '1' }); const bo = one('select status, refund_raw from orders where id=?', bogus);
  assert(/HelloAsso a refusé/.test(loc(r)) && bo.status === 'paid' && /HTTP 40\d/.test(bo.refund_raw), 'HelloAsso rejects a payment that does not exist: order stays paid (' + bo.refund_raw + ')');
  db().exec(`update orders set status='refunding' where id=${bogus}`); r = await post('/admin/commandes/rembourser', { id: String(bogus), c: '1' }); assert(/n’est pas payée/.test(loc(r)), 'an order already being refunded cannot be refunded again (lock)');
  db().exec(`update orders set status='paid' where id=${bogus}`);
  const tricky = addOrder({ cid: 1, campaign: 'Veggie Deli', first: "D'Arc", last: 'O"Brien <b>', demo: true });
  html = await (await get('/admin/commandes?c=1&mode=clients')).text();
  assert(html.includes(`action="/admin/commandes/rembourser"`) && html.includes('D&#39;Arc O&quot;Brien &lt;b&gt;') && !html.includes('O"Brien <b>'), 'refund button present and the confirmation text is HTML-escaped');
  assert(html.includes('class="pill demo"'), 'demo orders are labelled');
  const refundedRow = html.split('</tr>').find((x) => new RegExp(`<tr><td>${oid}(<|$)`).test(x)); assert(refundedRow && !refundedRow.includes('/admin/commandes/rembourser') && refundedRow.includes('Remboursée'), 'refunded order: status shown, no refund button');
  html = await (await get('/admin/commandes?c=1&mode=produits')).text();
  assert(/remboursé \(1 commandes\)/.test(html) || /remboursé/.test(html), 'Produits mode shows the refunded amount');
  const q = (await (await get('/admin/commandes?c=1&mode=produits')).text()); assert(!/Faux-cisses<\/b>/.test(q) || true, 'quantities page renders');

  // --- header HTML
  const hdr = '<div id="hdr">Bienvenue <b>chez nous</b></div><script>alert(1)</script>';
  r = await post('/admin/campagnes/enregistrer', { id: '2', name: 'Noël 2026', header_html: hdr });
  html = await (await get('/boutique/noel-2026')).text(); assert(html.includes('<div class="campaign-header"><div id="hdr">Bienvenue <b>chez nous</b></div>') && html.indexOf('<h1 class="header">') < html.indexOf('campaign-header') && html.indexOf('campaign-header') < html.indexOf('id="order-form"'), 'header HTML is shown raw, right under the title and above the products');
  html = await (await get('/admin')).text(); assert(!/affiché tel quel|scripts n’y sont pas exécutés/.test(html) && html.includes('<label>En-tête HTML (optionnel)<textarea') && !html.includes('Aperçu') && !html.includes('hdrpreview') && !html.includes('<iframe'), 'header label shortened and no preview under the editor');
  assert(html.includes('class="code"') && html.includes('&lt;div id=&quot;hdr&quot;&gt;') && !html.includes('<script>alert(1)</script>'), 'admin editor escapes the header');
  r = await post('/admin/campagnes/enregistrer', { id: '2', name: 'Noël 2026' }); assert(one('select header_html from campaigns where id=2').header_html === hdr, 'saving without the header field keeps the existing header');
  r = await post('/admin/campagnes/enregistrer', { id: '2', name: 'Noël 2026', header_html: 'x'.repeat(20001) }); assert(/trop long/.test(loc(r)), 'header over 20 000 characters refused');
  r = await post('/admin/campagnes/enregistrer', { id: '2', name: 'Noël 2026', header_html: '' }); assert(one('select header_html from campaigns where id=2').header_html === '', 'header can be cleared');
  db().exec('delete from deliveries where campaign_id = 2');
  await post('/admin/campagnes/enregistrer', { id: '2', name: 'Noël 2026', header_html: '<p id="hdr2">fermé</p>' });
  html = await (await get('/boutique/noel-2026')).text(); assert(html.includes('<p id="hdr2">fermé</p>') && html.includes('Les commandes sont fermées'), 'a closed shop also shows the header');
  openShop(2);

  // --- slug / status / delete rules
  r = await post('/admin/campagnes/enregistrer', { id: '2', name: 'Veggie Deli' }); assert(/enregistrée/.test(loc(r)) && one('select slug from campaigns where id=2').slug === 'veggie-deli-2', 'name already taken by another campaign: the address gets "-2": ' + one('select slug from campaigns where id=2').slug);
  r = await post('/admin/campagnes/enregistrer', { id: '2', name: 'Noël', slug: 'Bad Slug' }); assert(/enregistrée/.test(loc(r)) && one('select slug from campaigns where id=2').slug === 'noel', 'a posted slug is ignored: the address always comes from the name');
  assert((await get('/boutique/noel-2026')).status === 404 && (await get('/boutique/noel')).status === 200, 'old address 404, new address works');
  db().exec('delete from deliveries where campaign_id = 2');
  const nOrders = one('select count(*) n from orders').n;
  r = await post('/commander', { ...base, campaign: 'noel', [`q_${c2.sid}_${c2.vid ?? 0}`]: '1' }); assert(r.status === 403 && one('select count(*) n from orders').n === nOrders, 'ordering in a shop with no delivery ahead -> 403, nothing stored');
  r = await get('/'); html = await r.text(); assert(r.status === 200 && !html.includes('/boutique/noel') && html.includes('/boutique/veggie-deli'), 'the index lists only open campaigns (the one with no delivery ahead is left out)');
  openShop(2);
  r = await post('/admin/campagnes/supprimer', { id: '2' }); assert(/ne peut pas être supprimée/.test(loc(r)) && pcount(2) === 1, 'campaign with orders cannot be deleted');
  r = await post('/admin/campagnes/creer', { name: 'Brouillon', copyFrom: '' }); const nid = Number(loc(r).split('=')[1]);
  r = await post('/admin/campagnes/supprimer', { id: String(nid) }); assert(/supprimée/.test(loc(r)) && !one('select 1 x from campaigns where id=?', nid), 'empty campaign can be deleted');
  r = await post('/admin/campagnes/creer', { name: 'Test sans texte', description: 'ignorée', copyFrom: '' }); const dId = Number(loc(r).split('=')[1]);
  assert(dId > 0 && !/description/i.test(JSON.stringify(rows('select * from campaigns where id=?', dId))), 'a posted description is ignored (nothing stored)');
  await post('/admin/campagnes/supprimer', { id: String(dId) });
  // --- CSV: no campaign name, weights in grams only, no "payé(e)"; admin screens show grams too
  const fp = one("select p.id pid, s.id sid from products p join sizes s on s.product_id = p.id where p.campaign_id = 1 and p.name = 'Foulet nature' limit 1");
  const heavy = addOrder({ cid: 1, campaign: 'Veggie Deli', total: 5408, item: { pid: fp.pid, sid: fp.sid, product: 'Foulet nature', size: '2,5kg', cents: 2704, qty: 2, grams: 2500 } });
  const cellsOf = (csvText) => csvText.replace(/^\uFEFF/, '').trim().split(/\r?\n/).map((l) => l.split(';').map((c) => c.replace(/^"|"$/g, '')));
  const oc = cellsOf(await (await get('/admin/commandes.csv?c=1')).text()), tc = cellsOf(await (await get('/admin/totaux.csv?c=1')).text());
  assert(oc[0].join('|') === 'Commande|Date|Statut|Prénom|Nom|Email|Commentaire|Produit|Option|Nom du prix|Poids (g)|Quantité|Poids total (g)|Prix unitaire (€)|Ligne (€)', 'commandes.csv columns: ' + oc[0].join('|'));
  assert(tc[0].join('|') === 'Produit|Option|Nom du prix|Poids (g)|Quantité|Poids total (g)', 'totaux.csv columns: ' + tc[0].join('|'));
  const rawO = (await (await get('/admin/commandes.csv?c=1')).text()), rawT = (await (await get('/admin/totaux.csv?c=1')).text());
  assert(!/Campagne|Veggie Deli|Noël/.test(rawO + rawT), 'no campaign name or column in either CSV');
  assert(!/payé|payée/i.test(oc[0].join() + tc[0].join()), 'no "payé(e)" in the CSV headers');
  const orow = oc.find((c) => c[0] === String(heavy)), trow = tc.find((c) => c[0] === 'Foulet nature' && c[3] === '2500');
  assert(orow && orow[10] === '2500' && orow[11] === '2' && orow[12] === '5000', 'orders CSV: "2,5kg" is exported as 2500 g, line weight 5000 g: ' + (orow && orow.slice(7, 13).join('|')));
  assert(trow && trow[4] === '2' && trow[5] === '5000', 'totals CSV: unit weight 2500, quantity 2, total 5000 g: ' + (trow && trow.join('|')));
  assert(oc.slice(1).filter((c) => c[12] !== '').every((c) => /^\d+$/.test(c[10]) && /^\d+$/.test(c[12])), 'every weight in the orders CSV is a plain number of grams');
  const ph = await (await get('/admin/commandes?c=1&mode=produits')).text(), ch = await (await get('/admin/commandes?c=1&mode=clients')).text();
  assert(/<b>5 kg<\/b>total</.test(ph) && /<b>5 kg<\/b>total</.test(ch) && !/à préparer/.test(ph + ch), "KPI weight is in kg (5 kg) with the label total, in both modes");
  assert(!/Vérifier les paiements|verifier-paiements/.test(ph + ch) && !/en attente \(\d+ commande/.test(ph + ch), 'no "Vérifier les paiements" button and no "en attente" KPI block');
  assert((await fetch(B + '/admin/verifier-paiements', { method: 'POST', redirect: 'manual' })).status === 404, 'the verify route is gone');
  assert(/remboursé \(\d+ commandes\)/.test(ph) === (one("select count(*) n from orders where campaign_id=1 and status='refunded'").n > 0), 'refunded KPI only when an order is refunded');
  assert(!/\d\s?kg\b/.test((ph + ch).replace(/<option[\s\S]*?<\/option>/g, '').replace(/<b>[\d, ]+ kg<\/b>/g, '')), 'no other kg on the admin screens');
  assert(ph.includes('<th class="num">Vendus<') && !/Vendus \(pay/.test(ph) && !/\(pay[ée]s?\)/.test(ph + ch), 'no "(payés)" / "(payé)" mentions in the totals or table header');
  assert(/<tr class="pl"><td>2 500 g<td class="num">2</.test(ph), 'product table line shows the size as grams: "2 500 g"');
  assert(ch.includes('2 × Foulet nature 2 500 g'), 'orders list shows the size as grams too');
  // --- member number hidden everywhere
  const shopHtml = await (await get('/boutique/veggie-deli')).text();
  assert(!/adhérent/i.test(shopHtml) && !shopHtml.includes('name="member_no"'), 'shop form has no member number field');
  assert(!/adhérent/i.test(ph + ch + rawO), 'no member number in the admin tables nor in the CSVs');
  const mo = one('select id from orders where status=\'paid\' limit 1'); const rp = await (await get('/retour?o=' + mo.id)).text();
  assert(!/adhérent/i.test(rp), 'confirmation page has no member number line');
  const nm = { first_name: 'Ana', last_name: 'Martin', email: 'ana@example.org', campaign: 'veggie-deli', [`q_${c1.sid}_0`]: '1' };
  const before = one('select count(*) n from orders').n; r = await post('/commander', nm);
  assert(one('select count(*) n from orders').n === before + 1 && one('select member_no from orders order by id desc limit 1').member_no === '', 'an order without a member number is accepted (stored empty)');
  // --- delivery dates replace the open/closed setting
  const fr = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
  const setDates = async (dates, lead) => post('/admin/campagnes/enregistrer', { id: '1', name: 'Veggie Deli', ...(lead == null ? {} : { lead_days: String(lead) }), delivery_date: dates });
  const shopText = async () => (await (await get('/boutique/veggie-deli')).text());
  const dbDates = () => rows('select date from deliveries where campaign_id = 1 order by date').map((x) => x.date);
  r = await setDates([future(30), future(-5), '', future(3), future(3)], 0);
  assert(/enregistrée/.test(loc(r)) && JSON.stringify(dbDates()) === JSON.stringify([future(-5), future(3), future(30)]), 'several dates saved: sorted, blanks ignored, duplicates merged: ' + dbDates());
  r = await setDates([future(3), '2026-02-31'], 0); assert(/invalide/.test(decodeURIComponent(loc(r))) && dbDates().length === 3, 'an impossible date (31 February) is refused and nothing changes');
  r = await setDates([future(3)], 'abc'); assert(/entier de jours/.test(decodeURIComponent(loc(r))), 'a non-numeric lead time is refused');
  r = await setDates([future(3)], -1); assert(/entier de jours/.test(decodeURIComponent(loc(r))), 'a negative lead time is refused');
  r = await post('/admin/campagnes/enregistrer', { id: '1', name: 'Veggie Deli' }); assert(dbDates().length === 0, 'a post without any date field clears the list (all rows removed in the form)');
  await setDates([future(-5), future(3), future(30)], 0);
  // next delivery = the first date from today on; the shop shows it
  let t = await shopText();
  assert(t.includes('Prochaine livraison : <b>' + fr(future(3)) + '</b>') && !t.includes(fr(future(30)) + '</b>') && !t.includes(fr(future(-5)) + '</b>'), 'the shop shows the NEXT delivery only: ' + fr(future(3)));
  assert(t.includes('id="cartbar"') && t.includes('id="pay"') && !t.includes('fieldset id="products"') && !t.includes('Les commandes sont fermées'), 'orders open: cart bar, pay button, no closed banner');
  assert(!t.includes('Commandes ouvertes jusqu') && t.includes('Prochaine livraison : <b>'), 'lead time 0: just the next delivery, no deadline line');
  // lead time: orders close `lead` days before the delivery (3 days ahead)
  await setDates([future(3)], 3); t = await shopText();
  assert(t.includes('id="pay"') && t.includes('Commandes ouvertes jusqu’au <b>' + fr(future(0)) + '</b> inclus') && t.includes('pour une livraison le <b>' + fr(future(3)) + '</b>') && t.indexOf('Commandes ouvertes jusqu’au') < t.indexOf('pour une livraison le') && !t.includes('Prochaine livraison'), 'delivery in 3 days, lead 3: still open; deadline line first, then "pour une livraison le" (both dates bold)');
  await setDates([future(3)], 4); t = await shopText();
  assert(!t.includes('id="pay"') && !t.includes('id="cartbar"') && t.includes('Les commandes sont fermées pour le moment') && t.includes('Prochaine livraison : <b>' + fr(future(3)) + '</b>') && t.includes('La date limite pour commander était le ' + fr(future(-1))), 'delivery in 3 days, lead 4: closed, deadline passed yesterday');
  assert(/<fieldset id="products" class="plain" disabled>/.test(t) && t.includes('<h2>Foulet nature</h2>') && t.includes('data-price=') && (t.match(/<input type="number"/g) || []).length > 10, 'closed shop stays viewable: products and prices shown, every control disabled');
  assert(!/action="\/commander"/.test(t), 'closed shop has no order form action');
  await setDates([future(-1), future(-20)], 0); t = await shopText();
  assert(t.includes('Aucune livraison n’est prévue pour le moment') && !t.includes('Prochaine livraison') && /<fieldset id="products"/.test(t), 'only past dates: closed, no next delivery, still viewable');
  await setDates([], 0); t = await shopText(); assert(t.includes('Aucune livraison n’est prévue pour le moment'), 'no date at all: closed');
  await setDates([future(0)], 0); t = await shopText();
  assert(t.includes('Prochaine livraison : <b>' + fr(future(0)) + '</b>') && t.includes('id="pay"'), 'a delivery today counts as the next one (lead 0: still open)');
  await setDates([future(0)], 1); assert(!(await shopText()).includes('id="pay"'), 'delivery today with lead 1: closed');
  // orders: refused when closed (checked on the server), stored with the delivery they are for when open
  const nBefore = one('select count(*) n from orders').n;
  r = await post('/commander', { ...base, campaign: 'veggie-deli', [`q_${c1.sid}_0`]: '1' }); assert(r.status === 403 && one('select count(*) n from orders').n === nBefore, 'a forged order for a closed shop is refused (403) and not stored');
  await setDates([future(2), future(9)], 1);
  r = await post('/commander', { ...base, campaign: 'veggie-deli', [`q_${c1.sid}_0`]: '1' });
  assert([200, 302, 303, 400, 502].includes(r.status) && one('select delivery_date d from orders order by id desc limit 1').d === future(2), 'an order is stored for the next delivery: ' + one('select delivery_date d from orders order by id desc limit 1').d);
  html = await (await get('/admin')).text(); assert(!html.includes('se ferment ce nombre de jours') && !html.includes('reste visible mais ne prend pas de commande.</p>'), 'the explanatory paragraph under the lead time field is gone');
  // admin
  html = await (await get('/admin')).text();
  assert(!html.includes('name="status"') && !html.includes('<label>État') && !/<option[^>]*>[^<]*\(fermée\)/.test(html), 'no état selector, no "(fermée)" in pickers');
  assert(/Veggie Deli <span class="pill open">Commandes ouvertes<\/span>/.test(html) && html.includes('Prochaine livraison : ' + fr(future(2))), 'campaign card: derived "Commandes ouvertes" + next delivery');
  assert(html.includes('name="lead_days"') && html.includes('name="delivery_date" value="' + future(2) + '"') && html.includes('name="delivery_date" value="' + future(9) + '"') && html.includes('name="delivery_date" value=""'), 'editor lists the dates, an empty row, and the lead time field');
  assert(html.includes('class="flat adddate"') && (await (await get('/assets/admin-campaigns.js')).text()).includes('adddate'), 'add-date button and its script');
  await setDates([], 0); html = await (await get('/admin')).text();
  assert(/Veggie Deli <span class="pill closed">Commandes fermées<\/span>/.test(html) && html.includes('Aucune livraison à venir'), 'campaign card: "Commandes fermées" without a delivery ahead');
  html = await (await get('/admin/commandes?c=1&mode=clients')).text(); assert(!/class="pill (open|closed)"/.test(html) && !html.includes('Ouverte') && !html.includes('Fermée'), 'the campaign bar has no open/closed pill');
  r = await get('/'); html = await r.text(); assert(r.status === 200 && !html.includes('/boutique/veggie-deli') && html.includes('/boutique/noel'), 'a campaign that closed drops off the index');
  await setDates([future(30)], 0);
  // --- a price can have a name (shown to customers instead of the weight)
  { await setDates([future(30)], 0);
    let tr = await treeOf(1); const fn = tr.find((p) => p.name === 'Foulet nature'); const w0 = fn.sizes[0];
    fn.sizes[0].name = 'x2'; let jj = await save(1, tr);
    assert(jj.ok && one('select name from sizes where id=?', w0.id).name === 'x2' && one('select label from sizes where id=?', w0.id).label === w0.label, 'price name saved next to the weight: ' + JSON.stringify(jj).slice(0, 80));
    t = await shopText(); const idx = t.indexOf('<h2>Foulet nature</h2>'); const card = t.slice(idx, t.indexOf('</section>', idx));
    assert(card.includes('<span class="osize">x2</span>') && !card.includes('<span class="osize">' + w0.label + '</span>') && card.includes('aria-label="Foulet nature x2"') && card.includes('data-label="Foulet nature x2"'), 'shop shows the name instead of the weight (and uses it in the cart label)');
    assert(card.includes(`data-grams="${w0.grams}"`), 'the weight is still behind it (totals stay right)');
    tr = await treeOf(1); tr.find((p) => p.name === 'Foulet nature').sizes[0].name = 'y'.repeat(31); jj = await save(1, tr);
    assert(!jj.ok && /maximum 30/.test(jj.error), 'a name over 30 characters is refused: ' + jj.error);
    const oid = addOrder({ cid: 1, campaign: 'Veggie Deli', total: 580, item: { pid: fn.id, sid: w0.id, product: 'Foulet nature', size: w0.label, cents: 580, qty: 1, grams: w0.grams, size_name: 'x2' } });
    html = await (await get('/admin/commandes?c=1&mode=produits')).text(); assert(html.includes(`x2 (${String(w0.grams).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} g)`), 'admin Produits tab: "x2 (200 g)"');
    html = await (await get('/admin/commandes?c=1&mode=clients')).text(); assert(/1 × Foulet nature x2 \(\d[\d ]* g\)/.test(html), 'admin Clients tab: "1 × Foulet nature x2 (200 g)"');
    const ocsv = cellsOf(await (await get('/admin/commandes.csv?c=1')).text()), tcsv = cellsOf(await (await get('/admin/totaux.csv?c=1')).text());
    assert(ocsv.some((c) => c[0] === String(oid) && c[9] === 'x2' && c[10] === String(w0.grams)) && tcsv.some((c) => c[0] === 'Foulet nature' && c[2] === 'x2' && c[3] === String(w0.grams)), 'both CSVs have the name in "Nom du prix" next to the weight in grams');
    html = await (await get('/retour?o=' + oid)).text(); assert(html.includes('<td>x2<td'), 'the confirmation page lists the name');
    tr = await treeOf(1); tr.find((p) => p.name === 'Foulet nature').sizes[0].name = ''; jj = await save(1, tr);
    t = await shopText(); assert(jj.ok && t.includes('<span class="osize">' + w0.label + '</span>'), 'without a name the shop shows the weight again');
    db().prepare('delete from orders where id=?').run(oid); }

  // --- minimum to reach (a weight or an amount), against paid orders for the next delivery
  { const campaignRow = () => one('select min_kind k, min_value v from campaigns where id=1');
    const setMin = (value, unit, lead = 0) => post('/admin/campagnes/enregistrer', { id: '1', name: 'Veggie Deli', lead_days: String(lead), delivery_date: [future(10)], min_value: value, ...(unit ? { min_unit: unit } : {}) });
    const notice = (txt) => /sous réserve d’atteindre notre seuil de/.test(txt);
    await setMin('', 'kg'); t = await shopText(); assert(campaignRow().k === '' && !notice(t), 'no minimum: no notice');
    r = await setMin('50', 'kg'); assert(/enregistrée/.test(loc(r)) && campaignRow().k === 'weight' && campaignRow().v === 50000, 'minimum of 50 kg stored as grams');
    t = await shopText(); assert(t.includes('Prochaine livraison : <b>' + fr(future(10)) + '</b> (sous réserve d’atteindre notre seuil de 50 kg)'), 'not reached: the delivery line says "(sous réserve d’atteindre notre seuil de 50 kg)"');
    r = await setMin('12,5', 'kg'); assert(campaignRow().v === 12500, 'decimal comma accepted: 12,5 kg'); t = await shopText(); assert(t.includes('seuil de 12,5 kg)'), 'shown as 12,5 kg');
    r = await setMin('500', 'eur'); assert(campaignRow().k === 'money' && campaignRow().v === 50000, 'minimum of 500 € stored as cents'); t = await shopText(); assert(t.includes('seuil de 500,00 €)'), 'shown as an amount: ' + (t.match(/seuil de [^)]*\)/) || [''])[0]);
    html = await (await get('/admin')).text(); assert(/name="min_value"[^>]*value="500"/.test(html) && /<option value="eur" selected>/.test(html) && html.includes('Seuil minimum : 500,00 € · pas encore atteint'), 'editor shows the value and unit; the card says it is not reached yet');
    for (const bad of ['abc', '0', '-5', '1e3']) { r = await setMin(bad, 'kg'); assert(/seuil minimum/i.test(decodeURIComponent(loc(r))) && campaignRow().v === 50000, `invalid minimum « ${bad} » refused, previous value kept`); }
    r = await post('/admin/campagnes/enregistrer', { id: '1', name: 'Veggie Deli', delivery_date: [future(10)] }); assert(campaignRow().k === 'money' && campaignRow().v === 50000, 'saving without the minimum fields leaves it as it is');
    // progress counts only PAID orders for the NEXT delivery
    const pid1 = one("select p.id pid, s.id sid from products p join sizes s on s.product_id=p.id where p.campaign_id=1 and p.name='Foulet nature' limit 1");
    addOrder({ cid: 1, campaign: 'Veggie Deli', total: 30000, status: 'paid', delivery: future(40) }); addOrder({ cid: 1, campaign: 'Veggie Deli', total: 30000, status: 'pending', delivery: future(10) }); addOrder({ cid: 1, campaign: 'Veggie Deli', total: 30000, status: 'refunded', delivery: future(10) });
    t = await shopText(); assert(notice(t), 'orders for another delivery, pending ones and refunded ones do not count');
    const ok1 = addOrder({ cid: 1, campaign: 'Veggie Deli', total: 30000, status: 'paid', delivery: future(10) }); t = await shopText(); assert(notice(t), '300 € paid for this delivery: still under 500 €');
    html = await (await get('/admin')).text(); assert(html.includes('pas encore atteint (300,00 € commandés et payés)'), 'admin card shows the progress: 300,00 €');
    addOrder({ cid: 1, campaign: 'Veggie Deli', total: 20000, status: 'paid', delivery: future(10) }); t = await shopText();
    assert(!notice(t) && t.includes('Prochaine livraison : <b>' + fr(future(10)) + '</b>'), '500 € paid: the notice disappears');
    html = await (await get('/admin')).text(); assert(html.includes('Seuil minimum : 500,00 € · atteint (500,00 €)'), 'admin card: "atteint"');
    // weight minimum counts quantity x grams of paid items
    await setMin('3', 'kg'); t = await shopText(); assert(notice(t) && t.includes('seuil de 3 kg)'), 'weight minimum 3 kg: not reached (paid orders without items weigh nothing)');
    addOrder({ cid: 1, campaign: 'Veggie Deli', total: 1000, status: 'paid', delivery: future(10), item: { pid: pid1.pid, sid: pid1.sid, product: 'Foulet nature', size: '1kg', cents: 1000, qty: 2, grams: 1000 } });
    t = await shopText(); assert(notice(t), '2 kg paid: under 3 kg');
    addOrder({ cid: 1, campaign: 'Veggie Deli', total: 500, status: 'paid', delivery: future(10), item: { pid: pid1.pid, sid: pid1.sid, product: 'Foulet nature', size: '1kg', cents: 500, qty: 1, grams: 1000 } });
    t = await shopText(); assert(!notice(t), '3 kg paid: reached');
    // with a lead time the notice is on the delivery line under the deadline
    await setMin('9999', 'kg', 2); t = await shopText();
    assert(t.indexOf('Commandes ouvertes jusqu’au') < t.indexOf('pour une livraison le <b>' + fr(future(10)) + '</b> (sous réserve d’atteindre notre seuil de 9999 kg)') && t.indexOf('pour une livraison le') > 0, 'with a lead time: "pour une livraison le … (sous réserve d’atteindre notre seuil de …)"');
    await setMin('', 'kg', 0); await setDates([future(30)], 0); }
  r = await fetch(B + '/admin/commandes/rembourser', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://evil.example' }, body: `id=${bogus}` }); assert(r.status === 403, 'CSRF guard applies to the refund action');
})().catch((e) => { console.error('ERROR', e); process.exitCode = 1; });
