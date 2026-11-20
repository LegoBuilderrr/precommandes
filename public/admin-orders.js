// Orders page (Clients):
//  - the follow-up menu of a paid order is saved as soon as it changes ("Remboursée" cannot be picked: only the refund button sets it)
//  - the N° / Date / Client headers sort the table (click again to reverse; the choice is kept while the tab is open)
//  - paid orders can be ticked (one by one or all at once) to give them the same follow-up step in one go
(() => {
  'use strict';
  document.addEventListener('change', async (e) => {
    const sel = e.target.closest('select.stepsel'); if (!sel) return;
    const msg = sel.closest('tr').querySelector('.stepmsg');
    const say = (text, bad) => { msg.textContent = text; msg.className = 'stepmsg' + (bad ? ' bad' : ''); };
    sel.disabled = true; say('…');
    try {
      const r = await fetch('/admin/commandes/etape', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ id: sel.dataset.id, step: sel.value || 'paid' }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Erreur');
      sel.dataset.prev = sel.value; say('✓ enregistré');
      setTimeout(() => { if (msg.textContent === '✓ enregistré') say(''); }, 2000);
    } catch (err) {
      sel.value = sel.dataset.prev; say('Échec : ' + err.message, true);
    }
    sel.disabled = false;
  });

  const table = document.querySelector('table.orders'); if (!table) return;
  const tbody = table.tBodies[0], rows = () => [...tbody.querySelectorAll('tr[data-id]')];

  // ---- sorting
  const KEYS = {
    num: (r) => (r.dataset.num === '' ? -1 : Number(r.dataset.num)),
    date: (r) => r.dataset.date,
    name: (r) => r.dataset.name,
  };
  const cmp = (key) => (a, b) => {
    const x = KEYS[key](a), y = KEYS[key](b);
    const c = typeof x === 'string' ? x.localeCompare(y, 'fr', { sensitivity: 'base' }) : x - y;
    return c || Number(a.dataset.id) - Number(b.dataset.id);
  };
  function sortBy(key, dir) {
    const sorted = rows().sort(cmp(key)); if (dir === 'descending') sorted.reverse();
    const tail = tbody.querySelector('tr.paidnone');
    for (const r of sorted) tbody.appendChild(r);
    if (tail) tbody.appendChild(tail);
    for (const th of table.querySelectorAll('th[aria-sort]')) th.removeAttribute('aria-sort');
    table.querySelector(`.sortbtn[data-key="${key}"]`).closest('th').setAttribute('aria-sort', dir);
    try { sessionStorage.setItem('ordersSort', JSON.stringify([key, dir])); } catch { /* private mode: not kept */ }
  }
  table.addEventListener('click', (e) => {
    const b = e.target.closest('.sortbtn'); if (!b) return;
    const th = b.closest('th'), same = th.getAttribute('aria-sort');
    sortBy(b.dataset.key, same === 'ascending' ? 'descending' : 'ascending');
  });
  try {
    const [key, dir] = JSON.parse(sessionStorage.getItem('ordersSort') || 'null') || [];
    if (KEYS[key] && (dir === 'ascending' || dir === 'descending')) sortBy(key, dir);
  } catch { /* nothing kept */ }

  // ---- selection and bulk step change
  const bar = document.querySelector('.bulkbar'), all = document.getElementById('selall');
  const apply = document.getElementById('bulkapply'), bulkMsg = bar.querySelector('.bulkmsg'), count = bar.querySelector('.bulkcount');
  const boxes = () => [...tbody.querySelectorAll('input.rowsel')];       // only paid orders have a box, and those are never hidden
  const picked = () => [...tbody.querySelectorAll('input.rowsel:checked')];
  function refreshBar() {
    const n = picked().length, vis = boxes();
    bar.hidden = n === 0;
    count.textContent = n === 1 ? '1 commande sélectionnée' : `${n} commandes sélectionnées`;
    all.checked = vis.length > 0 && vis.every((b) => b.checked);
    all.indeterminate = !all.checked && vis.some((b) => b.checked);
    for (const b of tbody.querySelectorAll('input.rowsel')) b.closest('tr').classList.toggle('picked', b.checked);
  }
  all.addEventListener('change', () => { for (const b of boxes()) b.checked = all.checked; bulkMsg.textContent = ''; refreshBar(); });
  tbody.addEventListener('change', (e) => { if (e.target.matches('input.rowsel')) { bulkMsg.textContent = ''; refreshBar(); } });
  document.getElementById('bulkclear').addEventListener('click', () => { for (const b of picked()) b.checked = false; bulkMsg.textContent = ''; refreshBar(); });
  apply.addEventListener('click', async () => {
    const ids = picked().map((b) => b.dataset.id), step = document.getElementById('bulkstep').value;
    if (!ids.length) return;
    const say = (text, bad) => { bulkMsg.textContent = text; bulkMsg.className = 'bulkmsg' + (bad ? ' bad' : ''); };
    apply.disabled = true; say('…');
    try {
      const body = new URLSearchParams({ step }); for (const id of ids) body.append('id', id);
      const r = await fetch('/admin/commandes/etapes', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Erreur');
      const value = step === 'paid' ? '' : step;
      for (const id of ids) {
        const sel = tbody.querySelector(`select.stepsel[data-id="${id}"]`);
        if (sel) { sel.value = value; sel.dataset.prev = value; }
      }
      const label = document.querySelector(`#bulkstep option[value="${step}"]`).textContent;
      say(`✓ ${j.changed} commande${j.changed > 1 ? 's' : ''} passée${j.changed > 1 ? 's' : ''} à « ${label} »${j.skipped ? ` (${j.skipped} ignorée${j.skipped > 1 ? 's' : ''}, non payée${j.skipped > 1 ? 's' : ''})` : ''}`);
    } catch (err) { say('Échec : ' + err.message, true); }
    apply.disabled = false;
  });
  refreshBar();
})();
