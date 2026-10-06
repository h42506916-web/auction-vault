/* Seller dashboard: list / edit / delete items, set discounts. Data in localStorage (this browser only). */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const DAY = 86400000;

  function unlocked() { try { return sessionStorage.getItem(AV.KEYS.seller) === '1'; } catch (e) { return false; } }
  function show() {
    const ok = unlocked();
    $('#gate').classList.toggle('hidden', ok);
    $('#dash').classList.toggle('hidden', !ok);
    $('#banner').classList.toggle('hidden', !ok);
    if (ok) renderRows();
  }

  function renderRows() {
    const f = $('#filter').value;
    const items = AV.getItems().filter(it => !f || (f === 'mine' ? it.source === 'seller' : it.source === 'seed'));
    $('#n').textContent = items.length;
    $('#rows').innerHTML = items.map(it => {
      const n = (it.bids || []).length; const tl = AV.timeLeft(it.endsAt);
      return `<tr data-id="${AV.esc(it.id)}">
        <td class="em">${AV.esc(it.emoji || '📦')}</td>
        <td><strong>${AV.esc(it.name)}</strong><br><span class="tag ${it.source === 'seller' ? 'mine' : ''}">${it.source === 'seller' ? 'My listing' : 'Example'}</span>
          <span class="muted" style="font-size:.75rem">${AV.esc(it.category)} · ${it.sold ? 'Sold' : tl.text}</span></td>
        <td>${AV.money(n ? it.currentBid : it.startBid)} <span class="muted">(${n})</span><br>
          ${it.discount > 0 ? `<span class="strike">${AV.money(it.buyNow)}</span><span class="sale-price">${AV.money(AV.salePrice(it))}</span>` : AV.money(it.buyNow)}</td>
        <td><input class="disc" type="number" min="0" max="95" step="1" value="${Number(it.discount) || 0}" aria-label="Discount percent"> <button class="btn small" data-act="disc">Set</button></td>
        <td style="white-space:nowrap"><button class="btn small outline" data-act="edit">Edit</button> <button class="btn small danger" data-act="del">Delete</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="5" class="muted" style="text-align:center;padding:30px">No items yet. List one using the form.</td></tr>';
  }

  function resetForm() {
    const f = $('#item-form'); f.reset(); f.id.value = '';
    f.days.value = 7; f.discount.value = 0;
    $('#form-title').textContent = 'List a New Item'; $('#submit-btn').textContent = 'List Item';
    $('#cancel-edit').classList.add('hidden'); f.days.closest('label').querySelector('input').disabled = false;
  }

  function onSubmit(e) {
    e.preventDefault();
    const f = e.target; const msg = $('#form-msg');
    const data = {
      name: f.name.value.trim(), description: f.description.value.trim(), category: f.category.value,
      emoji: f.emoji.value.trim() || '📦', image: f.image.value.trim(),
      startBid: Math.max(0, parseFloat(f.startBid.value) || 0), buyNow: parseFloat(f.buyNow.value) || 0,
      discount: Math.min(95, Math.max(0, parseFloat(f.discount.value) || 0))
    };
    if (!data.name) { msg.className = 'msg err'; msg.textContent = 'Please enter an item name.'; return; }
    if (data.buyNow <= 0) { msg.className = 'msg err'; msg.textContent = 'Buy It Now price must be above $0.'; return; }
    if (data.buyNow < data.startBid) { msg.className = 'msg err'; msg.textContent = 'Buy It Now price should be at least the starting bid.'; return; }
    if (data.image && !/^https?:\/\//i.test(data.image)) { msg.className = 'msg err'; msg.textContent = 'Image URL must start with http:// or https://'; return; }
    const days = Math.max(0.1, parseFloat(f.days.value) || 7);
    const items = AV.getItems();
    if (f.id.value) {
      const it = items.find(i => i.id === f.id.value);
      if (it) {
        Object.assign(it, data);
        if (!(it.bids && it.bids.length)) it.currentBid = data.startBid;
        it.endsAt = Date.now() + days * DAY; it.sold = false;
      }
      msg.className = 'msg ok'; msg.textContent = 'Item updated.';
    } else {
      items.unshift(Object.assign(data, { id: 'item-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), currentBid: data.startBid, bids: [], endsAt: Date.now() + days * DAY, source: 'seller', sold: false, createdAt: Date.now() }));
      msg.className = 'msg ok'; msg.textContent = 'Item listed! It now appears on the Auction page.';
    }
    AV.saveItems(items); resetForm(); renderRows();
    setTimeout(() => { msg.textContent = ''; }, 3500);
  }

  function onRowClick(e) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const tr = b.closest('tr'); const id = tr.dataset.id; const it = AV.getItem(id); if (!it) return;
    if (b.dataset.act === 'disc') {
      const v = Math.min(95, Math.max(0, parseFloat(tr.querySelector('.disc').value) || 0));
      AV.updateItem(id, x => { x.discount = v; }); renderRows();
      AV.toast(v ? `${it.name}: ${v}% off applied` : `${it.name}: discount removed`);
    } else if (b.dataset.act === 'del') {
      if (!confirm(`Delete "${it.name}"? This cannot be undone.`)) return;
      AV.saveItems(AV.getItems().filter(x => x.id !== id)); renderRows(); AV.toast('Item deleted');
    } else if (b.dataset.act === 'edit') {
      const f = $('#item-form');
      f.id.value = it.id; f.name.value = it.name; f.description.value = it.description || ''; f.category.value = it.category;
      f.emoji.value = it.emoji || ''; f.image.value = it.image || ''; f.startBid.value = it.startBid; f.buyNow.value = it.buyNow;
      f.discount.value = it.discount || 0; f.days.value = Math.max(0.1, Math.round(Math.max(0, it.endsAt - Date.now()) / DAY * 10) / 10) || 7;
      $('#form-title').textContent = 'Edit Item'; $('#submit-btn').textContent = 'Save Changes';
      $('#cancel-edit').classList.remove('hidden'); f.scrollIntoView({ behavior: 'smooth', block: 'start' }); f.name.focus();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('#f-cat').innerHTML = AV.CATEGORIES.map(c => `<option>${AV.esc(c)}</option>`).join('');
    $('#gate-form').addEventListener('submit', e => {
      e.preventDefault();
      if (AV.checkCode($('#gate-in').value)) { sessionStorage.setItem(AV.KEYS.seller, '1'); show(); }
      else { $('#gate-msg').textContent = 'Invalid code'; }
    });
    $('#lock').addEventListener('click', e => { e.preventDefault(); sessionStorage.removeItem(AV.KEYS.seller); location.href = 'index.html'; });
    $('#item-form').addEventListener('submit', onSubmit);
    $('#cancel-edit').addEventListener('click', resetForm);
    $('#rows').addEventListener('click', onRowClick);
    $('#filter').addEventListener('change', renderRows);
    $('#reset').addEventListener('click', () => {
      if (!confirm('Restore the 12 example items to their original state? Your own listings will be kept.')) return;
      const mine = AV.getItems().filter(i => i.source === 'seller');
      AV.resetItems(); AV.saveItems(mine.concat(AV.getItems())); renderRows(); AV.toast('Example items restored');
    });
    AV.onDataChange = renderRows;
    show();
  });
})();
