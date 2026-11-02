const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('../src/vendor/bcryptjs');
const B = 'http://127.0.0.1:8449/precommandes', USERS = '/tmp/t9-users.json', DBF = '/tmp/t9.db';
const assert = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const get = (p, h = {}) => fetch(B + p, { redirect: 'manual', headers: h });
const post = (p, body, h = {}) => fetch(B + p, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...h }, body: new URLSearchParams(body) });
// like the PHP side: bcrypt with the $2y$ prefix
const phpHash = (pw) => bcrypt.hashSync(pw, 4).replace(/^\$2[ab]\$/, '$2y$');
const writeUsers = (users) => { fs.writeFileSync(USERS, JSON.stringify({ generated_at: new Date().toISOString(), users })); fs.utimesSync(USERS, new Date(), new Date(Date.now() + Math.random() * 1e5)); };
const ADMIN = { login: 'cdeligeon', email: 'Claire.D@example.org', hash: phpHash('mdp-admin'), role: 'admin' };
const PRE = { login: 'sophie', email: 'sophie@example.org', hash: phpHash('mdp-precom'), role: 'precommandes' };
const loginAs = async (who, password) => { const r = await post('/admin/connexion', { login: who, password }); return { r, cookie: (r.headers.get('set-cookie') || '').split(';')[0] }; };
(async () => {
  writeUsers([ADMIN, PRE, { login: 'ghost', email: '', hash: 'not-a-hash', role: 'admin' }, { login: 'odd', email: '', hash: phpHash('x'), role: 'root' }]);
  let r = await get('/admin'); assert(r.status === 303 && r.headers.get('location') === '/precommandes/admin/connexion', 'not signed in: /admin goes to the login page: ' + r.headers.get('location'));
  for (const p of ['/admin/commandes', '/admin/produits', '/admin/commandes.csv', '/admin/totaux.csv']) { r = await get(p); assert(r.status === 303, p + ' is protected'); }
  r = await get('/admin/connexion'); let html = await r.text();
  assert(r.status === 200 && html.includes('type="password"') && html.includes('name="login"') && html.includes('action="/precommandes/admin/connexion"'), 'login page: login and password fields, posting to the prefixed address');
  assert(r.headers.get('www-authenticate') === null, 'no browser Basic-auth popup');
  r = await post('/admin/commandes/rembourser', { id: '1' }); assert(r.status === 401, 'POST without session refused');
  r = await fetch(B + '/admin/api/catalogue?c=1', { method: 'POST', body: '[]' }); assert(r.status === 401, 'catalogue API refused without session');
  r = await fetch('http://127.0.0.1:8449/precommandes/admin', { headers: { Authorization: 'Basic ' + Buffer.from('admin:admin').toString('base64') }, redirect: 'manual' }); assert(r.status === 303, 'Basic auth no longer opens the admin');
  // wrong credentials: same answer for a wrong password and for an unknown account, with a delay
  let t0 = Date.now(); r = await post('/admin/connexion', { login: 'cdeligeon', password: 'nope' }); html = await r.text();
  assert(r.status === 401 && /Identifiant ou mot de passe incorrect/.test(html) && !r.headers.get('set-cookie') && Date.now() - t0 >= 900, 'wrong password: message, no cookie, ~1 s delay');
  r = await post('/admin/connexion', { login: 'inconnu', password: 'mdp-admin' }); assert(r.status === 401 && !r.headers.get('set-cookie'), 'unknown account: refused');
  r = await post('/admin/connexion', { login: 'ghost', password: 'x' }); assert(r.status === 401, 'an entry without a bcrypt hash is ignored');
  r = await post('/admin/connexion', { login: 'odd', password: 'x' }); assert(r.status === 401, 'an entry with an unknown role is ignored');
  r = await post('/admin/connexion', { login: 'cdeligeon', password: 'mdp-admin' }, { Origin: 'https://evil.example' }); assert(r.status === 403, 'cross-site login POST refused (CSRF guard)');
  // an administrator
  let a = await loginAs('cdeligeon', 'mdp-admin'); const ck = a.r.headers.get('set-cookie') || '';
  assert(a.r.status === 303 && a.r.headers.get('location') === '/precommandes/admin' && /^admin_session=\d+\.[\w-]+\.[\w-]+;/.test(ck) && /HttpOnly/.test(ck) && /SameSite=Lax/.test(ck) && /Path=\/precommandes/.test(ck), 'administrator logs in with the member password ($2y$ hash): signed cookie: ' + ck.slice(0, 40));
  assert(!ck.includes('mdp-admin') && !ck.includes('$2y$'), 'the cookie holds neither password nor hash');
  r = await get('/admin', { Cookie: a.cookie }); html = await r.text();
  assert(r.status === 200 && html.includes('Nouvelle campagne') && html.includes('Modifier la campagne') && html.includes('/admin/produits?c=') && html.includes('cdeligeon') && html.includes('Déconnexion'), 'administrator sees everything, and who is signed in');
  r = await get('/admin/produits?c=1', { Cookie: a.cookie }); assert(r.status === 200, 'administrator opens the product editor');
  r = await get('/admin/commandes.csv', { Cookie: a.cookie }); assert(r.status === 200, 'CSV download works with the cookie');
  r = await get('/admin/connexion', { Cookie: a.cookie }); assert(r.status === 303 && r.headers.get('location') === '/precommandes/admin', 'login page sends a signed-in user to the admin');
  const d = new DatabaseSync(DBF), cid = d.prepare('select id from campaigns limit 1').get().id;
  const paid = Number(d.prepare("insert into orders (campaign_id,campaign,first_name,last_name,member_no,email,total_cents,status,demo,paid_at) values (?,'Veggie Deli','Pat','Test','1','p@x.fr',1000,'paid',1,datetime('now'))").run(cid).lastInsertRowid);
  d.prepare("insert into order_items (order_id,product,variant,size,unit_cents,qty,grams) values (?,'Faux-cisses','aux herbes','160gr',500,2,160)").run(paid);
  r = await get(`/admin/commandes?c=${cid}&mode=clients`, { Cookie: a.cookie }); html = await r.text(); assert(html.includes('class="refund"') && html.includes('class="stepsel"'), 'administrator sees the refund button and the step menu');
  // login by e-mail, whatever the case
  const em = await loginAs('CLAIRE.d@example.org', 'mdp-admin'); assert(em.r.status === 303 && /^admin_session=/.test(em.cookie), 'login also works with the e-mail address, any case');
  // a Précommandes member: orders only
  const p = await loginAs('sophie', 'mdp-precom'); assert(p.r.status === 303 && /^admin_session=/.test(p.cookie), 'Précommandes member logs in');
  r = await get('/admin', { Cookie: p.cookie }); html = await r.text();
  assert(r.status === 200 && html.includes('Veggie Deli') && html.includes('/admin/commandes?c=') && !html.includes('Nouvelle campagne') && !html.includes('Modifier la campagne') && !html.includes('/admin/produits?c=') && !html.includes('Supprimer la campagne') && !html.includes('name="header_html"'), 'Précommandes member: campaigns listed, no editing, no new campaign, no product editor link');
  r = await get('/admin/produits?c=1', { Cookie: p.cookie }); assert(r.status === 403, 'Précommandes member: product editor refused');
  r = await post('/admin/campagnes/creer', { name: 'Intrus' }, { Cookie: p.cookie }); assert(r.status === 403 && !d.prepare("select 1 from campaigns where name='Intrus'").get(), 'Précommandes member: cannot create a campaign');
  r = await post('/admin/campagnes/enregistrer', { id: String(cid), name: 'Piraté' }, { Cookie: p.cookie }); assert(r.status === 403 && d.prepare('select name from campaigns where id=?').get(cid).name !== 'Piraté', 'Précommandes member: cannot edit a campaign');
  r = await post('/admin/campagnes/supprimer', { id: String(cid) }, { Cookie: p.cookie }); assert(r.status === 403, 'Précommandes member: cannot delete a campaign');
  r = await fetch(B + `/admin/api/catalogue?c=${cid}`, { method: 'POST', headers: { Cookie: p.cookie }, body: '[]' }); assert(r.status === 403, 'Précommandes member: cannot save products');
  r = await fetch(B + '/admin/api/televerser', { method: 'POST', headers: { Cookie: p.cookie, 'Content-Type': 'image/png' }, body: 'x' }); assert(r.status === 403, 'Précommandes member: cannot upload pictures');
  r = await post('/admin/commandes/rembourser', { id: String(paid) }, { Cookie: p.cookie }); assert(r.status === 403 && d.prepare('select status from orders where id=?').get(paid).status === 'paid', 'Précommandes member: cannot refund (the order stays paid)');
  r = await get(`/admin/commandes?c=${cid}&mode=clients`, { Cookie: p.cookie }); html = await r.text();
  assert(r.status === 200 && html.includes('class="stepsel"') && !html.includes('class="refund"') && !html.includes('Rembourser'), 'Précommandes member: orders page with the step menu but without the refund button');
  r = await get(`/admin/commandes?c=${cid}&mode=produits`, { Cookie: p.cookie }); assert(r.status === 200, 'Précommandes member: sales per product visible');
  r = await post('/admin/commandes/etape', { id: String(paid), step: 'prepared' }, { Cookie: p.cookie }); assert(r.status === 200 && d.prepare('select step from orders where id=?').get(paid).step === 'prepared', 'Précommandes member: can follow an order (Préparée)');
  r = await get('/admin/commandes.csv', { Cookie: p.cookie }); assert(r.status === 200, 'Précommandes member: CSV allowed');
  // the file is read again when it changes: a new role or a removed account applies at once
  writeUsers([ADMIN, { ...PRE, role: 'admin' }]); r = await get('/admin/produits?c=1', { Cookie: p.cookie }); assert(r.status === 200, 'promoted in a new export: gets the editor without logging in again');
  writeUsers([ADMIN]); r = await get('/admin', { Cookie: p.cookie }); assert(r.status === 303, 'removed in a new export: the old session stops working');
  writeUsers([ADMIN, PRE]);
  // signature checks
  const [exp, who] = a.cookie.split('=')[1].split('.');
  r = await get('/admin', { Cookie: `admin_session=${exp}.${who}.AAAA` }); assert(r.status === 303, 'forged signature refused');
  r = await get('/admin', { Cookie: `admin_session=${exp}.${Buffer.from('sophie').toString('base64url')}.${a.cookie.split('.')[2]}` }); assert(r.status === 303, 'another login with the same signature refused');
  r = await get('/admin', { Cookie: `admin_session=${Date.now() + 1e9}.${who}.${a.cookie.split('.')[2]}` }); assert(r.status === 303, 'edited expiry refused');
  r = await get('/admin', { Cookie: `admin_session=${Date.now() - 1000}.${who}.${a.cookie.split('.')[2]}` }); assert(r.status === 303, 'expired cookie refused');
  // logging out
  r = await post('/admin/deconnexion', {}, { Cookie: a.cookie }); assert(r.status === 303 && /Max-Age=0/.test(r.headers.get('set-cookie') || '') && r.headers.get('location') === '/precommandes/admin/connexion', 'logout clears the cookie and goes back to the login page');
  // the shared password still works, with the login "admin"
  r = await post('/admin/connexion', { login: '', password: 'admin' }); assert(r.status === 401, 'the shared password alone (no login) is refused');
  const sh = await loginAs('admin', 'admin'); assert(sh.r.status === 303 && /^admin_session=/.test(sh.cookie), 'the shared password works with the login "admin"');
  r = await get('/admin/produits?c=1', { Cookie: sh.cookie }); assert(r.status === 200, 'the shared password gives the administrator role');
  r = await get('/boutique/veggie-deli'); assert(r.status === 200 || r.status === 404, 'public shop needs no login (' + r.status + ')');
  // guess limiter: 10 wrong per minute, then 429 even for the right password
  for (let i = 0; i < 10; i++) await post('/admin/connexion', { login: 'cdeligeon', password: 'x' + i });
  r = await post('/admin/connexion', { login: 'cdeligeon', password: 'mdp-admin' }); assert(r.status === 429, 'after 10 wrong guesses a minute, logins are blocked: ' + r.status);
})().catch((e) => { console.error('ERROR', e); process.exitCode = 1; });
