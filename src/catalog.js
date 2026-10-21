// Catalogue of ONE campaign as a tree: product -> variants[] + sizes[]. The admin editor loads and saves the whole tree;
// array position is the display order (drag and drop in the editor), so there are no sort numbers to type.
const db = require('./db');
const { weightLabel, unitsLabel } = require('./weight');
const { unprefix } = require('./basepath');

const fmt = (cents) => (cents / 100).toFixed(2).replace('.', ',');
function parseEuros(s) {
  const t = String(s ?? '').replace(/[€\s]/g, '').replace(',', '.');
  return /^\d{1,6}(\.\d{1,2})?$/.test(t) ? Math.round(Number(t) * 100) : NaN;
}

// Products / variants / sizes that appear in a paid order (refunded orders no longer count): they cannot be deleted.
function boughtSets(campaignId) {
  const rows = db.prepare(`SELECT DISTINCT oi.product_id AS pid, oi.variant_id AS vid, oi.size_id AS sid FROM order_items oi
    JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
    WHERE p.campaign_id = ? AND o.status IN ('paid', 'refunding')`).all(campaignId);
  return { products: new Set(rows.map((r) => r.pid)), variants: new Set(rows.map((r) => r.vid).filter(Boolean)), sizes: new Set(rows.map((r) => r.sid).filter(Boolean)) };
}

// forOrder=true: only what customers can buy (active product, active variants/sizes).
function loadTree({ campaignId, forOrder = false }) {
  const variants = db.prepare('SELECT v.* FROM variants v JOIN products p ON p.id = v.product_id WHERE p.campaign_id = ? ORDER BY v.sort, v.id').all(campaignId);
  const sizes = db.prepare('SELECT s.* FROM sizes s JOIN products p ON p.id = s.product_id WHERE p.campaign_id = ? ORDER BY s.sort, s.id').all(campaignId);
  const bought = boughtSets(campaignId);
  const tree = db.prepare('SELECT * FROM products WHERE campaign_id = ? ORDER BY sort, id').all(campaignId).map((p) => ({
    bought: bought.products.has(p.id), id: p.id, name: p.name, active: !!p.active, image_url: p.image_url, info_url: p.info_url, description: p.description,
    variants: variants.filter((v) => v.product_id === p.id).map((v) => ({ bought: bought.variants.has(v.id), id: v.id, name: v.name, active: !!v.active })),
    sizes: sizes.filter((s) => s.product_id === p.id).map((s) => ({ bought: bought.sizes.has(s.id), id: s.id, label: s.label, name: s.name, grams: s.grams, units: s.units, price_cents: s.price_cents, price: fmt(s.price_cents), active: !!s.active })),
  }));
  if (!forOrder) return tree;
  return tree.filter((p) => p.active).map((p) => ({
    ...p, hadVariants: p.variants.length > 0,
    variants: p.variants.filter((v) => v.active), sizes: p.sizes.filter((s) => s.active),
  })).filter((p) => p.sizes.length && (!p.hadVariants || p.variants.length));
}

function validate(input) {
  if (!Array.isArray(input) || input.length > 300) return { error: 'Catalogue invalide.' };
  const text = (x, max, what) => {
    const t = String(x ?? '').trim();
    if (t.length > max) throw new Error(`${what} : maximum ${max} caractères.`);
    return t;
  };
  // links end up in href/src: only http(s) URLs or our own /img and /uploads files
  const url = (x, what) => {
    const t = unprefix(text(x, 500, what));
    if (t && !/^(https?:\/\/\S+|\/(img|uploads)\/[\w.-]+)$/.test(t)) throw new Error(`${what} : lien invalide (il doit commencer par http:// ou https://).`);
    return t;
  };
  const localImage = (x, what) => {
    const t = unprefix(text(x, 200, what));
    if (t && !/^\/(img|uploads)\/[\w.-]+$/.test(t)) throw new Error(`${what} : utilisez le bouton « Téléverser » (les images sont enregistrées sur le serveur).`);
    return t;
  };
  try {
    const clean = input.map((p, i) => {
      const name = text(p.name, 80, 'Nom de produit');
      if (!name) throw new Error(`Le produit n°${i + 1} n'a pas de nom.`);
      const seenV = new Set(), seenS = new Set();
      const variants = (p.variants || []).map((v) => {
        const vn = text(v.name, 60, 'Option');
        if (!vn) throw new Error(`« ${name} » : une option n'a pas de nom.`);
        if (seenV.has(vn.toLowerCase())) throw new Error(`« ${name} » : l'option « ${vn} » existe deux fois.`);
        seenV.add(vn.toLowerCase());
        return { id: Number(v.id) || null, name: vn, active: v.active ? 1 : 0 };
      });
      const sizes = (p.sizes || []).map((s) => {
        // unit g / kg: a number stored as grams, label generated ("500gr", "1,5kg"); unit "unit": a whole number of units
        // ("6 unités", no weight); unit "text": free label, no weight
        let grams = null, units = null, label;
        if (s.unit === 'g' || s.unit === 'kg') {
          const n = Number(String(s.amount ?? '').trim().replace(',', '.'));
          grams = Math.round(n * (s.unit === 'kg' ? 1000 : 1));
          if (!String(s.amount ?? '').trim() || !Number.isFinite(n) || grams < 1 || grams > 1e6) throw new Error(`« ${name} » : poids invalide « ${s.amount ?? ''} ${s.unit} » (ex. 500 g ou 1,5 kg).`);
          label = weightLabel(grams);
        } else if (s.unit === 'unit') {
          const n = Number(String(s.amount ?? '').trim().replace(',', '.'));
          if (!Number.isInteger(n) || n < 1 || n > 9999) throw new Error(`« ${name} » : nombre d'unités invalide « ${s.amount ?? ''} » (entier, ex. 1 ou 6).`);
          units = n; label = unitsLabel(n);
        } else {
          label = text(s.label, 40, 'Poids');
          if (!label) throw new Error(`« ${name} » : un poids n'a pas de nom (ex. pièce).`);
        }
        if (seenS.has(label.toLowerCase())) throw new Error(`« ${name} » : le poids « ${label} » existe deux fois.`);
        seenS.add(label.toLowerCase());
        const cents = parseEuros(s.price);
        if (Number.isNaN(cents)) throw new Error(`« ${name} » / ${label} : prix invalide (ex. 12,50).`);
        return { id: Number(s.id) || null, label, name: text(s.name, 30, `« ${name} » / ${label} : nom du prix`), grams, units, price_cents: cents, active: s.active ? 1 : 0 };
      });
      if (!sizes.length) throw new Error(`« ${name} » doit avoir au moins un poids avec un prix.`);
      return { id: Number(p.id) || null, name, active: p.active ? 1 : 0,
        description: text(p.description, 300, `« ${name} » : description`),
        image_url: localImage(p.image_url, `« ${name} » : image`), info_url: url(p.info_url, `« ${name} » : lien d'information`), variants, sizes };
    });
    return { clean };
  } catch (e) { return { error: e.message }; }
}

// Saves the products of one campaign. Only rows belonging to that campaign are ever updated or deleted.
function saveTree(campaignId, input) {
  const { clean, error } = validate(input);
  if (error) return { error };
  const owner = (table) => new Map((table === 'products'
    ? db.prepare('SELECT id, id AS pid FROM products WHERE campaign_id = ?')
    : db.prepare(`SELECT t.id, t.product_id AS pid FROM ${table} t JOIN products p ON p.id = t.product_id WHERE p.campaign_id = ?`)).all(campaignId).map((r) => [r.id, r.pid]));
  const had = { products: owner('products'), variants: owner('variants'), sizes: owner('sizes') };
  const keep = { products: new Set(), variants: new Set(), sizes: new Set() };
  db.exec('BEGIN');
  try {
    clean.forEach((p, i) => {
      let pid = had.products.has(p.id) ? p.id : null;
      if (pid) db.prepare('UPDATE products SET name=?, sort=?, active=?, image_url=?, info_url=?, description=? WHERE id=?').run(p.name, (i + 1) * 10, p.active, p.image_url, p.info_url, p.description, pid);
      else pid = Number(db.prepare('INSERT INTO products (campaign_id, name, sort, active, image_url, info_url, description) VALUES (?,?,?,?,?,?,?)').run(campaignId, p.name, (i + 1) * 10, p.active, p.image_url, p.info_url, p.description).lastInsertRowid);
      keep.products.add(pid);
      p.variants.forEach((v, j) => {
        if (had.variants.get(v.id) === pid) db.prepare('UPDATE variants SET name=?, sort=?, active=? WHERE id=?').run(v.name, (j + 1) * 10, v.active, v.id), keep.variants.add(v.id);
        else keep.variants.add(Number(db.prepare('INSERT INTO variants (product_id, name, sort, active) VALUES (?,?,?,?)').run(pid, v.name, (j + 1) * 10, v.active).lastInsertRowid));
      });
      p.sizes.forEach((s, j) => {
        if (had.sizes.get(s.id) === pid) db.prepare('UPDATE sizes SET label=?, name=?, grams=?, units=?, price_cents=?, sort=?, active=? WHERE id=?').run(s.label, s.name, s.grams, s.units, s.price_cents, (j + 1) * 10, s.active, s.id), keep.sizes.add(s.id);
        else keep.sizes.add(Number(db.prepare('INSERT INTO sizes (product_id, label, name, grams, units, price_cents, sort, active) VALUES (?,?,?,?,?,?,?,?)').run(pid, s.label, s.name, s.grams, s.units, s.price_cents, (j + 1) * 10, s.active).lastInsertRowid));
      });
    });
    // Something already bought cannot be removed (it can be renamed, repriced or hidden). Refund the orders first.
    const bought = boughtSets(campaignId), blocked = [];
    for (const id of had.products.keys()) if (!keep.products.has(id) && bought.products.has(id))
      blocked.push(`le produit « ${db.prepare('SELECT name FROM products WHERE id = ?').get(id).name} »`);
    for (const id of had.variants.keys()) if (!keep.variants.has(id) && bought.variants.has(id) && keep.products.has(had.variants.get(id))) {
      const r = db.prepare('SELECT v.name, p.name AS product FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?').get(id);
      blocked.push(`l'option « ${r.name} » de « ${r.product} »`);
    }
    for (const id of had.sizes.keys()) if (!keep.sizes.has(id) && bought.sizes.has(id) && keep.products.has(had.sizes.get(id))) {
      const r = db.prepare('SELECT s.label, p.name AS product FROM sizes s JOIN products p ON p.id = s.product_id WHERE s.id = ?').get(id);
      blocked.push(`le poids « ${r.label} » de « ${r.product} »`);
    }
    if (blocked.length) {
      db.exec('ROLLBACK');
      return { error: `Suppression impossible : ${blocked.join(', ')} ${blocked.length > 1 ? 'figurent' : 'figure'} déjà dans une commande payée. Masquez-${blocked.length > 1 ? 'les' : 'le'} (👁) ou remboursez d’abord les commandes concernées.` };
    }
    for (const table of ['products', 'variants', 'sizes'])
      for (const id of had[table].keys()) if (!keep[table].has(id)) db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { tree: loadTree({ campaignId }) };
}

module.exports = { loadTree, saveTree, parseEuros, fmt };
