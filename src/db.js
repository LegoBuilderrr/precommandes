// SQLite (built into Node 22+). campaigns -> products -> (variants + sizes); orders -> order_items.
// Order lines keep a snapshot of names, price and weight, so editing the catalogue never rewrites past sales.
// The schema below is the current one; `addColumn` (further down) upgrades databases made before a column existed.
const { DatabaseSync } = require('node:sqlite');
const { parseWeight } = require('./weight');

const file = require('./config').DB_FILE;
const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  header_html TEXT NOT NULL DEFAULT '',     -- admin-written HTML shown at the top of the campaign's shop page
  lead_days INTEGER NOT NULL DEFAULT 0,     -- orders for a delivery close this many days before it
  min_kind TEXT NOT NULL DEFAULT '',        -- '' (no minimum) | 'weight' | 'money': the delivery needs this much ordered
  min_value INTEGER NOT NULL DEFAULT 0,     -- grams for 'weight', cents for 'money'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS deliveries (     -- delivery dates of a campaign (the shop is open while one is ahead)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  date TEXT NOT NULL,                       -- YYYY-MM-DD
  UNIQUE (campaign_id, date)
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '', info_url TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sizes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  label TEXT NOT NULL,                       -- generated from grams / units, or free text
  name TEXT NOT NULL DEFAULT '',             -- optional name shown to customers instead of the label (e.g. "x2")
  grams INTEGER,                             -- weight in grams, or NULL
  units INTEGER,                             -- count for the "unité" unit (1 unité, 6 unités), or NULL
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  campaign TEXT NOT NULL DEFAULT '',        -- campaign name at order time
  first_name TEXT NOT NULL, last_name TEXT NOT NULL, member_no TEXT NOT NULL,
  email TEXT NOT NULL, comment TEXT NOT NULL DEFAULT '',
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | paid | refunding | refunded | failed
  intent_id INTEGER, redirect_url TEXT, paid_at TEXT, ha_raw TEXT,
  refunded_at TEXT, refund_raw TEXT,
  delivery_date TEXT NOT NULL DEFAULT '',   -- the delivery this order is for (YYYY-MM-DD)
  demo INTEGER NOT NULL DEFAULT 0           -- 1 = dummy order (no real HelloAsso payment)
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  variant_id INTEGER REFERENCES variants(id) ON DELETE SET NULL,
  size_id INTEGER REFERENCES sizes(id) ON DELETE SET NULL,
  product TEXT NOT NULL, variant TEXT NOT NULL DEFAULT '', size TEXT NOT NULL,
  unit_cents INTEGER NOT NULL, qty INTEGER NOT NULL CHECK (qty > 0),
  grams INTEGER,                             -- weight of one unit at order time (NULL = not a weight)
  size_name TEXT NOT NULL DEFAULT ''         -- the price's customer-facing name at order time (e.g. "x2")
);
`);
// Databases made before delivery dates existed get the new columns (the old campaigns.status column is simply ignored).
const addColumn = (table, column, ddl) => { if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`); };
addColumn('campaigns', 'lead_days', 'INTEGER NOT NULL DEFAULT 0');
addColumn('orders', 'delivery_date', "TEXT NOT NULL DEFAULT ''");
addColumn('campaigns', 'min_kind', "TEXT NOT NULL DEFAULT ''");
addColumn('campaigns', 'min_value', 'INTEGER NOT NULL DEFAULT 0');
addColumn('sizes', 'name', "TEXT NOT NULL DEFAULT ''");
addColumn('order_items', 'size_name', "TEXT NOT NULL DEFAULT ''");
if (!db.prepare('PRAGMA table_info(orders)').all().some((c) => c.name === 'demo'))
  throw new Error(`${file} was created by an older version of this app. It only holds test data: delete it and restart.`);

// One-sentence summaries (own words) of what https://www.veggiedeli.fr/fr/les-produits says about each product.
// Fakon is not on that page, so it has none.
const DESCRIPTIONS = {
  'Faux-cisses': 'Saucisses végétales : aux herbes (le best-seller), verguez aux épices du Maghreb sans être trop piquantes, et à hot-dogs façon fête foraine.',
  'Foulet nature': 'Effiloché végétal à la texture filandreuse et au goût ultra convaincant : on jurerait que c’est du poulet.',
  'Foulet aromatisé': 'Le foulet, cet effiloché végétal qui rappelle le poulet, décliné en saveurs kebab, tex mex et colombo.',
  'Bluff effiloché': 'Cousin du foulet, un effiloché végétal à la couleur plus audacieuse grâce à la betterave, idéal pour garnir tacos et burgers.',
  'Larbons': 'Lardons végétaux avec du vrai goût et du caractère, pour relever tartiflettes, pâtes et quiches.',
  'Fake-Steacks': 'Steaks végétaux dodus et juteux, légèrement roses grâce à la betterave, qui tiennent bien dans un burger.',
  'Blanc de dingue': 'Tranches végétales prêtes à manger, sans cuisson, idéales en sandwich et adoptées par les enfants.',
  'Faux-cuitto': 'Alternative végétale à la charcuterie fine, à base de tofu, sans gluten et à la texture fondante, à déposer sur pizza, pâtes ou melon.',
  'Vancetta': 'Pancetta végétale à base de protéines de blé, simple et pleine de goût, qui va dans les pâtes, quiches, pizzas et brunchs.',
  'Médaillon de bluff': 'Médaillon végétal qui bluffe : un steak-frites sans ingrédients bizarres, très peu de cuisson, ou émietté en haché végétal.',
  'Pas-trami': 'Version végétale fumée du smoke meat montréalais, généreuse et validée par plusieurs chefs.',
  'Rôti de dingue': 'Rôti végétal riche en protéines, pièce maîtresse des repas de fête, à servir avec une belle sauce et des légumes de saison.',
};

const AROMA = [['200gr', 637], ['500gr', 1523], ['1kg', 2978], ['2kg', 5817]];
const SEED = [
  ['Faux-cisses', ['aux herbes', 'verguez', 'à hot-dogs'], [['160gr', 566], ['320gr', 1088], ['480gr', 1560], ['800gr', 2374]]],
  ['Foulet nature', [], [['200gr', 580], ['500gr', 1385], ['1kg', 2704], ['2kg', 5276]]],
  ['Foulet aromatisé', ['kebab', 'tex mex', 'colombo'], AROMA],
  ['Bluff effiloché', [], [['200gr', 791], ['500gr', 1913], ['1kg', 3759], ['2kg', 7386]]],
  ['Larbons', [], [['200gr', 660], ['500gr', 1583], ['1kg', 3034], ['2kg', 5804]]],
  ['Fakon', [], [['250gr', 725], ['500gr', 1385], ['750gr', 1979]]],
  ['Fake-Steacks', [], [['200gr', 633], ['400gr', 1213], ['600gr', 1741], ['1kg', 2770]]],
  ['Blanc de dingue', [], [['150gr', 594], ['250gr', 956], ['500gr', 1847]]],
  ['Faux-cuitto', [], [['150gr', 950], ['250gr', 1550], ['500gr', 3034]]],
  ['Vancetta', [], [['150gr', 554], ['250gr', 890], ['500gr', 1715]]],
  ['Médaillon de bluff', [], [['125gr', 396], ['250gr', 758], ['500gr', 1451], ['1kg', 2770]]],
  ['Pas-trami', [], [['200gr', 580], ['500gr', 1385], ['750gr', 1979]]],
  ['Rôti de dingue', [], [['500gr', 1847]]],
];
// Pictures: small copies of the photos on https://www.veggiedeli.fr/fr/les-produits (public/img); Fakon's comes from the supplier's Faire shop.
// "En savoir plus" links: each product's own page on the site. Faux-cisses has one page per flavour (herbes, verguez,
// hot-dogs); we link the best-seller. Foulet nature / aromatisé share the "foulet" page. Fakon is not on the site.
const SITE = 'https://www.veggiedeli.fr/fr/les-produits/';
const PAGES = {
  'Faux-cisses': 'faux-cisses-aux-herbes', 'Foulet nature': 'foulet', 'Foulet aromatisé': 'foulet', 'Bluff effiloché': 'bluff-effiloche',
  'Larbons': 'larbon', 'Fake-Steacks': 'fake-steaks', 'Blanc de dingue': 'blanc-de-dingue', 'Faux-cuitto': 'faux-ciutto',
  'Vancetta': 'vancetta', 'Médaillon de bluff': 'medaillon-de-bluff', 'Pas-trami': 'pas-strami', 'Rôti de dingue': 'roti-de-dingue',
};
const IMAGES = {
  'Faux-cisses': 'faux-cisses', 'Foulet nature': 'foulet', 'Foulet aromatisé': 'foulet', 'Bluff effiloché': 'bluff-effiloche',
  'Larbons': 'larbons', 'Fake-Steacks': 'fake-steacks', 'Blanc de dingue': 'blanc-de-dingue', 'Faux-cuitto': 'faux-cuitto',
  'Vancetta': 'vancetta', 'Médaillon de bluff': 'medaillon-de-bluff', 'Pas-trami': 'pas-trami', 'Rôti de dingue': 'roti-de-dingue', 'Fakon': 'fakon',
};
function seedProducts(campaignId) {
  const P = db.prepare('INSERT INTO products (campaign_id, name, sort, image_url, info_url, description) VALUES (?, ?, ?, ?, ?, ?)');
  const V = db.prepare('INSERT INTO variants (product_id, name, sort) VALUES (?, ?, ?)');
  const S = db.prepare('INSERT INTO sizes (product_id, label, price_cents, sort, grams) VALUES (?, ?, ?, ?, ?)');
  db.exec('BEGIN');
  SEED.forEach(([name, variants, sizes], i) => {
    const img = IMAGES[name];
    const pid = Number(P.run(campaignId, name, (i + 1) * 10, img ? `/img/${img}.jpg` : '', PAGES[name] ? SITE + PAGES[name] : '', DESCRIPTIONS[name] || '').lastInsertRowid);
    variants.forEach((v, j) => V.run(pid, v, (j + 1) * 10));
    sizes.forEach(([label, cents], j) => S.run(pid, label, cents, (j + 1) * 10, parseWeight(label)));
  });
  db.exec('COMMIT');
}

// First start: one campaign, "Veggie Deli", with the products of the Framaforms pre-order.
if (!db.prepare('SELECT COUNT(*) AS n FROM campaigns').get().n) {
  const cid = Number(db.prepare('INSERT INTO campaigns (name, slug) VALUES (?, ?)').run('Veggie Deli', 'veggie-deli').lastInsertRowid);
  seedProducts(cid);
}

module.exports = db;
