/* Auction Vault — shared helpers: data store (localStorage), header/footer, cart, secret code */
(function () {
  'use strict';
  const KEYS = { items: 'av_items_v1', cart: 'av_cart_v1', orders: 'av_orders_v1', seller: 'av_seller_ok' };
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
    const total = cart.reduce((a, c) => a + c.price * (c.qty || 1), 0);
    const body = openModal(`
      <h2>Your Cart</h2>
      ${cart.length ? `<ul class="cart-list">${cart.map(c => `
        <li><span>${esc(c.emoji || '📦')} <strong>${esc(c.name)}</strong><br><small class="muted">${esc(c.kind || '')}</small></span>
        <span><strong>${money(c.price)}</strong> <button class="btn small outline" data-remove="${esc(c.key)}">Remove</button></span></li>`).join('')}</ul>
        <div class="cart-total">Total: ${money(total)}</div>
        <button class="btn" id="go-checkout" style="width:100%">Proceed to Checkout</button>`
        : '<p class="muted">Your cart is empty.</p><a class="btn outline" href="storage.html">Browse Vaults</a> <a class="btn outline" href="auction.html">Browse Auction</a>'}
    `);
    body.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => {
      saveCart(getCart().filter(c => c.key !== b.dataset.remove)); openCart();
    }));
    const go = body.querySelector('#go-checkout');
    if (go) go.addEventListener('click', openCheckout);
  }

  function openCheckout() {
    const cart = getCart(); if (!cart.length) return openCart();
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
      // Mark auction items bought via Buy It Now as sold
      const items = getItems();
      cart.forEach(c => { if (c.itemId) { const it = items.find(i => i.id === c.itemId); if (it) it.sold = true; } });
      saveItems(items);
      saveCart([]);
      openModal(`<div class="success-box"><div class="tick">✅</div><h2>Order Confirmed</h2>
        <p>Thanks, ${esc(f.get('name'))}! Your order number is <strong>${orderNo}</strong>.</p>
        <p class="muted">Total ${money(total)} via ${esc(f.get('pay'))}. (Demo only — no payment was processed.)</p>
        <button class="btn" onclick="AV.closeModal()">Done</button></div>`);
      if (window.AV && AV.onDataChange) AV.onDataChange();
    });
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
    openModal, closeModal, toast, checkCode, read, write
  });
})();
