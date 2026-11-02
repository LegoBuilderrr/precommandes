// Orders page (Clients): the follow-up menu of a paid order is saved as soon as it changes.
// "Remboursée" cannot be picked here: only the "Rembourser" button sets it.
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
})();
