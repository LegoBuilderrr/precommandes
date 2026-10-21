// Campaigns page: the copy icon puts the shop link on the clipboard; the delivery-date lists can grow and shrink.
(() => {
  'use strict';
  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* not allowed here: fall back below */ }
    const t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;opacity:0';
    document.body.append(t); t.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
    t.remove(); return ok;
  };
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]'); if (!b) return;
    const ok = await copyText(b.dataset.copy);
    const msg = b.nextElementSibling;
    b.classList.toggle('copied', ok);
    if (msg) { msg.textContent = ok ? 'Copié !' : 'Copie impossible'; msg.classList.toggle('bad', !ok); }
    clearTimeout(b._t); b._t = setTimeout(() => { b.classList.remove('copied'); if (msg) msg.textContent = ''; }, 1800);
  });

  // Delivery dates: "+ Ajouter une date" appends an empty row, ✕ removes a row (the last one is only emptied).
  document.addEventListener('click', (e) => {
    const add = e.target.closest('.adddate');
    if (add) {
      const list = add.closest('.dates').querySelector('.datelist');
      const row = list.lastElementChild.cloneNode(true); row.querySelector('input').value = '';
      list.append(row); row.querySelector('input').focus(); return;
    }
    const rm = e.target.closest('.rmdate');
    if (rm) {
      const row = rm.closest('.daterow'), list = row.parentElement;
      if (list.children.length > 1) row.remove(); else row.querySelector('input').value = '';
    }
  });
})();
