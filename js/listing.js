/* Listing tab (listing.html): any signed-in buyer with a profile lists their own items on the Auction
   and manages ONLY those (edit, discount, mark sold / relist, remove). Everything goes through the
   checked RPCs in supabase/migration_007.sql; pickups, buyer details and vault prices stay admin-only. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const db = AV.db, A = AV.account, DAY = 86400000;
  const MAX_LIVE = 20;
  const QUICK_EMOJI = ['📦', '📱', '🎮', '👟', '👕', '📚', '🎸', '⚽', '🧸', '🔧', '🪴', '⌚', '🎧', '💄', '🖼️', '🚲'];
  let items = null; // null = not loaded / migration missing
  let editing = null;
  let busy = false;
  let lastKey = '';

  const isLive = it => !it.sold && it.endsAt > Date.now();
  const statusText = it => it.sold ? 'Sold' : it.endsAt <= Date.now() ? 'Ended' : '⏱ ' + AV.timeLeft(it.endsAt).text + ' left';
  const statusCls = it => it.sold ? 'sold' : it.endsAt <= Date.now() ? 'ended' : 'live';

  function panel(html) { return `<div class="panel acct-panel">${html}</div>`; }

  function render() {
    const root = $('#listing-root');
    if (!A.checked) return;
    if (!A.ready) {
      root.innerHTML = panel(`<h2>Listing is coming soon</h2><p class="muted">Buyer accounts aren't switched on yet. Check back soon — meanwhile have a look at the <a href="auction.html">Auction</a>.</p>`);
      return;
    }
    if (!A.session) {
      root.innerHTML = panel(`<div class="login-box"><div class="login-ico" aria-hidden="true">🏷️</div><div><strong>Sign in to list your items</strong>
        <p class="muted">Anyone with an Auction Vault account can list items for sale. Your avatar and name show on your listings.</p>
        <div class="login-actions"><a class="btn" href="${AV.esc(AV.accountURL())}">Sign in</a><a class="btn outline" href="${AV.esc(AV.accountURL('signup'))}">Create account</a></div></div></div>`);
      return;
    }
    if (!A.profile) {
      root.innerHTML = panel(`<div class="login-box"><div class="login-ico" aria-hidden="true">🙂</div><div><strong>Finish your profile first</strong>
        <p class="muted">Pick a display name and avatar — they show on your listings.</p>
        <div class="login-actions"><a class="btn" href="account.html?next=listing.html">Finish profile</a></div></div></div>`);
      return;
    }
    root.innerHTML = `<div class="listing-layout">
      <div class="panel" id="list-form-panel">
        <h2 id="form-title">List a new item</h2>
        <div class="offering-as">${AV.avatarHTML(A.profile)}<span>Listing as <strong>${AV.esc(A.profile.display_name)}</strong></span><a href="account.html" class="muted">Edit</a></div>
        <form class="stack" id="list-form" novalidate>
          <label>Item name<input name="name" required maxlength="80" autocomplete="off" placeholder="e.g. Bluetooth speaker"></label>
          <label>Description<textarea name="description" rows="3" maxlength="600" placeholder="Condition, size, what's included…"></textarea></label>
          <div class="row2">
            <label>Category<select name="category">${AV.CATEGORIES.map(c => `<option>${AV.esc(c)}</option>`).join('')}</select></label>
            <label>Icon (emoji)<input name="emoji" maxlength="8" placeholder="📦" autocomplete="off"></label>
          </div>
          <div class="quick-emoji" role="group" aria-label="Pick an icon">${QUICK_EMOJI.map(e => `<button type="button" class="emoji-opt" data-emoji="${e}" aria-label="Icon ${e}">${e}</button>`).join('')}</div>
          <label>Image URL (optional)<input name="image" type="url" inputmode="url" placeholder="https://…" autocomplete="off"></label>
          <div class="row2">
            <label>Starting offer ($)<input name="startBid" type="number" inputmode="decimal" min="0" max="10000" step="0.01" required placeholder="0.00"></label>
            <label>Full price ($)<input name="buyNow" type="number" inputmode="decimal" min="0.01" max="10000" step="0.01" required placeholder="0.00"></label>
          </div>
          <div class="row2">
            <label><span id="days-label">Auction length (days)</span><input name="days" type="number" inputmode="numeric" min="1" max="30" step="1" value="7"></label>
            <label>Discount %<input name="discount" type="number" inputmode="numeric" min="0" max="90" step="1" value="0"></label>
          </div>
          <div class="msg" id="form-msg" role="alert"></div>
          <div class="form-actions"><button class="btn" type="submit" id="submit-btn">List item</button><button class="btn outline hidden" type="button" id="cancel-edit">Cancel</button></div>
          <p class="muted listing-note">Your item shows on the Auction for everyone, with your avatar. Offers and cash meet-ups go through Auction Vault like every other listing. Up to ${MAX_LIVE} live listings.</p>
        </form>
      </div>
      <div class="panel" id="my-listings">
        <div class="my-offers-head"><h2>My listings</h2><button class="btn outline small" type="button" data-refresh aria-label="Refresh my listings">↻ Refresh</button></div>
        <div id="listing-list" aria-live="polite">${db.loadingHTML('Loading your listings…')}</div>
      </div>
    </div>`;
    bindForm();
    $('#my-listings [data-refresh]').addEventListener('click', loadMine);
    $('#listing-list').addEventListener('click', onListClick);
    loadMine();
  }

  /* ---------- form ---------- */
  function setMsg(cls, text) { const m = $('#form-msg'); if (m) { m.className = 'msg ' + cls; m.textContent = text; } }
  function markField(name) {
    const f = $('#list-form'); f.querySelectorAll('.bad').forEach(x => x.classList.remove('bad'));
    const el = name && f.elements[name]; if (el) { el.classList.add('bad'); el.focus(); }
  }
  function textProblem(v, label) {
    if (!v) return '';
    return AV.validateEntry(v, 'contact').ok ? '' : `Invalid ${label} — please keep it real and friendly (no joke or rude words).`;
  }
  function readForm() {
    const f = $('#list-form');
    const num = v => (v === '' || v == null) ? NaN : Number(v);
    return {
      name: f.name.value.trim(), description: f.description.value.trim(), category: f.category.value,
      emoji: f.emoji.value.trim() || '📦', image_url: f.image.value.trim(),
      starting_bid: num(f.startBid.value), buy_now: num(f.buyNow.value),
      days: f.days.value.trim() === '' ? null : num(f.days.value), discount: f.discount.value.trim() === '' ? 0 : num(f.discount.value)
    };
  }
  function validate(d) {
    if (d.name.length < 2 || !/[A-Za-z]/.test(d.name)) return ['name', 'Please give the item a name (at least 2 letters).'];
    let p = textProblem(d.name, 'item name'); if (p) return ['name', p];
    p = textProblem(d.description, 'description'); if (p) return ['description', p];
    if (/[A-Za-z0-9<>"'&]/.test(d.emoji) || [...d.emoji].length > 8) return ['emoji', 'The icon should be a single emoji — tap one below.'];
    if (d.image_url && !/^https:\/\/[^\s"'<>]+$/i.test(d.image_url)) return ['image', 'Image URL must start with https://'];
    if (!(d.starting_bid >= 0 && d.starting_bid <= 10000)) return ['startBid', 'Starting offer must be $0 – $10,000.'];
    if (!(d.buy_now > 0 && d.buy_now <= 10000)) return ['buyNow', 'Full price must be above $0 and at most $10,000.'];
    if (d.buy_now < d.starting_bid) return ['buyNow', 'Full price should be at least the starting offer.'];
    if (d.days != null && !(d.days >= 1 && d.days <= 30)) return ['days', 'Auction length must be 1–30 days.'];
    if (editing == null && d.days == null) return ['days', 'Auction length must be 1–30 days.'];
    if (!(d.discount >= 0 && d.discount <= 90)) return ['discount', 'Discount must be 0–90%.'];
    return null;
  }
  function resetForm() {
    const f = $('#list-form'); if (!f) return;
    f.reset(); editing = null; f.days.value = 7; f.discount.value = 0; markField(null);
    $('#form-title').textContent = 'List a new item'; $('#submit-btn').textContent = 'List item';
    $('#days-label').textContent = 'Auction length (days)'; f.days.placeholder = '';
    $('#cancel-edit').classList.add('hidden');
  }
  function bindForm() {
    const f = $('#list-form');
    f.querySelectorAll('[data-emoji]').forEach(b => b.addEventListener('click', () => { f.emoji.value = b.dataset.emoji; markField(null); }));
    $('#cancel-edit').addEventListener('click', () => { resetForm(); setMsg('', ''); });
    f.addEventListener('submit', onSubmit);
  }
  // Database answer → message (and highlight the field it is about)
  function serverProblem(r) {
    if (r && r.ok) return false;
    markField(r && r.field);
    setMsg('err', (r && r.message) || 'That did not save. Please try again.');
    return true;
  }
  async function onSubmit(e) {
    e.preventDefault(); if (busy) return;
    const d = readForm(); const bad = validate(d);
    if (bad) { markField(bad[0]); setMsg('err', bad[1]); return; }
    markField(null);
    const btn = $('#submit-btn'); busy = true; btn.disabled = true; setMsg('', 'Saving…');
    try {
      const wasEditing = editing;
      const r = wasEditing ? await db.listing.update(wasEditing, d) : await db.listing.create(d);
      if (serverProblem(r)) return;
      resetForm();
      setMsg('ok', wasEditing ? 'Listing updated.' : 'Listed! It\u2019s now on the Auction for everyone.');
      AV.toast(wasEditing ? 'Listing updated' : 'Item listed');
      await loadMine();
    } catch (ex) { console.error(ex); setMsg('err', db.friendly(ex)); }
    finally { busy = false; btn.disabled = false; }
  }
  function startEdit(it) {
    const f = $('#list-form'); editing = it.id; markField(null);
    f.name.value = it.name; f.description.value = it.description || ''; f.category.value = it.category;
    f.emoji.value = it.emoji || ''; f.image.value = it.image || ''; f.startBid.value = it.startBid; f.buyNow.value = it.buyNow;
    f.discount.value = it.discount || 0; f.days.value = ''; f.days.placeholder = 'Keep current';
    $('#days-label').textContent = 'Restart timer (days)';
    $('#form-title').textContent = 'Edit listing'; $('#submit-btn').textContent = 'Save changes';
    $('#cancel-edit').classList.remove('hidden'); setMsg('', '');
    $('#list-form-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- my listings ---------- */
  function cardHTML(it) {
    const n = it.bidCount; const live = isLive(it);
    return `<div class="my-listing ${statusCls(it)}" data-id="${AV.esc(it.id)}">
      <a class="my-offer-thumb" href="auction.html?item=${encodeURIComponent(it.id)}" aria-label="View ${AV.esc(it.name)} on the Auction">${AV.thumbHTML(it)}</a>
      <div class="my-offer-main">
        <span class="my-offer-name">${AV.esc(it.name)}</span>
        <span class="my-offer-sub"><span class="ls-status ${statusCls(it)}">${AV.esc(statusText(it))}</span> · ${n ? `Top offer <strong>${AV.money(it.currentBid)}</strong> · ${n} offer${n === 1 ? '' : 's'}` : `Starting <strong>${AV.money(it.startBid)}</strong> · no offers yet`}</span>
        <span class="my-offer-sub">Full price ${it.discount > 0 ? `<span class="strike">${AV.money(it.buyNow)}</span> <strong class="sale-price">${AV.money(AV.salePrice(it))}</strong>` : `<strong>${AV.money(it.buyNow)}</strong>`}</span>
      </div>
      <div class="ls-actions">
        <button class="btn outline small" type="button" data-act="edit">Edit</button>
        <span class="ls-disc"><input type="number" inputmode="numeric" min="0" max="90" step="1" value="${Number(it.discount) || 0}" aria-label="Discount percent for ${AV.esc(it.name)}"><button class="btn outline small" type="button" data-act="disc">Set % off</button></span>
        <button class="btn small ${it.sold ? 'outline' : 'grey'}" type="button" data-act="sold">${it.sold || !live ? 'Relist' : 'Mark sold'}</button>
        <button class="btn small danger" type="button" data-act="del">Remove</button>
      </div>
    </div>`;
  }
  function renderList() {
    const box = $('#listing-list'); if (!box) return;
    if (items === null) { box.innerHTML = '<p class="muted my-offers-empty">Listing will be switched on soon — check back shortly.</p>'; return; }
    if (!items.length) { box.innerHTML = '<div class="my-offers-empty"><p class="muted">You haven\u2019t listed anything yet. Use the form to list your first item.</p></div>'; return; }
    const live = items.filter(isLive).length;
    box.innerHTML = `<p class="muted my-offers-sum">${live} of ${MAX_LIVE} live · ${items.length} total</p><div class="my-offer-list">${items.map(cardHTML).join('')}</div>`;
  }
  let seq = 0;
  async function loadMine() {
    const box = $('#listing-list'); if (!box) return;
    const my = ++seq;
    try {
      const list = await db.listing.mine();
      if (my !== seq) return;
      items = list;
      if (items === null) { const p = $('#list-form-panel'); if (p) p.classList.add('hidden'); }
      renderList();
    } catch (e) {
      console.error(e);
      if (my === seq && document.body.contains(box)) { box.innerHTML = db.errorHTML(e); box.querySelector('[data-retry]').addEventListener('click', loadMine); }
    }
  }
  async function act(btn, fn, okText) {
    btn.disabled = true;
    try {
      const r = await fn();
      if (r && r.ok === false) { AV.toast(r.message || 'That did not save.'); return; }
      AV.toast(okText); await loadMine();
    } catch (e) { console.error(e); AV.toast(db.friendly(e)); }
    finally { if (document.body.contains(btn)) btn.disabled = false; }
  }
  function onListClick(e) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const card = b.closest('.my-listing'); const it = items && items.find(i => i.id === card.dataset.id); if (!it) return;
    const a = b.dataset.act;
    if (a === 'edit') return startEdit(it);
    if (a === 'disc') {
      const v = Math.round(Number(card.querySelector('.ls-disc input').value));
      if (!(v >= 0 && v <= 90)) return AV.toast('Discount must be 0–90%');
      return act(b, () => db.listing.update(it.id, { discount: v }), v ? `${it.name}: ${v}% off` : `${it.name}: discount removed`);
    }
    if (a === 'sold') {
      if (it.sold || !isLive(it)) {
        const ended = it.endsAt <= Date.now();
        if (ended && !confirm(`Relist "${it.name}" for another 7 days?`)) return;
        return act(b, () => db.listing.update(it.id, ended ? { status: 'active', days: 7 } : { status: 'active' }), `${it.name} relisted`);
      }
      if (!confirm(`Mark "${it.name}" as sold? Offers will stop.`)) return;
      return act(b, () => db.listing.update(it.id, { status: 'sold' }), `${it.name} marked as sold`);
    }
    if (a === 'del') {
      if (!confirm(`Remove "${it.name}" from the Auction? This can't be undone.`)) return;
      if (editing === it.id) resetForm();
      return act(b, () => db.listing.remove(it.id), 'Listing removed');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    AV.onAccount(a => {
      const key = [a.ready, a.session && a.session.user.id, !!a.profile].join('|');
      if (key === lastKey) { // same person: just refresh the "Listing as" chip
        const chip = document.querySelector('#list-form-panel .offering-as');
        if (chip && a.profile) chip.outerHTML = `<div class="offering-as">${AV.avatarHTML(a.profile)}<span>Listing as <strong>${AV.esc(a.profile.display_name)}</strong></span><a href="account.html" class="muted">Edit</a></div>`;
        return;
      }
      lastKey = key; items = null; editing = null; render();
    });
    // keep the time-left labels fresh (skip while typing a discount)
    setInterval(() => { if (items && !document.hidden && !document.querySelector('#listing-list input:focus')) renderList(); }, 60000);
  });
})();
