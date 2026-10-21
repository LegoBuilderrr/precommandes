// L'ELEFAN pre-orders: own catalogue + orders in SQLite, HelloAsso (sandbox) only for the payment.
//   npm start  ->  https://localhost:8443  (self-signed certificate: HelloAsso requires https return URLs)
//   /                 the campaigns (a single one: straight to it)    /boutique/<slug>  the shop of one campaign
//   /admin            campaigns: create and manage (main admin page; see admin.js for the other admin pages)
// /admin asks for a password (no user name) when ADMIN_PASSWORD is set, otherwise it is open: only use that locally.
const https = require('node:https');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const config = require('./config');
const { BASE_URL, PORT, HOST, PLAIN_HTTP, ADMIN_PASSWORD, ROOT } = config;
const { BASE_PATH } = require('./basepath');
const { send, redirect } = require('./http');
const { serveStatic } = require('./assets');
const { isAdmin, loginRoute } = require('./auth');
const { admin } = require('./admin');
const shop = require('./shop');
const v = require('./views');

// TLS: reuse a cert.pem/key.pem if present in the project folder, else make a self-signed one.
function tlsFiles() {
  const c = path.join(ROOT, 'cert.pem'), k = path.join(ROOT, 'key.pem');
  if (fs.existsSync(c) && fs.existsSync(k)) return { cert: fs.readFileSync(c), key: fs.readFileSync(k) };
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', k, '-out', c], { stdio: 'ignore' });
  return { cert: fs.readFileSync(c), key: fs.readFileSync(k) };
}

async function handle(req, res) {
  const url = new URL(req.url, BASE_URL);
  if (BASE_PATH && (url.pathname === BASE_PATH || url.pathname.startsWith(BASE_PATH + '/'))) url.pathname = url.pathname.slice(BASE_PATH.length) || '/';   // proxies may pass the prefix along
  const { pathname } = url, get = req.method === 'GET';
  if (serveStatic(req, res, pathname)) return;

  if (pathname.startsWith('/admin')) {
    // CSRF guard: browsers send Origin on cross-site POSTs
    if (req.method === 'POST' && req.headers.origin && req.headers.origin !== new URL(BASE_URL).origin) return send(res, 403, 'Forbidden', 'text/plain');
    if (pathname === '/admin/connexion' && ADMIN_PASSWORD && (get || req.method === 'POST')) return loginRoute(req, res);
    if (!isAdmin(req)) return get ? redirect(res, '/admin/connexion') : send(res, 401, 'Connexion requise', 'text/plain; charset=utf-8');
    return admin(req, res, url);
  }
  if (get && pathname === '/') return shop.home(res);
  const camp = get && /^\/boutique\/([a-z0-9-]+)$/.exec(pathname);
  if (camp) return shop.shopPage(res, camp[1]);
  if (req.method === 'POST' && pathname === '/commander') return shop.submitOrder(req, res);
  if (get && pathname === '/retour') return shop.returnPage(url, res);
  send(res, 404, v.layout('404', '<p>Page introuvable.</p>'));
}

const onRequest = (req, res) =>
  handle(req, res).catch((e) => { console.error(e); if (!res.headersSent) send(res, 500, 'Erreur interne', 'text/plain; charset=utf-8'); else res.end(); });
const server = PLAIN_HTTP ? http.createServer(onRequest) : https.createServer(tlsFiles(), onRequest);
server.listen(PORT, HOST, () => {
  console.log(`Serving ${BASE_URL}${PLAIN_HTTP ? `  (plain http on ${HOST}:${PORT}, TLS handled by the proxy)` : '  (accept the self-signed certificate warning once)'}`);
  console.log(`Admin: ${BASE_URL}/admin   ${ADMIN_PASSWORD ? '(password: $ADMIN_PASSWORD)' : '(no password)'}`);
});
