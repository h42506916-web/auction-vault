/* Seller dashboard: owner-only (Supabase email sign-in). Items, discounts, sold status,
   vault prices and pickups are all stored in Supabase, so changes are permanent and public. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const DAY = 86400000;
  const db = AV.db;
  let items = [], tiers = [], pickups = [], session = null;

  /* ---------- Auth gate ---------- */
  function showPanel(name) {
    ['checking', 'gate', 'denied', 'dash'].forEach(id => $('#' + id).classList.toggle('hidden', id !== name));
    $('#banner').classList.toggle('hidden', name !== 'dash');
  }
  function route(s) {
    session = s || null;
    if (!session) return showPanel('gate');
    if (!db.isAdmin(session)) { $('#denied-email').textContent = session.user.email || 'an unknown account'; return showPanel('denied'); }
    $('#who').textContent = session.user.email;
    showPanel('dash');
    refreshAll();
  }
  function setSendLabel() { $('#send-link').textContent = 'Send login link to ' + ($('#login-email').value.trim() || db.adminEmail); }
  async function onSendLink(e) {
    e.preventDefault();
    const email = $('#login-email').value.trim(); const btn = $('#send-link'); const msg = $('#gate-msg');
    msg.textContent = '';
    if (!email) { msg.textContent = 'Please enter the owner email.'; return; }
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      await db.sendLoginLink(email);
      $('#otp-box').classList.remove('hidden');
      $('#sent-msg').textContent = `✅ Login link sent to ${email}. Check your inbox (and junk folder).`;
    } catch (ex) {
      msg.textContent = /rate|security purposes|seconds/i.test(ex.message) ? 'Please wait a minute before asking for another link.' : db.friendly(ex);
    } finally { btn.disabled = false; setSendLabel(); }
  }
  async function onVerify(e) {
    e.preventDefault();
    const code = $('#otp-code').value.replace(/\s+/g, ''); const msg = $('#gate-msg'); msg.textContent = '';
    if (!/^\d{6,10}$/.test(code)) { msg.textContent = 'Enter the code from the email.'; return; }
    try { const r = await db.verifyCode($('#login-email').value.trim(), code); route(r && r.session); }
    catch (ex) { msg.textContent = /expired|invalid/i.test(ex.message) ? 'That code is wrong or has expired. Send a new link.' : db.friendly(ex); }
  }
  async function signOut(e) {
    if (e) e.preventDefault();
    try { await db.signOut(); } catch (ex) { console.warn(ex); }
    route(null);
  }

  /* ---------- Data ---------- */
  function dashError(e) { const t = db.friendly(e); $('#dash-msg').textContent = t; AV.toast(t); console.error(e); }
  async function refreshAll() {
    $('#dash-msg').textContent = '';
    await Promise.all([loadItems(), loadTiers(), loadPickups()]);
  }
  async function loadItems() {
    $('#rows').innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center;padding:30px">Loading…</td></tr>';
    try { items = await db.admin.items(); renderRows(); if (pickups.length) renderDebts(); } catch (e) { dashError(e); $('#rows').innerHTML = ''; }
  }
  async function loadTiers() {
    try { tiers = await db.admin.tiers(); renderTiers(); if (pickups.length) { renderPickups(); renderDebts(); } } catch (e) { dashError(e); }
  }
  async function loadPickups() {
    try { pickups = await db.admin.pickups(); renderPickups(); renderDebts(); } catch (e) { dashError(e); }
  }
  // Run a write; on success reload, on failure show why.
  async function save(fn, okMsg, reload) {
    try { await fn(); if (okMsg) AV.toast(okMsg); }
    catch (e) { dashError(e); }
    if (reload) await reload();
  }

  /* ---------- Items ---------- */
  function statusText(it) { return it.removed ? 'Removed' : it.sold ? 'Sold' : AV.timeLeft(it.endsAt).text; }
  function renderRows() {
    const f = $('#filter').value;
    const list = items.filter(it => {
      if (f === 'removed') return it.removed;
      if (it.removed) return false;
      if (f === 'mine') return it.source === 'seller';
      if (f === 'seed') return it.source === 'seed';
      if (f === 'sold') return it.sold;
      return true;
    });
    $('#n').textContent = list.length;
    $('#rows').innerHTML = list.map(it => {
      const n = it.bidCount;
      const actions = it.removed
        ? `<button class="btn small outline" data-act="restore">Restore</button>`
        : `<button class="btn small outline" data-act="edit">Edit</button> <button class="btn small ${it.sold ? 'grey' : 'outline'}" data-act="sold">${it.sold ? 'Relist' : 'Mark sold'}</button> <button class="btn small danger" data-act="del">Remove</button>`;
      return `<tr data-id="${AV.esc(it.id)}">
        <td class="em">${AV.esc(it.emoji || '📦')}</td>
        <td><strong>${AV.esc(it.name)}</strong><br><span class="tag ${it.source === 'seller' ? 'mine' : ''}">${it.source === 'seller' ? 'My listing' : 'Example'}</span>
          <span class="muted" style="font-size:.75rem">${AV.esc(it.category)} · ${AV.esc(statusText(it))}</span></td>
        <td>${AV.money(n ? it.currentBid : it.startBid)} <span class="muted">(${n})</span><br>
          ${it.discount > 0 ? `<span class="strike">${AV.money(it.buyNow)}</span><span class="sale-price">${AV.money(AV.salePrice(it))}</span>` : AV.money(it.buyNow)}</td>
        <td><input class="disc" type="number" min="0" max="95" step="1" value="${Number(it.discount) || 0}" aria-label="Discount percent"> <button class="btn small" data-act="disc">Set</button></td>
        <td style="white-space:nowrap">${actions}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="5" class="muted" style="text-align:center;padding:30px">${f === 'removed' ? 'No removed items.' : 'No items yet. List one using the form.'}</td></tr>`;
  }

  function resetForm() {
    const f = $('#item-form'); f.reset(); f.id.value = '';
    f.days.value = 7; f.discount.value = 0;
    $('#form-title').textContent = 'List a New Item'; $('#submit-btn').textContent = 'List Item';
    $('#cancel-edit').classList.add('hidden');
  }

  async function onSubmit(e) {
    e.preventDefault();
    const f = e.target; const msg = $('#form-msg'); const btn = $('#submit-btn');
    const data = {
      name: f.name.value.trim(), description: f.description.value.trim(), category: f.category.value,
      emoji: f.emoji.value.trim() || '📦', image_url: f.image.value.trim(),
      starting_bid: Math.max(0, parseFloat(f.startBid.value) || 0), buy_now: parseFloat(f.buyNow.value) || 0,
      discount: Math.round(Math.min(95, Math.max(0, parseFloat(f.discount.value) || 0)))
    };
    const bad = t => { msg.className = 'msg err'; msg.textContent = t; };
    if (!data.name) return bad('Please enter an item name.');
    if (data.buy_now <= 0) return bad('Full price must be above $0.');
    if (data.buy_now < data.starting_bid) return bad('Full price should be at least the starting offer.');
    if (data.image_url && !/^https?:\/\//i.test(data.image_url)) return bad('Image URL must start with http:// or https://');
    const days = Math.max(0.1, parseFloat(f.days.value) || 7);
    data.ends_at = new Date(Date.now() + days * DAY).toISOString();
    btn.disabled = true; msg.className = 'msg'; msg.textContent = 'Saving…';
    try {
      if (f.id.value) {
        const it = items.find(i => i.id === f.id.value);
        if (it && !it.bidCount) data.current_bid = data.starting_bid;
        await db.admin.updateItem(f.id.value, data);
        msg.className = 'msg ok'; msg.textContent = 'Item updated.';
      } else {
        await db.admin.insertItem(Object.assign(data, { current_bid: data.starting_bid, bid_count: 0, status: 'active', source: 'seller' }));
        msg.className = 'msg ok'; msg.textContent = 'Item listed! It now appears on the Auction page for everyone.';
      }
      resetForm(); await loadItems();
    } catch (ex) { bad(db.friendly(ex)); console.error(ex); }
    finally { btn.disabled = false; }
    setTimeout(() => { if (msg.classList.contains('ok')) msg.textContent = ''; }, 3500);
  }

  async function onRowClick(e) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const tr = b.closest('tr'); const id = tr.dataset.id; const it = items.find(i => i.id === id); if (!it) return;
    const act = b.dataset.act;
    if (act === 'disc') {
      const v = Math.round(Math.min(95, Math.max(0, parseFloat(tr.querySelector('.disc').value) || 0)));
      b.disabled = true;
      await save(() => db.admin.updateItem(id, { discount: v }), v ? `${it.name}: ${v}% off applied` : `${it.name}: discount removed`, loadItems);
    } else if (act === 'del') {
      if (!confirm(`Remove "${it.name}" from the auction? It will disappear for everyone.`)) return;
      b.disabled = true;
      await save(() => db.admin.updateItem(id, { status: 'removed' }), 'Item removed', loadItems);
    } else if (act === 'restore') {
      b.disabled = true;
      await save(() => db.admin.updateItem(id, { status: 'active' }), 'Item restored', loadItems);
    } else if (act === 'sold') {
      const to = it.sold ? 'active' : 'sold';
      if (to === 'active' && it.endsAt < Date.now() && !confirm('This auction has ended. Relist it for another 7 days?')) return;
      const patch = { status: to };
      if (to === 'active' && it.endsAt < Date.now()) patch.ends_at = new Date(Date.now() + 7 * DAY).toISOString();
      b.disabled = true;
      await save(() => db.admin.updateItem(id, patch), to === 'sold' ? `${it.name} marked as sold` : `${it.name} relisted`, loadItems);
    } else if (act === 'edit') {
      const f = $('#item-form');
      f.id.value = it.id; f.name.value = it.name; f.description.value = it.description || ''; f.category.value = it.category;
      f.emoji.value = it.emoji || ''; f.image.value = it.image || ''; f.startBid.value = it.startBid; f.buyNow.value = it.buyNow;
      f.discount.value = it.discount || 0; f.days.value = Math.max(0.1, Math.round(Math.max(0, it.endsAt - Date.now()) / DAY * 10) / 10) || 7;
      $('#form-title').textContent = 'Edit Item'; $('#submit-btn').textContent = 'Save Changes';
      $('#cancel-edit').classList.remove('hidden'); f.scrollIntoView({ behavior: 'smooth', block: 'start' }); f.name.focus();
    }
  }

  /* ---------- Storage vault tiers ---------- */
  function renderTiers() {
    $('#tier-rows').innerHTML = tiers.map(t => `<tr data-id="${AV.esc(t.id)}">
        <td class="em">${AV.esc(t.emoji)}</td>
        <td><strong>${AV.esc(t.name)}</strong>${t.ribbon ? `<br><span class="tag">${AV.esc(t.ribbon)}</span>` : ''}</td>
        <td><input class="disc tier-price" type="number" min="0" step="0.01" value="${t.price}" aria-label="Price for ${AV.esc(t.name)}" style="width:90px"></td>
        <td><input class="tier-active" type="checkbox" ${t.active ? 'checked' : ''} aria-label="Show on Storage page"></td>
        <td><button class="btn small" data-tier="save">Save</button></td>
      </tr>`).join('') || '<tr><td colspan="5" class="muted" style="text-align:center;padding:20px">No vault tiers found. Run supabase/schema.sql to add them.</td></tr>';
  }
  async function onTierClick(e) {
    const b = e.target.closest('[data-tier]'); if (!b) return;
    const tr = b.closest('tr'); const t = tiers.find(x => x.id === tr.dataset.id); if (!t) return;
    const price = Math.round((parseFloat(tr.querySelector('.tier-price').value) || 0) * 100) / 100;
    if (!(price >= 0)) return AV.toast('Enter a valid price');
    b.disabled = true;
    await save(() => db.admin.updateTier(t.id, { price, active: tr.querySelector('.tier-active').checked }), `${t.name}: saved at ${AV.money(price)}`, loadTiers);
  }

  /* ---------- Pickups ---------- */
  function renderPickups() {
    $('#pu-n').textContent = pickups.length;
    $('#pu-rows').innerHTML = pickups.map(p => {
      const it = p.item_id ? items.find(i => i.id === p.item_id) : tiers.find(t => t.id === p.tier_id);
      return `<tr data-id="${AV.esc(p.id)}" class="${p.collected ? 'collected' : ''}">
        <td style="white-space:nowrap">${AV.esc(new Date(p.created_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }))}<br><span class="muted" style="font-size:.72rem">${AV.esc(p.reference)}</span></td>
        <td><span class="em-inline">${AV.esc((it && it.emoji) || '📦')}</span> <strong>${AV.esc(p.item_name)}</strong><br><span class="tag">${AV.esc(AV.typeLabel(p.purchase_type))}</span></td>
        <td><strong>${AV.money(p.price)}</strong><br>${p.paid ? '<span class="tag paid">✓ Paid</span>' : '<span class="muted" style="font-size:.75rem">💵 Cash at meet-up</span>'}</td>
        <td><strong>${AV.esc(p.buyer_name)}</strong>${p.class ? `<br><span class="muted">${AV.esc(p.class)}</span>` : ''}${p.contact ? `<br><span class="muted">${AV.esc(p.contact)}</span>` : ''}</td>
        <td><strong>${AV.esc(p.meetup)}</strong><br>${AV.esc(p.time)}</td>
        <td style="white-space:nowrap"><button class="btn small ${p.collected ? 'grey' : 'outline'}" data-pu="collected">${p.collected ? '✓ Collected' : 'Mark collected'}</button> <button class="btn small danger" data-pu="del">Remove</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">No pickups or offers yet. They appear here when a buyer makes an offer (auction or storage vault) and picks a meet-up.</td></tr>';
  }
  async function onPickupClick(e) {
    const b = e.target.closest('[data-pu]'); if (!b) return;
    const id = b.closest('tr').dataset.id; const p = pickups.find(x => x.id === id); if (!p) return;
    if (b.dataset.pu === 'collected') {
      b.disabled = true;
      await save(() => db.admin.updatePickup(id, { collected: !p.collected }), p.collected ? 'Marked as not collected' : 'Marked as collected', loadPickups);
    } else if (b.dataset.pu === 'del') {
      if (!confirm('Remove this pickup from the list?')) return;
      b.disabled = true;
      await save(() => db.admin.deletePickup(id), 'Pickup removed', loadPickups);
    }
  }

  /* ---------- Debts / receipts ---------- */
  // Unpaid pickups grouped by buyer (name + class, case-insensitive). "paid" comes from
  // supabase/migration_004.sql; before it runs every pickup counts as unpaid.
  const norm = v => String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const buyerKey = p => norm(p.buyer_name) + '|' + norm(p.class);
  const cents = n => Math.round(Number(n || 0) * 100);
  const sumMoney = list => list.reduce((t, p) => t + cents(p.price), 0) / 100;
  const fmtDate = (v, withTime) => { const d = new Date(v); return isNaN(d) ? '' : d.toLocaleString('en-AU', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }); };
  const paidSupported = () => !pickups.length || Object.prototype.hasOwnProperty.call(pickups[0], 'paid');
  function debtGroups() {
    const groups = new Map();
    pickups.filter(p => !p.paid).slice().sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).forEach(p => {
      const k = buyerKey(p);
      if (!groups.has(k)) groups.set(k, { key: k, name: p.buyer_name, cls: p.class, contacts: [], lines: [] });
      const g = groups.get(k);
      g.name = String(p.buyer_name || '').trim().replace(/\s+/g, ' '); g.cls = p.class; // show the latest spelling
      if (p.contact && !g.contacts.some(c => norm(c) === norm(p.contact))) g.contacts.push(p.contact);
      g.lines.push(p);
    });
    return [...groups.values()].map(g => Object.assign(g, { total: sumMoney(g.lines) })).sort((a, b) => b.total - a.total || norm(a.name).localeCompare(norm(b.name)));
  }
  function outbidNote(p) {
    if (p.purchase_type !== 'Highest bid' || !p.item_id) return '';
    const it = items.find(i => i.id === p.item_id);
    return it && it.currentBid > Number(p.price) ? `<div class="r-warn">⚠ Outbid — top offer is now ${AV.money(it.currentBid)}</div>` : '';
  }
  function receiptHTML(g) {
    const row = (k, v) => v ? `<div class="r-row"><span>${k}</span><span>${AV.esc(v)}</span></div>` : '';
    return `<article class="receipt" data-key="${AV.esc(g.key)}">
      <div class="r-head"><div class="r-brand">AUCTION VAULT</div><div class="r-sub">Cash receipt · amount owing</div></div>
      <div class="r-cut"></div>
      ${row('Buyer', g.name)}${row('Class', g.cls)}${row('Contact', g.contacts.join(', '))}
      <div class="r-cut"></div>
      ${g.lines.map(p => `<div class="r-line" data-id="${AV.esc(p.id)}">
        <label class="r-paid" title="Tick when this has been paid"><input type="checkbox" data-paid="one" aria-label="Mark ${AV.esc(p.item_name)} paid"> Paid</label>
        <div class="r-item"><div class="r-row r-strong"><span>${AV.esc(p.item_name)}</span><span>${AV.money(p.price)}</span></div>
          <div class="r-meta">${AV.esc(AV.typeLabel(p.purchase_type))} · ${AV.esc(fmtDate(p.created_at))} · Ref ${AV.esc(p.reference)}</div>
          <div class="r-meta">Meet-up: ${AV.esc(p.meetup)} · ${AV.esc(p.time)}${p.collected ? ' · <strong>collected</strong>' : ''}</div>
          ${outbidNote(p)}</div>
      </div>`).join('')}
      <div class="r-cut"></div>
      <div class="r-row r-total"><span>TOTAL OWED</span><span>${AV.money(g.total)}</span></div>
      <div class="r-foot">💵 Cash only · ${g.lines.length} item${g.lines.length === 1 ? '' : 's'}</div>
      <button class="btn small" type="button" data-paid="all" style="width:100%;margin-top:10px">Mark all paid — ${AV.money(g.total)}</button>
    </article>`;
  }
  function renderDebts() {
    const groups = debtGroups();
    $('#debt-n').textContent = groups.length;
    $('#debt-total').textContent = AV.money(groups.reduce((t, g) => t + cents(g.total), 0) / 100);
    $('#debt-msg').textContent = paidSupported() ? '' : 'Paid tracking is not set up yet: run supabase/migration_004.sql in the Supabase SQL Editor. Receipts are shown, but ticking Paid will not save until then.';
    $('#debt-cards').innerHTML = groups.map(receiptHTML).join('') || '<p class="muted" style="text-align:center;padding:18px;margin:0">🎉 Nobody owes you anything right now.</p>';
    const paid = pickups.filter(p => p.paid).sort((a, b) => Date.parse(b.paid_at || 0) - Date.parse(a.paid_at || 0));
    $('#paid-n').textContent = paid.length;
    $('#paid-total').textContent = AV.money(sumMoney(paid));
    $('#paid-rows').innerHTML = paid.map(p => `<tr data-id="${AV.esc(p.id)}">
        <td style="white-space:nowrap">${AV.esc(fmtDate(p.paid_at, true) || '—')}</td>
        <td><strong>${AV.esc(p.buyer_name)}</strong>${p.class ? ` <span class="muted">${AV.esc(p.class)}</span>` : ''}</td>
        <td>${AV.esc(p.item_name)}<br><span class="muted" style="font-size:.72rem">${AV.esc(p.reference)}</span></td>
        <td><strong>${AV.money(p.price)}</strong></td>
        <td><button class="btn small outline" type="button" data-paid="undo">Undo</button></td>
      </tr>`).join('') || '<tr><td colspan="5" class="muted" style="text-align:center;padding:16px">Nothing marked paid yet.</td></tr>';
  }
  async function setPaid(ids, paid, controls) {
    controls.forEach(c => { c.disabled = true; });
    $('#debt-msg').textContent = '';
    try {
      await db.admin.markPaid(ids, paid);
      const at = new Date().toISOString();
      pickups.forEach(p => { if (ids.includes(p.id)) { p.paid = paid; p.paid_at = paid ? (p.paid_at || at) : null; } });
      AV.toast(paid ? (ids.length > 1 ? `${ids.length} items marked paid` : 'Marked paid') : 'Moved back to debts');
      renderDebts(); renderPickups();
      loadPickups(); // sync paid_at etc. from the database
    } catch (e) {
      const t = db.friendly(e);
      $('#debt-msg').textContent = '⚠ Could not save: ' + t; AV.toast(t); console.error(e);
      controls.forEach(c => { c.disabled = false; if (c.type === 'checkbox') c.checked = !paid; });
    }
  }
  function onDebtClick(e) {
    const c = e.target.closest('[data-paid]'); if (!c || c.disabled) return;
    const kind = c.dataset.paid;
    if (kind === 'one') {
      const id = c.closest('.r-line').dataset.id;
      setPaid([id], true, [c]);
    } else if (kind === 'all') {
      const card = c.closest('.receipt');
      const g = debtGroups().find(x => x.key === card.dataset.key); if (!g) return;
      if (!confirm(`Mark all ${g.lines.length} item${g.lines.length === 1 ? '' : 's'} for ${g.name} as paid (${AV.money(g.total)})?`)) return;
      setPaid(g.lines.map(p => p.id), true, [c, ...card.querySelectorAll('[data-paid="one"]')]);
    } else if (kind === 'undo') {
      setPaid([c.closest('tr').dataset.id], false, [c]);
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    $('#f-cat').innerHTML = AV.CATEGORIES.map(c => `<option>${AV.esc(c)}</option>`).join('');
    $('#login-email').value = db.adminEmail; setSendLabel();
    $('#login-email').addEventListener('input', setSendLabel);
    $('#login-form').addEventListener('submit', onSendLink);
    $('#otp-form').addEventListener('submit', onVerify);
    $('#signout').addEventListener('click', signOut);
    $('#signout2').addEventListener('click', signOut);
    $('#item-form').addEventListener('submit', onSubmit);
    $('#cancel-edit').addEventListener('click', resetForm);
    $('#rows').addEventListener('click', onRowClick);
    $('#filter').addEventListener('change', renderRows);
    $('#refresh').addEventListener('click', refreshAll);
    $('#tier-rows').addEventListener('click', onTierClick);
    $('#pu-rows').addEventListener('click', onPickupClick);
    $('#debt-cards').addEventListener('change', e => { if (e.target.matches('[data-paid="one"]')) onDebtClick(e); });
    $('#debt-cards').addEventListener('click', e => { if (e.target.matches('button[data-paid]')) onDebtClick(e); });
    $('#paid-rows').addEventListener('click', onDebtClick);
    AV.onDataChange = null;
    try {
      // Also completes a magic-link sign-in (#access_token=… in the URL)
      route(await db.getSession());
      db.onAuth((evt, s) => setTimeout(() => { // setTimeout: never call Supabase from inside the auth callback
        if (evt === 'SIGNED_OUT') route(null);
        else if (evt === 'SIGNED_IN' && (!session || !s || s.user.id !== session.user.id)) route(s);
        else if (s) session = s; // TOKEN_REFRESHED etc.
      }, 0));
    } catch (e) {
      showPanel('gate');
      $('#gate-msg').textContent = db.friendly(e);
    }
  });
})();
