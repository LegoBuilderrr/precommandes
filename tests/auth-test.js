const B = 'http://127.0.0.1:8449/precommandes';
const assert = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const get = (p, h = {}) => fetch(B + p, { redirect: 'manual', headers: h });
const post = (p, body, h = {}) => fetch(B + p, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...h }, body: new URLSearchParams(body) });
(async () => {
  let r = await get('/admin'); assert(r.status === 303 && r.headers.get('location') === '/precommandes/admin/connexion', 'not signed in: /admin goes to the login page: ' + r.headers.get('location'));
  for (const p of ['/admin/commandes', '/admin/produits', '/admin/commandes.csv', '/admin/totaux.csv']) { r = await get(p); assert(r.status === 303, p + ' is protected'); }
  r = await get('/admin/connexion'); let html = await r.text();
  assert(r.status === 200 && html.includes('type="password"') && !/name="(user|username|login)"/.test(html) && html.includes('action="/precommandes/admin/connexion"'), 'login page: a password field and no user name');
  assert(r.headers.get('www-authenticate') === null, 'no browser Basic-auth popup');
  r = await post('/admin/commandes/rembourser', { id: '1' }); assert(r.status === 401, 'POST without session refused');
  r = await fetch(B + '/admin/api/catalogue?c=1', { method: 'POST', body: '[]' }); assert(r.status === 401, 'catalogue API refused without session');
  r = await fetch('http://127.0.0.1:8449/precommandes/admin', { headers: { Authorization: 'Basic ' + Buffer.from('admin:admin').toString('base64') }, redirect: 'manual' }); assert(r.status === 303, 'Basic auth no longer opens the admin');
  const t0 = Date.now(); r = await post('/admin/connexion', { password: 'nope' }); html = await r.text();
  assert(r.status === 401 && /Mot de passe incorrect/.test(html) && !r.headers.get('set-cookie') && Date.now() - t0 >= 900, 'wrong password: message, no cookie, ~1 s delay');
  r = await post('/admin/connexion', { password: 'admin' }, { Origin: 'https://evil.example' }); assert(r.status === 403, 'cross-site login POST refused (CSRF guard)');
  r = await post('/admin/connexion', { password: 'admin' }); const ck = r.headers.get('set-cookie') || '';
  assert(r.status === 303 && r.headers.get('location') === '/precommandes/admin' && /^admin_session=\d+\.[\w-]+;/.test(ck) && /HttpOnly/.test(ck) && /SameSite=Lax/.test(ck) && /Path=\/precommandes/.test(ck), 'right password ("admin"): cookie set (HttpOnly, SameSite, Path=/precommandes): ' + ck.replace(/=\d+\.[\w-]+/, '=…'));
  const cookie = ck.split(';')[0];
  r = await get('/admin', { Cookie: cookie }); html = await r.text(); assert(r.status === 200 && html.includes('Nouvelle campagne'), 'with the cookie the admin opens');
  r = await get('/admin/commandes.csv', { Cookie: cookie }); assert(r.status === 200, 'CSV download works with the cookie');
  r = await get('/admin/connexion', { Cookie: cookie }); assert(r.status === 303 && r.headers.get('location') === '/precommandes/admin', 'login page sends a signed-in user to the admin');
  const [exp] = cookie.split('=')[1].split('.');
  r = await get('/admin', { Cookie: `admin_session=${exp}.AAAA` }); assert(r.status === 303, 'forged signature refused');
  r = await get('/admin', { Cookie: `admin_session=${Date.now() + 1e9}.${cookie.split('.')[1]}` }); assert(r.status === 303, 'edited expiry refused');
  r = await get('/admin', { Cookie: `admin_session=${Date.now() - 1000}.${cookie.split('.')[1]}` }); assert(r.status === 303, 'expired cookie refused');
  r = await get('/boutique/veggie-deli'); assert(r.status === 200 || r.status === 404, 'public shop needs no login (' + r.status + ')');
  // guess limiter: 10 wrong per minute, then 429 even for the right password
  for (let i = 0; i < 9; i++) await post('/admin/connexion', { password: 'x' + i });
  r = await post('/admin/connexion', { password: 'admin' }); assert(r.status === 429, 'after 10 wrong guesses a minute, logins are blocked: ' + r.status);
})().catch((e) => { console.error('ERROR', e); process.exitCode = 1; });
