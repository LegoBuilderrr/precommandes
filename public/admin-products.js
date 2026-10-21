// Product editor: product -> variants (optional) + sizes (weight/price). Reorder by drag and drop
// (array position = display order). Nothing is written until "Enregistrer" (or Ctrl+S).
(() => {
  'use strict';
  const app = document.getElementById('app');
  // A size is a weight (number + unit g/kg, stored as grams so totals can be computed) or, rarely, a free text ("pièce").
  const fmtNum = (n) => String(Number(n.toFixed(3))).replace('.', ',');
  const toClientSize = (s) => ({ id: s.id, bought: s.bought, price: s.price, active: s.active, label: s.label, name: s.name || '',
    unit: s.grams != null ? (s.grams >= 1000 ? 'kg' : 'g') : s.units != null ? 'unit' : 'text',
    amount: s.grams != null ? (s.grams >= 1000 ? fmtNum(s.grams / 1000) : String(s.grams)) : s.units != null ? String(s.units) : '' });
  const toClient = (p) => ({ ...p, sizes: p.sizes.map(toClientSize) });
  let tree = JSON.parse(document.getElementById('init').textContent).map((p) => ({ ...toClient(p), _open: false }));
  let dirty = false, saving = false, focusSel = null, drag = null;

  // tiny DOM helper: h('div', {class:'x', onclick:fn}, child, 'text')
  const h = (tag, props = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  };
  const btn = (text, onclick, cls = 'ibtn', title = '', disabled = false) => h('button', { type: 'button', class: cls, onclick, title, disabled }, text);
  // Something already bought cannot be deleted: its delete button stays visible but greyed out, and clicking it explains why.
  const LOCKED = 'Suppression impossible : produit déjà acheté. Mais vous pouvez le masquer de la boutique.';
  // Error popup: a small dialog with an OK button (closes with OK, Esc or a click outside; focus goes back to the button that opened it).
  function errorPopup(msg, opener) {
    const ok = h('button', { type: 'button', class: 'primary' }, 'OK');
    const box = h('div', { class: 'modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': 'Erreur' },
      h('div', { class: 'modal-box' }, h('div', { class: 'modal-title' }, 'Erreur'), h('p', {}, msg), h('div', { class: 'modal-actions' }, ok)));
    const close = () => { box.remove(); document.removeEventListener('keydown', onKey, true); if (opener) opener.focus(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    ok.addEventListener('click', close);
    box.addEventListener('click', (e) => { if (e.target === box) close(); });
    document.addEventListener('keydown', onKey, true);
    document.body.append(box); ok.focus();
  }
  const delBtn = (bought, icon, title, action) => (bought
    ? h('button', { type: 'button', class: 'ibtn del locked', title: LOCKED, 'aria-disabled': 'true', onclick: (e) => errorPopup(LOCKED, e.currentTarget) }, icon)
    : btn(icon, action, 'ibtn del', title));
  const statusMsg = (text, cls = '') => { const s = document.getElementById('status'); if (s) { s.textContent = text; s.className = 'status ' + cls; } };
  const parsePrice = (s) => { const t = String(s).replace(/[€\s]/g, '').replace(',', '.'); return /^\d{1,6}(\.\d{1,2})?$/.test(t) ? Number(t) : NaN; };
  const money = (n) => n.toFixed(2).replace('.', ',') + ' €';

  function setDirty(on) {
    dirty = on;
    const s = document.getElementById('status');
    if (s) { s.textContent = on ? 'Modifications non enregistrées' : ''; s.className = 'status' + (on ? ' dirty' : ''); }
    const b = document.getElementById('save'); if (b) b.disabled = !on;
  }
  const touch = () => setDirty(true);

  // ---- drag and drop (HTML5). `arr` is reordered; items must contain a .grip handle.
  function sortable(list, items, arr, axis) {
    items.forEach((el, i) => {
      el.querySelector('.grip').addEventListener('mousedown', () => { el.draggable = true; });
      el.addEventListener('dragstart', (e) => {
        if (!el.draggable) return;
        e.stopPropagation(); drag = { list, from: i };
        e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', '');
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => { el.draggable = false; el.classList.remove('dragging'); clearMarks(); drag = null; });
      el.addEventListener('dragover', (e) => {
        if (!drag || drag.list !== list) return;
        e.preventDefault(); e.stopPropagation();
        const r = el.getBoundingClientRect();
        const after = axis === 'x' ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
        clearMarks(); el.classList.add(after ? 'drop-after' : 'drop-before'); el.dataset.after = after ? '1' : '';
      });
      el.addEventListener('drop', (e) => {
        if (!drag || drag.list !== list) return;
        e.preventDefault(); e.stopPropagation();
        let to = i + (el.dataset.after ? 1 : 0); const from = drag.from;
        if (from < to) to--;
        arr.splice(to, 0, arr.splice(from, 1)[0]);
        drag = null; touch(); render();
      });
    });
  }
  const clearMarks = () => document.querySelectorAll('.drop-before,.drop-after').forEach((e) => e.classList.remove('drop-before', 'drop-after'));
  document.addEventListener('mouseup', () => document.querySelectorAll('[draggable=true]').forEach((e) => { if (!drag) e.draggable = false; }));

  // ---- rendering
  const eye = (obj, redraw) => btn(obj.active ? '👁' : '🚫', () => { obj.active = !obj.active; touch(); redraw(); }, 'ibtn', obj.active ? 'Visible sur la boutique (cliquer pour masquer)' : 'Masqué (cliquer pour afficher)');

  function summary(p) {
    const prices = p.sizes.map((s) => parsePrice(s.price)).filter((n) => !Number.isNaN(n));
    const range = prices.length ? (Math.min(...prices) === Math.max(...prices) ? money(prices[0]) : `${money(Math.min(...prices))} – ${money(Math.max(...prices))}`) : '';
    return [p.variants.length ? `${p.variants.length} option${p.variants.length > 1 ? 's' : ''}` : '', `${p.sizes.length} prix`, range].filter(Boolean).join(' · ');
  }

  function mediaBlock(p) {
    const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', hidden: true, onchange: async (e) => {
      const f = e.target.files[0]; if (!f) return;
      statusMsg('Envoi de l’image…');
      try {
        const res = await fetch('/admin/api/televerser', { method: 'POST', headers: { 'Content-Type': f.type || 'application/octet-stream' }, body: f });
        const data = await res.json(); if (!data.ok) throw new Error(data.error || 'Échec de l’envoi');
        p.image_url = data.url; touch(); render();
      } catch (err) { statusMsg(err.message, 'err'); }
    } });
    const pick = () => file.click();
    const picture = p.image_url
      ? h('img', { class: 'preview pick', src: p.image_url, alt: '', title: 'Cliquer pour changer l’image', tabindex: '0', role: 'button', onclick: pick, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } } })
      : h('button', { type: 'button', class: 'imgdrop', title: 'Cliquer pour ajouter une image', onclick: pick }, '+ Image');
    return [h('h3', {}, 'Description'),
      h('textarea', { class: 'pdesc', rows: 2, maxlength: 300, placeholder: 'Une phrase pour présenter le produit', 'aria-label': 'Description', oninput: (e) => { p.description = e.target.value; touch(); } }, p.description || ''),
      h('h3', {}, 'Image'), h('div', { class: 'media' }, picture, file,
      h('div', { class: 'fields' },
        h('label', {}, 'Fiche produit (lien) :',
          h('input', { type: 'text', class: 'wide', value: p.info_url || '', placeholder: 'https://…', 'aria-label': 'Fiche produit (lien)', oninput: (e) => { p.info_url = e.target.value; touch(); } }))))];
  }

  function variantsBlock(p, pi) {
    const chips = h('div', { class: 'chips' });
    const els = p.variants.map((v, vi) => h('span', { class: 'chip' + (v.active ? '' : ' off'), 'data-v': vi },
      h('span', { class: 'grip', title: 'Glisser pour réordonner' }, '⠿'),
      h('input', { type: 'text', value: v.name, 'aria-label': 'Nom de l’option', oninput: (e) => { v.name = e.target.value; touch(); } }),
      eye(v, render), delBtn(v.bought, '✕', 'Supprimer l’option', () => { p.variants.splice(vi, 1); touch(); render(); })));
    chips.append(...els);
    const add = h('input', { type: 'text', placeholder: 'Nouvelle option…', 'data-addv': pi, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); addVariant(); } } });
    const addVariant = () => {
      const name = add.value.trim(); if (!name) return;
      p.variants.push({ name, active: true }); touch(); focusSel = `[data-addv="${pi}"]`; render();
    };
    chips.append(h('span', { class: 'addv' }, add, btn('+ Ajouter', addVariant, '', '')));
    sortable(chips, els, p.variants, 'x');
    return [h('h3', {}, 'Options'), chips];
  }

  function sizesBlock(p, pi) {
    const list = h('div', { class: 'slist' });
    const rows = p.sizes.map((s, si) => h('div', { class: 'srow' + (s.active ? '' : ' off') },
      h('span', { class: 'grip', title: 'Glisser pour réordonner' }, '⠿'),
      h('input', { type: 'text', class: 'sname', value: s.name, placeholder: 'Nom (ex. x2)', maxlength: 30, 'aria-label': 'Nom du prix (affiché sur la boutique à la place du poids)', oninput: (e) => { s.name = e.target.value; touch(); } }),
      s.unit === 'text'
        ? h('input', { type: 'text', class: 'slabel', value: s.label, placeholder: 'ex. pièce, lot de 6', 'data-size': `${pi}-${si}`, 'aria-label': 'Libellé', oninput: (e) => { s.label = e.target.value; touch(); } })
        : h('input', { type: 'text', class: 'slabel', value: s.amount, placeholder: s.unit === 'unit' ? '1' : s.unit === 'kg' ? '1,5' : '500', inputmode: 'decimal', 'data-size': `${pi}-${si}`, 'aria-label': 'Poids', oninput: (e) => { s.amount = e.target.value; touch(); } }),
      h('select', { class: 'sunit', 'aria-label': 'Unité', onchange: (e) => { s.unit = e.target.value; touch(); render(); } },
        h('option', { value: 'g', selected: s.unit === 'g' }, 'g'), h('option', { value: 'kg', selected: s.unit === 'kg' }, 'kg'), h('option', { value: 'unit', selected: s.unit === 'unit' }, 'unité'), h('option', { value: 'text', selected: s.unit === 'text' }, 'texte libre')),
      h('input', { type: 'text', class: 'sprice', value: s.price, placeholder: '0,00', inputmode: 'decimal', 'aria-label': 'Prix en euros',
        oninput: (e) => { s.price = e.target.value; touch(); },
        onblur: (e) => { const n = parsePrice(e.target.value); if (!Number.isNaN(n)) { s.price = n.toFixed(2).replace('.', ','); e.target.value = s.price; } } }),
      '€', eye(s, render), delBtn(s.bought, '✕', 'Supprimer ce prix', () => { p.sizes.splice(si, 1); touch(); render(); })));
    list.append(...rows);
    sortable(list, rows, p.sizes, 'y');
    return [h('h3', {}, 'Prix'), list,
      btn('+ Ajouter un prix', () => { p.sizes.push({ label: '', name: '', unit: 'g', amount: '', price: '', active: true }); touch(); focusSel = `[data-size="${pi}-${p.sizes.length - 1}"]`; render(); }, 'addprice', '')];
  }

  function productCard(p, pi) {
    const redraw = render;
    const head = h('div', { class: 'phead' },
      btn(p._open ? '▾' : '▸', () => { p._open = !p._open; render(); }, 'ibtn', p._open ? 'Replier' : 'Déplier'),
      h('span', { class: 'grip', title: 'Glisser pour réordonner' }, '⠿'),
      p.image_url ? h('img', { class: 'thumb', src: p.image_url, alt: '', onerror: (e) => e.target.remove() }) : null,
      h('input', { type: 'text', class: 'pname', value: p.name, placeholder: 'Nom du produit', 'data-pname': pi, 'aria-label': 'Nom du produit', oninput: (e) => { p.name = e.target.value; touch(); } }),
      p._open ? null : h('span', { class: 'sum' }, summary(p)),
      eye(p, redraw),
      delBtn(p.bought, '🗑', 'Supprimer le produit', () => { if (confirm(`Supprimer « ${p.name || 'ce produit'} » ?`)) { tree.splice(pi, 1); touch(); render(); } }));
    // Clicking the row itself (not a field, button, link or the drag handle) unfolds / folds the product.
    head.addEventListener('click', (e) => { if (!e.target.closest('input,textarea,select,button,a,label,.grip')) { p._open = !p._open; render(); } });
    const card = h('section', { class: 'pcard' + (p.active ? '' : ' off') }, head);
    if (p._open) card.append(h('div', { class: 'pbody' }, mediaBlock(p), variantsBlock(p, pi), sizesBlock(p, pi)));
    return card;
  }

  function toolbar() {
    return h('div', { class: 'toolbar' },
      btn('+ Nouveau produit', () => {
        tree.push({ name: '', active: true, image_url: '', info_url: '', description: '', variants: [], sizes: [{ label: '', name: '', unit: 'g', amount: '', price: '', active: true }], _open: true });
        touch(); focusSel = `[data-pname="${tree.length - 1}"]`; render();
      }, 'btn'),
      h('span', { id: 'status', class: 'status' }),
      h('button', { id: 'save', type: 'button', class: 'primary', onclick: save, disabled: true }, 'Enregistrer'));
  }

  function render() {
    const cards = tree.map(productCard);
    const list = h('div', { class: 'plist' }, cards);
    sortable(list, cards, tree, 'y');
    app.replaceChildren(h('h1', {}, 'Produits'), toolbar(), list);
    setDirty(dirty);
    if (focusSel) { const el = document.querySelector(focusSel); if (el) { el.focus(); if (el.select) el.select(); } focusSel = null; }
  }

  async function save() {
    if (saving || !dirty) return;
    saving = true;
    const status = document.getElementById('status'); status.textContent = 'Enregistrement…'; status.className = 'status';
    const payload = tree.map((p) => ({ id: p.id, name: p.name, active: p.active, description: p.description || '', image_url: p.image_url || '', info_url: p.info_url || '',
      variants: p.variants.map((v) => ({ id: v.id, name: v.name, active: v.active })),
      sizes: p.sizes.map((s) => ({ id: s.id, unit: s.unit, amount: s.amount, label: s.label, name: s.name, price: s.price, active: s.active })) }));
    try {
      const res = await fetch('/admin/api/catalogue?c=' + encodeURIComponent(app.dataset.campaign), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Erreur');
      tree = data.tree.map((p, i) => ({ ...toClient(p), _open: tree[i] ? tree[i]._open : false }));
      dirty = false; render();
      const s = document.getElementById('status'); s.textContent = 'Enregistré ✓'; s.className = 'status';
    } catch (e) {
      const s = document.getElementById('status'); s.textContent = e.message; s.className = 'status err';
    } finally { saving = false; }
  }

  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } });
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  render();
})();
