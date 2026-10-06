/* Auction Vault — shared helpers: data store (localStorage), header/footer, cart, secret code */
(function () {
  'use strict';
  const KEYS = { items: 'av_items_v1', cart: 'av_cart_v1', orders: 'av_orders_v1', seller: 'av_seller_ok', pickups: 'av_pickups_v1', buyer: 'av_buyer_v1' };
  const SECRET_CODE = 'SCOUT TROOPER!'; // NOTE: client-side only — not real security.
  const OWNER_PHONE = '455982359';
  const HOUR = 3600 * 1000;

  const CATEGORIES = ['Electronics', 'Collectibles', 'Tools', 'Fashion', 'Home & Garden', 'Sports', 'Toys & Games', 'Music', 'Other'];

  function seedItems() {
    const now = Date.now();
    const s = (id, name, category, emoji, startBid, currentBid, buyNow, hours, desc, bids) => ({
      id, name, category, emoji, image: '', description: desc,
      startBid, currentBid, buyNow, endsAt: now + hours * HOUR,
      discount: 0, bids: bids || [], source: 'seed', sold: false, createdAt: now
    });
    return [
      s('seed-1', 'Vintage Film Camera (35mm)', 'Electronics', '📷', 20, 45, 120, 5.5, 'Classic 35mm rangefinder pulled from a recently opened vault. Shutter fires, light seals look tidy.', [{ amount: 45, by: 'lensfan', at: now - 2 * HOUR }]),
      s('seed-2', 'Retro Game Console Bundle', 'Toys & Games', '🎮', 50, 88, 199, 26, 'Console with two controllers and a box of cartridges. Untested beyond power-on.', [{ amount: 88, by: 'pixelpete', at: now - HOUR }]),
      s('seed-3', 'Cordless Drill & Bit Set', 'Tools', '🛠️', 15, 32, 75, 49, '18V cordless drill, one battery, charger and a 40-piece bit set in a case.'),
      s('seed-4', 'Acoustic Guitar', 'Music', '🎸', 40, 65, 180, 3.2, 'Dreadnought acoustic, a few dings on the body, plays nicely. Soft case included.'),
      s('seed-5', 'Antique Pocket Watch', 'Collectibles', '⌚', 60, 140, 350, 70, 'Brass-cased pocket watch with chain. Ticks when wound. Age unknown — sold as found.'),
      s('seed-6', 'Designer-Style Leather Jacket', 'Fashion', '🧥', 25, 25, 90, 12, 'Brown leather jacket, size M-ish. Light wear on the cuffs.'),
      s('seed-7', 'Mountain Bike', 'Sports', '🚲', 80, 115, 260, 30, '21-speed mountain bike. Tyres need air, brakes work.'),
      s('seed-8', 'Box of Comic Books (40+)', 'Collectibles', '📚', 10, 38, 110, 8, 'Mixed lot of 40+ comics in bags and boards. Titles vary — a true mystery box.'),
      s('seed-9', 'Espresso Machine', 'Home & Garden', '☕', 30, 52, 140, 54, 'Home espresso machine with portafilter and milk frother. Powers on.'),
      s('seed-10', 'Vinyl Record Collection', 'Music', '💿', 20, 61, 150, 18, 'About 60 LPs, mostly 70s and 80s rock and soul. Sleeves show shelf wear.'),
      s('seed-11', 'Camping Gear Lot', 'Sports', '⛺', 15, 22, 70, 95, '2-person tent, two sleeping bags, a lantern and a camp stove.'),
      s('seed-12', 'Mystery Locked Safe', 'Other', '🔒', 50, 175, 400, 1.5, 'A small locked safe found at the back of a vault. Contents unknown. No key. Good luck!', [{ amount: 175, by: 'vaulthunter', at: now - 0.5 * HOUR }])
    ];
  }

  function read(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function write(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { console.warn('localStorage unavailable', e); } }

  function getItems() {
    let items = read(KEYS.items, null);
    if (!Array.isArray(items)) { items = seedItems(); write(KEYS.items, items); }
    // Keep demo auctions alive: relist seeded items that have ended without selling.
    let changed = false;
    items.forEach(it => {
      if (it.source === 'seed' && !it.sold && it.endsAt < Date.now()) { it.endsAt = Date.now() + (24 + Math.random() * 72) * HOUR; changed = true; }
    });
    if (changed) write(KEYS.items, items);
    return items;
  }
  function saveItems(items) { write(KEYS.items, items); }
  function getItem(id) { return getItems().find(i => i.id === id); }
  function updateItem(id, fn) {
    const items = getItems(); const it = items.find(i => i.id === id);
    if (!it) return null; fn(it); saveItems(items); return it;
  }
  function resetItems() { write(KEYS.items, seedItems()); }

  function salePrice(it) {
    const d = Math.min(95, Math.max(0, Number(it.discount) || 0));
    return Math.round(it.buyNow * (100 - d)) / 100;
  }
  function minNextBid(it) {
    const cur = Number(it.currentBid) || 0;
    const step = cur < 50 ? 1 : cur < 200 ? 5 : 10;
    return (it.bids && it.bids.length) ? cur + step : Math.max(cur, it.startBid);
  }

  const money = n => '$' + Number(n || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function timeLeft(endsAt) {
    let ms = endsAt - Date.now();
    if (ms <= 0) return { text: 'Ended', ended: true, ending: false };
    const d = Math.floor(ms / 86400000); ms %= 86400000;
    const h = Math.floor(ms / 3600000); ms %= 3600000;
    const m = Math.floor(ms / 60000); const s = Math.floor((ms % 60000) / 1000);
    const text = d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
    return { text, ended: false, ending: (endsAt - Date.now()) < 6 * HOUR };
  }

  function thumbHTML(it, extra) {
    const img = it.image ? `<img src="${esc(it.image)}" alt="${esc(it.name)}" loading="lazy" onerror="this.remove()">` : '';
    return `<div class="thumb">${extra || ''}<span aria-hidden="true">${esc(it.emoji || '📦')}</span>${img}</div>`;
  }

  /* ---------- Cart ---------- */
  function getCart() { return read(KEYS.cart, []); }
  function saveCart(c) { write(KEYS.cart, c); updateCartCount(); }
  function addToCart(entry) {
    const cart = getCart();
    if (entry.itemId && cart.some(c => c.itemId === entry.itemId)) { toast('Already in your cart'); openCart(); return; }
    cart.push(Object.assign({ key: 'c' + Date.now() + Math.random().toString(36).slice(2, 6), qty: 1 }, entry));
    saveCart(cart); toast('Added to cart: ' + entry.name); openCart();
  }
  function updateCartCount() {
    const n = getCart().reduce((a, c) => a + (c.qty || 1), 0);
    document.querySelectorAll('.cart-count').forEach(el => el.textContent = n);
  }

  /* ---------- Modal + toast ---------- */
  function openModal(html, opts) {
    closeModal();
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop'; bd.id = 'av-modal';
    bd.innerHTML = `<div class="modal" role="dialog" aria-modal="true" ${opts && opts.wide ? '' : ''}><button class="close" aria-label="Close">×</button><div class="modal-body">${html}</div></div>`;
    bd.addEventListener('click', e => { if (e.target === bd || e.target.classList.contains('close')) closeModal(); });
    document.body.appendChild(bd);
    document.addEventListener('keydown', escClose);
    return bd.querySelector('.modal-body');
  }
  function escClose(e) { if (e.key === 'Escape') closeModal(); }
  function closeModal() { const m = document.getElementById('av-modal'); if (m) m.remove(); document.removeEventListener('keydown', escClose); if (window.AV && AV.onModalClose) AV.onModalClose(); }
  let toastTimer;
  function toast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
  }

  function openCart() {
    const cart = getCart();
    // Auction items are never paid through checkout (cash-only meet-up). Any left over in an
    // older cart get an "Arrange cash pickup" button instead.
    const shop = cart.filter(c => !c.itemId); const auction = cart.filter(c => c.itemId);
    const total = shop.reduce((a, c) => a + c.price * (c.qty || 1), 0);
    const body = openModal(`
      <h2>Your Cart</h2>
      ${cart.length ? `<ul class="cart-list">${shop.map(c => `
        <li><span>${esc(c.emoji || '📦')} <strong>${esc(c.name)}</strong><br><small class="muted">${esc(c.kind || '')}</small></span>
        <span><strong>${money(c.price)}</strong> <button class="btn small outline" data-remove="${esc(c.key)}">Remove</button></span></li>`).join('')}
        ${auction.map(c => `
        <li><span>${esc(c.emoji || '📦')} <strong>${esc(c.name)}</strong><br><small class="muted">Auction item — cash only at meet-up</small></span>
        <span><strong>${money(c.price)}</strong> <button class="btn small" data-pickup="${esc(c.key)}">Arrange cash pickup</button> <button class="btn small outline" data-remove="${esc(c.key)}">Remove</button></span></li>`).join('')}</ul>
        ${shop.length ? `<div class="cart-total">Total: ${money(total)}</div>
        <button class="btn" id="go-checkout" style="width:100%">Proceed to Checkout</button>` : ''}`
        : '<p class="muted">Your cart is empty.</p><a class="btn outline" href="storage.html">Browse Vaults</a> <a class="btn outline" href="auction.html">Browse Auction</a>'}
    `);
    body.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => {
      saveCart(getCart().filter(c => c.key !== b.dataset.remove)); openCart();
    }));
    body.querySelectorAll('[data-pickup]').forEach(b => b.addEventListener('click', () => {
      const c = getCart().find(x => x.key === b.dataset.pickup); if (!c) return openCart();
      saveCart(getCart().filter(x => x.key !== c.key));
      const it = getItem(c.itemId);
      if (!it || it.sold) { toast('Sorry, that item is no longer available'); return openCart(); }
      startPickup({ itemId: it.id, item: it.name, emoji: it.emoji, price: salePrice(it), type: 'Buy It Now' });
    }));
    const go = body.querySelector('#go-checkout');
    if (go) go.addEventListener('click', openCheckout);
  }

  // Storage-vault checkout (unchanged payment options). Auction items are excluded — they use startPickup().
  function openCheckout() {
    const cart = getCart().filter(c => !c.itemId); if (!cart.length) return openCart();
    const total = cart.reduce((a, c) => a + c.price * (c.qty || 1), 0);
    const body = openModal(`
      <h2>Checkout</h2>
      <p class="muted">This is a demo checkout — no payment is taken and no card details are stored.</p>
      <form class="stack" id="checkout-form">
        <div class="row2"><label>Full name<input name="name" required autocomplete="name"></label>
        <label>Email<input name="email" type="email" required autocomplete="email"></label></div>
        <label>Payment method<select name="pay"><option>Credit / Debit Card</option><option>PayPal</option><option>Bank Transfer</option><option>Pay at counter</option></select></label>
        <div class="cart-total">Order total: ${money(total)}</div>
        <button class="btn" type="submit">Place Order (Demo)</button>
      </form>`);
    body.querySelector('#checkout-form').addEventListener('submit', e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const orderNo = 'AV-' + Math.random().toString(36).slice(2, 8).toUpperCase();
      const orders = read(KEYS.orders, []);
      orders.push({ orderNo, name: f.get('name'), email: f.get('email'), pay: f.get('pay'), items: cart, total, at: Date.now() });
      write(KEYS.orders, orders);
      saveCart(getCart().filter(c => c.itemId)); // keep any auction items (they need a cash pickup instead)
      openModal(`<div class="success-box"><div class="tick">✅</div><h2>Order Confirmed</h2>
        <p>Thanks, ${esc(f.get('name'))}! Your order number is <strong>${orderNo}</strong>.</p>
        <p class="muted">Total ${money(total)} via ${esc(f.get('pay'))}. (Demo only — no payment was processed.)</p>
        <button class="btn" onclick="AV.closeModal()">Done</button></div>`);
      if (window.AV && AV.onDataChange) AV.onDataChange();
    });
  }

  /* ---------- Auction pickup: cash-only meet-up, emailed to the owner via FormSubmit ---------- */
  const PICKUP_ENDPOINT = 'https://formsubmit.co/ajax/h.bastian1@icloud.com';
  const MEETUP_POINTS = [
    { v: 'Languages Building', icon: '🗣️' },
    { v: 'MPH - Bathrooms', icon: '🏛️' },
    { v: 'Art Building', icon: '🎨' }
  ];
  const MEETUP_TIMES = [
    { v: 'Lunch', icon: '🥪' },
    { v: 'Recess', icon: '🍎' }
  ];
  const STEP_NAMES = ['Cash only', 'Your details', 'Meet-up point', 'Time', 'Confirm'];

  function getPickups() { const p = read(KEYS.pickups, []); return Array.isArray(p) ? p : []; }
  function savePickups(list) { write(KEYS.pickups, list); }
  function upsertPickup(p) {
    const list = getPickups(); const i = list.findIndex(x => x.id === p.id);
    if (i >= 0) list[i] = p; else list.unshift(p);
    savePickups(list); return p;
  }
  function updatePickup(id, fn) {
    const list = getPickups(); const p = list.find(x => x.id === id);
    if (!p) return null; fn(p); savePickups(list); return p;
  }

  function pickupPayload(p) {
    return {
      _subject: 'New Auction Vault pickup: ' + p.item,
      _template: 'table',
      _captcha: 'false',
      name: p.name,
      class: p.cls || '—',
      contact: p.contact || '—',
      item: p.item,
      price: money(p.price),
      purchase_type: p.type,
      payment: 'Cash',
      meetup: p.meetup,
      time: p.time,
      reference: p.id,
      submitted_at: new Date(p.at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })
    };
  }
  function sendPickupEmail(p) {
    return fetch(PICKUP_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(pickupPayload(p))
    }).then(r => r.json().catch(() => ({})).then(d => {
      if (r.ok && String(d.success) === 'true') return d;
      throw new Error(d.message || ('HTTP ' + r.status));
    }));
  }

  // offer: { itemId, item, emoji, price, type: 'Buy It Now' | 'Highest bid', banner? }
  function startPickup(offer) {
    const saved = read(KEYS.buyer, {}) || {};
    const st = { step: 1, name: saved.name || '', cls: saved.cls || '', contact: saved.contact || '', meetup: '', time: '', done: false };
    const body = openModal('<div class="pickup" id="pickup"></div>');
    const root = body.querySelector('#pickup');
    const isBid = offer.type !== 'Buy It Now';

    const head = () => `
      ${offer.banner && st.step === 1 ? `<div class="msg ok pu-banner">${esc(offer.banner)}</div>` : ''}
      <div class="pu-item"><span class="pu-emoji" aria-hidden="true">${esc(offer.emoji || '📦')}</span>
        <div><div class="cat">${isBid ? 'Your winning offer' : 'Buy It Now — offer confirmed'}</div>
        <strong>${esc(offer.item)}</strong></div><div class="pu-price">${money(offer.price)}</div></div>
      <ol class="pu-steps" aria-label="Progress">${STEP_NAMES.map((n, i) => `<li class="${i + 1 < st.step ? 'done' : i + 1 === st.step ? 'current' : ''}"><span>${i + 1}</span><em>${n}</em></li>`).join('')}</ol>
      <div class="pu-stepno">Step ${st.step} of 5</div>`;
    const nav = (nextLabel, nextDisabled) => `<div class="pu-nav">
      ${st.step > 1 ? '<button type="button" class="btn outline" data-nav="back">← Back</button>' : '<span></span>'}
      <button type="${st.step === 2 ? 'submit' : 'button'}" class="btn" data-nav="next" ${nextDisabled ? 'disabled' : ''}>${nextLabel}</button></div>`;
    const options = (list, cur, field) => `<div class="pu-options" role="radiogroup">${list.map(o => `
      <button type="button" class="pu-option ${cur === o.v ? 'selected' : ''}" role="radio" aria-checked="${cur === o.v}" data-${field}="${esc(o.v)}">
        <span class="pu-ico" aria-hidden="true">${o.icon}</span><span>${esc(o.v)}</span></button>`).join('')}</div>`;

    function render() {
      let html = '';
      if (st.step === 1) {
        html = `<h2>Payment: cash only</h2>
          <div class="cash-box"><div class="cash-ico" aria-hidden="true">💵</div><div>
            <strong>Payment is CASH ONLY, paid at the meet-up.</strong>
            <p>Bring <strong>${money(offer.price)}</strong> in cash when you collect the item. No cards, bank transfers or online payments.</p></div></div>
          <p class="muted pu-note">${isBid ? 'Your bid stands either way — you can also arrange pickup later from the item page.' : 'Closing this window before the last step cancels the purchase.'}</p>
          ${nav('Got it — next →')}`;
      } else if (st.step === 2) {
        html = `<h2>Who are you?</h2><p class="muted">So the seller knows who to look for.</p>
          <form class="stack" id="pu-form" novalidate>
            <label>Your name<input name="name" required maxlength="60" autocomplete="name" value="${esc(st.name)}"></label>
            <div class="row2"><label>Class (optional)<input name="cls" maxlength="30" placeholder="e.g. 8B" value="${esc(st.cls)}"></label>
            <label>Contact (optional)<input name="contact" maxlength="80" placeholder="Phone or email" value="${esc(st.contact)}"></label></div>
            <div class="msg err" id="pu-err" role="alert"></div>
            ${nav('Next →')}
          </form>`;
      } else if (st.step === 3) {
        html = `<h2>Choose a meet-up point</h2><p class="muted">Where should you meet the seller?</p>
          ${options(MEETUP_POINTS, st.meetup, 'meetup')}${nav('Next →', !st.meetup)}`;
      } else if (st.step === 4) {
        html = `<h2>Lunch or recess?</h2><p class="muted">When will you meet at <strong>${esc(st.meetup)}</strong>?</p>
          ${options(MEETUP_TIMES, st.time, 'time')}${nav('Next →', !st.time)}`;
      } else if (st.step === 5) {
        html = `<h2>Confirm your pickup</h2>
          <table class="pu-summary">
            <tr><th>Item</th><td>${esc(offer.item)}</td></tr>
            <tr><th>Price</th><td><strong>${money(offer.price)}</strong>${isBid ? ' <span class="muted">(your bid)</span>' : ''}</td></tr>
            <tr><th>Payment</th><td>💵 Cash — paid at the meet-up</td></tr>
            <tr><th>Meet-up point</th><td>${esc(st.meetup)}</td></tr>
            <tr><th>Time</th><td>${esc(st.time)}</td></tr>
            <tr><th>Your name</th><td>${esc(st.name)}${st.cls ? ' · ' + esc(st.cls) : ''}${st.contact ? '<br><span class="muted">' + esc(st.contact) + '</span>' : ''}</td></tr>
          </table>
          <div class="msg err" id="pu-err" role="alert"></div>
          ${nav('Confirm &amp; notify seller')}`;
      }
      root.innerHTML = head() + html;
      bind();
    }

    function bind() {
      root.querySelectorAll('[data-nav="back"]').forEach(b => b.addEventListener('click', () => { st.step--; render(); }));
      const next = root.querySelector('[data-nav="next"]');
      if (st.step === 2) {
        const f = root.querySelector('#pu-form');
        f.addEventListener('submit', e => {
          e.preventDefault();
          st.name = f.name.value.trim(); st.cls = f.cls.value.trim(); st.contact = f.contact.value.trim();
          if (st.name.length < 2) { root.querySelector('#pu-err').textContent = 'Please enter your name.'; f.name.focus(); return; }
          write(KEYS.buyer, { name: st.name, cls: st.cls, contact: st.contact });
          st.step = 3; render();
        });
        setTimeout(() => { if (f.name) f.name.focus(); }, 0);
        return;
      }
      root.querySelectorAll('[data-meetup]').forEach(b => b.addEventListener('click', () => { st.meetup = b.dataset.meetup; render(); }));
      root.querySelectorAll('[data-time]').forEach(b => b.addEventListener('click', () => { st.time = b.dataset.time; render(); }));
      if (!next) return;
      if (st.step === 5) next.addEventListener('click', submit);
      else next.addEventListener('click', () => { if (!next.disabled) { st.step++; render(); } });
    }

    let pickup = null;
    function submit() {
      const err = root.querySelector('#pu-err');
      if (!pickup) {
        const it = getItem(offer.itemId);
        if (!isBid && (!it || it.sold)) { err.textContent = 'Sorry — this item has already been sold.'; return; }
        // One pickup per item for bids from this browser: a higher bid replaces the earlier pickup.
        const prev = isBid ? getPickups().find(p => p.itemId === offer.itemId && p.type === offer.type && !p.collected) : null;
        pickup = upsertPickup({
          id: prev ? prev.id : 'PU-' + Date.now().toString(36).toUpperCase().slice(-5) + Math.random().toString(36).slice(2, 5).toUpperCase(),
          itemId: offer.itemId, item: offer.item, emoji: offer.emoji || '📦', price: offer.price, type: offer.type,
          name: st.name, cls: st.cls, contact: st.contact, payment: 'Cash', meetup: st.meetup, time: st.time,
          at: Date.now(), emailStatus: 'sending', collected: false
        });
        if (!isBid) {
          updateItem(offer.itemId, x => { x.sold = true; });
          saveCart(getCart().filter(c => c.itemId !== offer.itemId));
        }
        if (window.AV && AV.onDataChange) AV.onDataChange();
      }
      st.done = true;
      root.innerHTML = `<div class="success-box pu-sending"><div class="spinner" aria-hidden="true"></div><h3>Sending your pickup details to the seller…</h3></div>`;
      sendPickupEmail(pickup).then(() => {
        updatePickup(pickup.id, p => { p.emailStatus = 'sent'; p.emailError = ''; });
        root.innerHTML = `<div class="success-box pu-result ok"><div class="tick">✅</div><h2>You're all set!</h2>
          <p>The seller has been emailed your pickup details.</p>
          <p class="pu-recap">Meet at <strong>${esc(pickup.meetup)}</strong> at <strong>${esc(pickup.time.toLowerCase())}</strong> and bring <strong>${money(pickup.price)} cash</strong>.</p>
          <p class="muted">Reference ${esc(pickup.id)}</p>
          <button class="btn" type="button" data-done>Done</button></div>`;
        root.querySelector('[data-done]').addEventListener('click', closeModal);
        if (window.AV && AV.onDataChange) AV.onDataChange();
      }).catch(e => {
        updatePickup(pickup.id, p => { p.emailStatus = 'failed'; p.emailError = String(e && e.message || e); });
        root.innerHTML = `<div class="success-box pu-result err"><div class="tick">⚠️</div><h2>Couldn't reach the seller</h2>
          <p>Your pickup is saved, but we couldn't email the seller just now. Please check your internet connection and try again.</p>
          <p class="muted">Still stuck? Call the owner on <a href="tel:${OWNER_PHONE}">${OWNER_PHONE}</a> and quote ${esc(pickup.id)}.</p>
          <div class="pu-nav"><button class="btn outline" type="button" data-done>Close</button><button class="btn" type="button" data-retry>Try again</button></div></div>`;
        root.querySelector('[data-done]').addEventListener('click', closeModal);
        root.querySelector('[data-retry]').addEventListener('click', submit);
        if (window.AV && AV.onDataChange) AV.onDataChange();
      });
    }

    render();
  }

  /* ---------- Secret code ---------- */
  function checkCode(val) {
    const v = String(val || '').trim();
    return v === SECRET_CODE || v.toUpperCase() === SECRET_CODE.toUpperCase();
  }
  function bindCodeForm(form) {
    const input = form.querySelector('input'); const msg = form.querySelector('.code-msg');
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (checkCode(input.value)) {
        try { sessionStorage.setItem(KEYS.seller, '1'); } catch (er) {}
        window.location.href = 'seller.html';
      } else {
        msg.textContent = 'Invalid code'; input.select();
        setTimeout(() => { msg.textContent = ''; }, 3000);
      }
    });
  }
  const codeFormHTML = `<form class="code-form" autocomplete="off" aria-label="Access code">
      <input type="text" placeholder="Code" aria-label="Enter code" maxlength="40"><button type="submit">GO</button><span class="code-msg" role="alert"></span></form>`;

  /* ---------- Header / footer ---------- */
  function renderChrome() {
    const page = document.body.dataset.page || '';
    const tabs = [['home', 'index.html', 'Home'], ['storage', 'storage.html', 'Storage Units'], ['auction', 'auction.html', 'Auction'], ['support', 'support.html', 'Customer Service']];
    const header = document.getElementById('site-header');
    if (header) {
      header.className = 'site-header';
      header.innerHTML = `<div class="header-inner">
        <a class="brand" href="index.html"><img src="assets/logo-mark.png" alt="Auction Vault logo"><span>Auction Vault</span></a>
        <button class="menu-toggle" aria-label="Menu">☰</button>
        <nav class="tabs" aria-label="Main">${tabs.map(t => `<a href="${t[1]}" class="${t[0] === page ? 'active' : ''}">${t[2]}</a>`).join('')}</nav>
        <div class="header-tools">${codeFormHTML}<button class="cart-btn" type="button">🛒 Cart<span class="cart-count">0</span></button></div>
      </div>`;
      header.querySelector('.menu-toggle').addEventListener('click', () => header.querySelector('.tabs').classList.toggle('open'));
      header.querySelector('.cart-btn').addEventListener('click', openCart);
      bindCodeForm(header.querySelector('.code-form'));
    }
    const footer = document.getElementById('site-footer');
    if (footer) {
      footer.className = 'site-footer';
      footer.innerHTML = `<div class="container footer-inner">
        <div><div class="brand">Auction Vault</div><div>Mystery vaults &amp; online auctions.</div></div>
        <div>Need help? Call the owner on <a href="tel:${OWNER_PHONE}">${OWNER_PHONE}</a><br><a href="support.html">Customer Service</a></div>
        <div>${codeFormHTML}</div>
      </div><div class="container" style="margin-top:16px;font-size:.75rem;color:#8A8D91">© ${new Date().getFullYear()} Auction Vault. Demo site — no real payments are processed.</div>`;
      bindCodeForm(footer.querySelector('.code-form'));
    }
    updateCartCount();
  }

  window.addEventListener('storage', () => { updateCartCount(); if (window.AV && AV.onDataChange) AV.onDataChange(); });
  document.addEventListener('DOMContentLoaded', renderChrome);

  window.AV = Object.assign(window.AV || {}, {
    KEYS, CATEGORIES, OWNER_PHONE, HOUR, getItems, saveItems, getItem, updateItem, resetItems,
    salePrice, minNextBid, money, esc, timeLeft, thumbHTML, getCart, addToCart, openCart, openCheckout,
    openModal, closeModal, toast, checkCode, read, write,
    startPickup, getPickups, savePickups, updatePickup, sendPickupEmail, pickupPayload, MEETUP_POINTS, MEETUP_TIMES, PICKUP_ENDPOINT
  });
})();
