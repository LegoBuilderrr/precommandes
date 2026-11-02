// The accounts allowed into /admin: a small file made by scripts/export-users.js from the members database
// ({ generated_at, users: [{ login, email, hash, role }] }, bcrypt hashes of the members' own passwords).
// role = 'admin' (everything) or 'precommandes' (orders only). The file is read again whenever it changes, so a new export
// (also one that removes somebody) applies without restarting the server.
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('./vendor/bcryptjs');
const { DB_FILE } = require('./config');

const USERS_FILE = process.env.USERS_FILE || path.join(path.dirname(DB_FILE), 'users.json');
const ROLES = ['admin', 'precommandes'];

let cache = { mtime: -1, users: [] };
function all() {
  let mtime;
  try { mtime = fs.statSync(USERS_FILE).mtimeMs; } catch { cache = { mtime: -1, users: [] }; return cache.users; }
  if (mtime !== cache.mtime) {
    let users = [];
    try { users = (JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')).users || []).filter((u) => u && u.login && /^\$2[abxy]\$/.test(u.hash || '') && ROLES.includes(u.role)); }
    catch (e) { console.error('users file unreadable:', e.message); }
    cache = { mtime, users };
  }
  return cache.users;
}

const exists = () => all().length > 0;
const norm = (s) => String(s ?? '').trim().toLowerCase();
const byLogin = (login) => all().find((u) => norm(u.login) === norm(login)) || null;
// like the members site (FOSUserBundle "username_email" provider): an entry with an @ is an e-mail, anything else a user name; case ignored
const find = (who) => {
  const k = norm(who); if (!k) return null;
  return all().find((u) => (k.includes('@') ? u.email && norm(u.email) === k : norm(u.login) === k)) || null;
};

// A hash that matches nothing: unknown accounts cost the same time as wrong passwords.
let dummy = null;
async function check(who, password) {
  const u = find(who);
  if (!u && !dummy) dummy = bcrypt.hashSync('no such account', 10);
  const ok = await bcrypt.compare(String(password ?? ''), u ? u.hash : dummy);
  return u && ok ? u : null;
}

module.exports = { USERS_FILE, exists, byLogin, check };
