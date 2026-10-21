// Admin login: one password, no user name. A correct password sets a signed cookie (7 days); the signing key comes from the
// password, so changing ADMIN_PASSWORD signs everybody out. Without ADMIN_PASSWORD the admin is open (local use only).
const crypto = require('node:crypto');
const { ADMIN_PASSWORD, BASE_URL } = require('./config');
const { BASE_PATH } = require('./basepath');
const { send, redirect, readForm } = require('./http');
const v = require('./views');

const SESSION_DAYS = 7;
const COOKIE = 'admin_session';
const sessionKey = crypto.createHash('sha256').update('elefan-admin-session:' + ADMIN_PASSWORD).digest();
const sign = (text) => crypto.createHmac('sha256', sessionKey).update(text).digest('base64url');
const sha = (x) => crypto.createHash('sha256').update(String(x)).digest();
const samePassword = (given) => crypto.timingSafeEqual(sha(given), sha(ADMIN_PASSWORD));

function isAdmin(req) {
  if (!ADMIN_PASSWORD) return true;
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([\\w-]+)\\.([\\w-]+)`).exec(req.headers.cookie || '');
  if (!m || !(Number(m[1]) > Date.now())) return false;     // m[1] = expiry, m[2] = signature of the expiry
  const a = Buffer.from(sign(m[1])), b = Buffer.from(m[2]);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const sessionCookie = () => {
  const exp = String(Date.now() + SESSION_DAYS * 864e5);
  return `${COOKIE}=${exp}.${sign(exp)}; Path=${BASE_PATH || '/'}; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${BASE_URL.startsWith('https:') ? '; Secure' : ''}`;
};

// Guess limiter: at most 10 wrong passwords per minute for the whole site, and each wrong one costs a second.
let misses = [];
const tooManyMisses = () => { misses = misses.filter((t) => Date.now() - t < 60000); return misses.length >= 10; };

// GET (the form) and POST (the password) on /admin/connexion
async function loginRoute(req, res) {
  if (req.method === 'GET') return isAdmin(req) ? redirect(res, '/admin') : send(res, 200, v.loginPage());
  const given = (await readForm(req)).get('password') || '';
  if (tooManyMisses()) return send(res, 429, v.loginPage('Trop d’essais : patientez une minute.'));
  if (samePassword(given)) return redirect(res, '/admin', { 'Set-Cookie': sessionCookie() });
  misses.push(Date.now());
  await new Promise((r) => setTimeout(r, 1000));
  return send(res, 401, v.loginPage('Mot de passe incorrect.'));
}

module.exports = { isAdmin, loginRoute };
