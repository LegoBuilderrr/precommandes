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

  // Picture for the campaign description: sent to the server, then a popup gives its link to copy and paste in the HTML header.
  function linkPopup(url, opener) {
    const h = (tag, props = {}, ...kids) => { const el = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'class') el.className = v; else el.setAttribute(k, v); } el.append(...kids); return el; };
    const input = h('input', { type: 'text', readonly: '', class: 'linkbox', 'aria-label': 'Lien de l’image', value: url });
    const copy = h('button', { type: 'button', class: 'primary' }, 'Copier le lien'), close = h('button', { type: 'button', class: 'flat' }, 'Fermer');
    const msg = h('span', { class: 'copied-msg', role: 'status' });
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Image téléversée' },
      h('div', { class: 'modal-box ok' }, h('div', { class: 'modal-title' }, 'Image téléversée'),
        h('img', { class: 'linkprev', src: url, alt: '' }),
        h('p', {}, 'Collez ce lien dans l’en-tête de la campagne, par exemple :'), input,
        h('p', { class: 'hint' }, `<img src="${url}" alt="">`),
        h('div', { class: 'modal-actions' }, msg, copy, close)));
    const done = () => { box.remove(); document.removeEventListener('keydown', onKey, true); if (opener) opener.focus(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(); } };
    copy.addEventListener('click', async () => { const ok = await copyText(url); msg.textContent = ok ? 'Copié !' : 'Copie impossible : sélectionnez le lien'; if (!ok) input.select(); });
    close.addEventListener('click', done);
    input.addEventListener('focus', () => input.select());
    box.addEventListener('click', (e) => { if (e.target === box) done(); });
    document.addEventListener('keydown', onKey, true);
    document.body.append(box); copy.focus();
  }
  document.addEventListener('click', (e) => { const b = e.target.closest('.upimg'); if (b) b.parentElement.querySelector('.upfile').click(); });
  document.addEventListener('change', async (e) => {
    const input = e.target.closest('.upfile'); if (!input || !input.files[0]) return;
    const file = input.files[0], btn = input.parentElement.querySelector('.upimg'), idle = btn.textContent;
    btn.disabled = true; btn.textContent = 'Envoi…';
    try {
      const res = await fetch('/admin/api/televerser', { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
      const data = await res.json(); if (!data.ok) throw new Error(data.error || 'Échec de l’envoi');
      linkPopup(new URL(data.url, location.href).href, btn);
    } catch (err) {
      const hint = input.parentElement.querySelector('.hint'); hint.textContent = 'Échec : ' + err.message; hint.classList.add('bad');
    }
    input.value = ''; btn.disabled = false; btn.textContent = idle;
  });
})();
