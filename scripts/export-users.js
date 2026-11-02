#!/usr/bin/env node
// Builds users.json, the accounts allowed into /admin, from the members database through the Metabase API.
// Run it again whenever members, trainings or passwords change, then copy the file next to the database on the server
// (the app notices the new file by itself).
//
//   node scripts/export-users.js [--out users.json] [--key-file ../metabase/api.txt]
//
// Metabase address and API key: METABASE_URL + METABASE_API_KEY, or a two-line file (address, key; default ../metabase/api.txt).
// Who gets in:
//   role "admin"        members trained "Informatique", plus the non-member accounts listed in EXTRA_ADMINS
//   role "precommandes" members trained "Précommandes" (orders only; an account with both trainings is an admin)
// Only enabled accounts with a bcrypt password are kept, and members who left (withdrawn) are skipped.
// The output holds password hashes: never commit it (it is in .gitignore) and keep it private (mode 600).
const fs = require('node:fs');
const path = require('node:path');

const ADMIN_TRAINING = 'Informatique', PRECOMMANDES_TRAINING = 'Précommandes';
const EXTRA_ADMINS = ['mahaut', 'emma'];                  // not members, but administrators of the members site
const DB_NAME = 'Espace Membres';

const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : dflt; };
const out = path.resolve(arg('out', 'users.json'));

function credentials() {
  if (process.env.METABASE_URL && process.env.METABASE_API_KEY) return { url: process.env.METABASE_URL, key: process.env.METABASE_API_KEY };
  const file = path.resolve(arg('key-file', path.join(__dirname, '..', '..', 'metabase', 'api.txt')));
  const [host, key] = fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!host || !key) throw new Error(`${file} should hold the Metabase address on line 1 and the API key on line 2`);
  return { url: host, key };
}

async function main() {
  const { url, key } = credentials();
  const base = (/^https?:/.test(url) ? url : 'https://' + url).replace(/\/+$/, '');
  const call = async (p, body) => {
    const r = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'x-api-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body && JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`Metabase answered ${r.status} on ${p}`);
    return r.json();
  };
  const dbs = await call('/api/database'), db = (dbs.data || dbs).find((d) => d.name === DB_NAME);
  if (!db) throw new Error(`Metabase database "${DB_NAME}" not found`);
  const sql = async (query) => {
    const r = await call('/api/dataset', { database: db.id, type: 'native', native: { query } });
    if (r.error || !r.data) throw new Error('Metabase query failed: ' + String(r.error || 'no data').slice(0, 200));
    const names = r.data.cols.map((c) => c.name);
    return r.data.rows.map((row) => Object.fromEntries(row.map((v, i) => [names[i], v])));
  };
  const q = (s) => `'${s.replace(/'/g, "''")}'`;

  const members = await sql(`SELECT u.id, u.username, u.email, u.password, f.name AS training
    FROM beneficiaries_formations bf JOIN formation f ON f.id = bf.formation_id
    JOIN beneficiary b ON b.id = bf.beneficiary_id JOIN fos_user u ON u.id = b.user_id JOIN membership m ON m.id = b.membership_id
    WHERE f.name IN (${q(ADMIN_TRAINING)}, ${q(PRECOMMANDES_TRAINING)}) AND u.enabled = 1 AND m.withdrawn = 0 AND u.password LIKE '$2%'`);
  const extras = await sql(`SELECT u.id, u.username, u.email, u.password, 'extra' AS training FROM fos_user u
    WHERE u.username IN (${EXTRA_ADMINS.map(q).join(', ')}) AND u.enabled = 1 AND u.password LIKE '$2%'`);

  const byId = new Map();
  for (const r of [...members, ...extras]) {
    const role = r.training === PRECOMMANDES_TRAINING ? 'precommandes' : 'admin';
    const cur = byId.get(r.id);
    if (cur) { if (role === 'admin') cur.role = 'admin'; continue; }       // several trainings: the strongest role wins
    byId.set(r.id, { login: r.username, email: r.email || '', hash: r.password, role });
  }
  const users = [...byId.values()].sort((a, b) => a.login.localeCompare(b.login));
  if (!users.some((u) => u.role === 'admin')) throw new Error('No administrator found: not writing anything (the previous file stays in place).');

  const tmp = out + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ generated_at: new Date().toISOString(), users }, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, out);
  console.log(`${users.length} accounts written to ${out}`);
  for (const u of users) console.log(`  ${u.role.padEnd(13)} ${u.login}`);
  const missing = EXTRA_ADMINS.filter((n) => !users.some((u) => u.login === n));
  if (missing.length) console.warn(`Warning: not found, disabled or without a password: ${missing.join(', ')}`);
}

main().catch((e) => { console.error('Export failed:', e.message); process.exit(1); });
