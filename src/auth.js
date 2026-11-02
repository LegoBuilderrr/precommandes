// Admin login. Accounts come from the members database (src/users.js: login or e-mail + the member's own password); the shared
// ADMIN_PASSWORD, if set, also works with the login "admin". A correct login sets a signed cookie (7 days) holding only the
// login: the role is looked up again at every request, so changing or removing an account in a new export takes effect at once.
// Without any account and without ADMIN_PASSWORD the admin is open (local use only).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ADMIN_PASSWORD, BASE_URL, DB_FILE } = require('./config');
const { BASE_PATH } = require('./basepath');
const { send, redirect, readForm } = require('./http');
const users = require('./users');
const v = require('./views');

const SESSION_DAYS = 7;
const COOKIE = 'admin_session';
const SHARED_LOGIN = 'admin';

// signing key: kept next to the database so that sessions survive a restart (and cannot be forged from the password alone)
const secret = (() => {
  const file = process.env.SESSION_KEY_FILE || path.join(path.dirname(DB_FILE), 'session.key');
  try { return fs.readFileSync(file, 'utf8').trim() || (() => { throw new Error('empty'); })(); } catch { /* make one */ }
  const k = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(file, k, { mode: 0o600 }); } catch { /* read-only folder: sessions then end at restart */ }
  return k;
})();
const sessionKey = crypto.createHash('sha256').update('elefan-admin-session:' + secret + ':' + ADMIN_PASSWORD).digest();
const sign = (text) => crypto.createHmac('sha256', sessionKey).update(text).digest('base64url');
const sha = (x) => crypto.createHash('sha256').update(String(x)).digest();
const samePassword = (given) => crypto.timingSafeEqual(sha(given), sha(ADMIN_PASSWORD));

const authRequired = () => !!ADMIN_PASSWORD || users.exists();

// Who is signed in: { login, role } or null. Open admin (no accounts, no password): everybody is an admin.
function session(req) {
  if (!authRequired()) return { login: '', role: 'admin' };
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.([\\w-]+)\\.([\\w-]+)`).exec(req.headers.cookie || '');
  if (!m || !(Number(m[1]) > Date.now())) return null;      // m[1] = expiry, m[2] = login (base64url), m[3] = signature
  const a = Buffer.from(sign(m[1] + '.' + m[2])), b = Buffer.from(m[3]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const login = Buffer.from(m[2], 'base64url').toString('utf8');
  if (login === SHARED_LOGIN && ADMIN_PASSWORD) return { login, role: 'admin' };
  const u = users.byLogin(login);
  return u ? { login: u.login, role: u.role } : null;
}
const isAdmin = (req) => !!session(req);

const secure = BASE_URL.startsWith('https:') ? '; Secure' : '';
const sessionCookie = (login) => {
  const exp = String(Date.now() + SESSION_DAYS * 864e5), who = Buffer.from(login).toString('base64url');
  return `${COOKIE}=${exp}.${who}.${sign(exp + '.' + who)}; Path=${BASE_PATH || '/'}; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${secure}`;
};
const endedCookie = () => `${COOKIE}=; Path=${BASE_PATH || '/'}; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;

// Guess limiter: at most 10 wrong passwords per minute for the whole site, and each wrong one costs a second.
let misses = [];
const tooManyMisses = () => { misses = misses.filter((t) => Date.now() - t < 60000); return misses.length >= 10; };

// GET (the form) and POST (login + password) on /admin/connexion
async function loginRoute(req, res) {
  if (req.method === 'GET') return session(req) ? redirect(res, '/admin') : send(res, 200, v.loginPage());
  const f = await readForm(req), who = (f.get('login') || '').trim(), given = f.get('password') || '';
  if (tooManyMisses()) return send(res, 429, v.loginPage('Trop d’essais : patientez une minute.'));
  if (ADMIN_PASSWORD && who.toLowerCase() === SHARED_LOGIN && samePassword(given)) return redirect(res, '/admin', { 'Set-Cookie': sessionCookie(SHARED_LOGIN) });
  const u = await users.check(who, given);
  if (u) return redirect(res, '/admin', { 'Set-Cookie': sessionCookie(u.login) });
  misses.push(Date.now());
  await new Promise((r) => setTimeout(r, 1000));
  return send(res, 401, v.loginPage('Identifiant ou mot de passe incorrect.'));
}

// POST /admin/deconnexion
const logoutRoute = (req, res) => redirect(res, '/admin/connexion', { 'Set-Cookie': endedCookie() });

module.exports = { isAdmin, session, authRequired, loginRoute, logoutRoute };
