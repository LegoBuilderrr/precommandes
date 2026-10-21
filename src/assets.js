// Static files: the stylesheet, scripts and fonts of public/, product pictures (public/img) and uploaded pictures.
const fs = require('node:fs');
const path = require('node:path');
const { PUBLIC_DIR, UPLOAD_DIR } = require('./config');
const { send } = require('./http');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ASSETS = {   // url -> [file in public/, content type]
  '/assets/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/assets/order.js': ['order.js', 'text/javascript; charset=utf-8'],
  '/assets/admin-products.js': ['admin-products.js', 'text/javascript; charset=utf-8'],
  '/assets/admin-campaigns.js': ['admin-campaigns.js', 'text/javascript; charset=utf-8'],
  '/assets/favicon.png': ['favicon.png', 'image/png'],
  '/fonts/raleway-400.woff2': ['fonts/raleway-400.woff2', 'font/woff2'],
  '/fonts/raleway-600.woff2': ['fonts/raleway-600.woff2', 'font/woff2'],
  '/fonts/blackjack.woff': ['fonts/blackjack.woff', 'font/woff'],
};
const IMG_FILE = /^\/(img|uploads)\/([\w.-]+\.(jpg|png|gif|webp))$/;
const IMG_TYPES = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

// Answers a GET for a static file and returns true, or returns false when the path is not one.
function serveStatic(req, res, pathname) {
  if (req.method !== 'GET') return false;
  if (ASSETS[pathname]) {
    const [file, type] = ASSETS[pathname];
    send(res, 200, fs.readFileSync(path.join(PUBLIC_DIR, file)), type, { 'Cache-Control': 'no-cache' });
    return true;
  }
  const img = IMG_FILE.exec(pathname);
  if (!img) return false;
  const file = path.join(img[1] === 'img' ? path.join(PUBLIC_DIR, 'img') : UPLOAD_DIR, img[2]);
  if (!fs.existsSync(file)) { send(res, 404, 'Not found', 'text/plain'); return true; }
  const st = fs.statSync(file), etag = `W/"${st.size}-${Math.round(st.mtimeMs)}"`;   // changes whenever the file changes
  const headers = { 'Cache-Control': 'no-cache', ETag: etag, 'X-Content-Type-Options': 'nosniff' };
  if (req.headers['if-none-match'] === etag) send(res, 304, '', IMG_TYPES[img[3]], headers);
  else send(res, 200, fs.readFileSync(file), IMG_TYPES[img[3]], headers);
  return true;
}

module.exports = { serveStatic };
