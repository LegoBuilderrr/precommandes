// The app can live under a path prefix (BASE_URL=https://codexprod.fr/precommandes). Pages are written with root-relative
// links ("/assets/style.css", "/boutique/x"); on the way out they get the prefix, on the way in it is removed again.
const BASE_PATH = (() => { try { return new URL(require('./config').BASE_URL).pathname.replace(/\/+$/, ''); } catch { return ''; } })();

// Only our own top-level routes are rewritten, so "/" or "/n" inside scripts and texts are left alone.
const ROOTS = '(?:assets|img|uploads|fonts|boutique|admin|commander|retour)';
const OWN = new RegExp(`(["'(])/(?=${ROOTS}(?:[/?"')&\\s]|$))`, 'g');
const TEXT_TYPE = /^(text\/(html|css|javascript)|application\/json)/;

// Text answers (HTML, CSS, JS, JSON): "/img/x.jpg" -> "/precommandes/img/x.jpg"; in HTML also the home link href="/".
function prefixBody(body, type) {
  if (!BASE_PATH || !TEXT_TYPE.test(type || '')) return body;
  let s = String(body).replace(OWN, `$1${BASE_PATH}/`);
  if (type.startsWith('text/html')) s = s.replace(/href="\/"/g, `href="${BASE_PATH}/"`);
  return s;
}
const prefixLocation = (loc) => (BASE_PATH && typeof loc === 'string' && loc.startsWith('/') ? BASE_PATH + loc : loc);
// "/precommandes/img/a.jpg" -> "/img/a.jpg" (values coming back from the browser, e.g. a picture chosen in the editor)
const unprefix = (p) => (BASE_PATH && typeof p === 'string' && p.startsWith(BASE_PATH + '/') ? p.slice(BASE_PATH.length) : p);

module.exports = { BASE_PATH, prefixBody, prefixLocation, unprefix };
