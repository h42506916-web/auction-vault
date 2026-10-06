/* Auction page: grid, search/filter, detail modal, offers (bids) and full-price offers — data shared via Supabase.
   Highest offer wins; buyers pay cash at the meet-up, no cards. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const state = { q: '', cat: '', sort: 'ending', deals: false, loaded: false, top: {}, topLoaded: false, listers: {}, listersOn: false };
  const REFRESH_MS = 30000;
  let openId = null;

  function init() {
    const cats = AV.CATEGORIES;
    $('#cat').innerHTML += cats.map(c => `<option>${AV.esc(c)}</option>`).join('');
    $('#chips').innerHTML = ['All', ...cats].map(c => `<button class="chip ${c === 'All' ? 'active' : ''}" data-cat="${c === 'All' ? '' : AV.esc(c)}">${AV.esc(c)}</button>`).join('');
    $('#q').addEventListener('input', e => { state.q = e.target.value.trim().toLowerCase(); render(); });
    $('#cat').addEventListener('change', e => { state.cat = e.target.value; syncChips(); render(); });
    $('#sort').addEventListener('change', e => { state.sort = e.target.value; render(); });
    $('#dealsOnly').addEventListener('change', e => { state.deals = e.target.checked; render(); });
    $('#chips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; state.cat = b.dataset.cat; $('#cat').value = state.cat; syncChips(); render(); });
    $('#grid').addEventListener('click', onGridClick);
    load(true).then(openFromUrl);
    setInterval(tick, 1000);
    // Pick up changes made by the seller or other bidders
    setInterval(() => { if (state.loaded && !document.hidden && !document.getElementById('av-modal')) load(false); }, REFRESH_MS);
  }
  // Shareable item links: auction.html?item=<id> (older #<id> links still work).
  function linkedId() {
    const q = new URLSearchParams(location.search).get('item');
    if (q) return q;
    try { return decodeURIComponent(location.hash.slice(1)); } catch (e) { return ''; }
  }
  function openFromUrl() {
    const id = linkedId(); if (!id || !state.loaded) return;
    if (AV.getItem(id)) openDetail(id);
    else { AV.toast('Sorry, that item is no longer listed.'); setItemParam(null); }
  }
  function itemLink(id) { return location.origin + location.pathname + '?item=' + encodeURIComponent(id); }
  function setItemParam(id) {
    const params = new URLSearchParams(location.search);
    if (id) params.set('item', id); else params.delete('item');
    const qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  }
  async function copyLink(id) {
    const url = itemLink(id);
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(url);
      else {
        const ta = document.createElement('textarea'); ta.value = url; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove();
        if (!ok) throw new Error('copy failed');
      }
      AV.toast('Link copied — share it with a friend!');
    } catch (e) {
      window.prompt('Copy this link to share the item:', url);
    }
  }
  function syncChips() { document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.cat === state.cat)); }

  async function load(showSpinner) {
    if (showSpinner) { $('#count').textContent = ''; $('#grid').innerHTML = AV.db.loadingHTML('Loading auction items…'); }
    try {
      await AV.db.loadItems(); state.loaded = true; render();
      loadTop(); loadListers();
    } catch (e) {
      console.error(e);
      if (!state.loaded) {
        $('#count').textContent = '';
        $('#grid').innerHTML = AV.db.errorHTML(e);
        $('#grid [data-retry]').addEventListener('click', () => load(true));
      }
    }
  }

  // Who has the highest offer on each item (public: amount + bidder name only).
  async function loadTop() {
    try { state.top = await AV.db.topOffers(AV.getItems()); state.topLoaded = true; render(); updateDetailTop(); }
    catch (e) { console.warn('Top offers unavailable', e); }
  }
  // Who listed each item (supabase/migration_007.sql; nothing is shown before it runs)
  async function loadListers() {
    try {
      const l = await AV.db.listers(); if (!l) return;
      state.listers = l; state.listersOn = true; render();
      const el = openId && document.querySelector('#av-modal #listed-by'); const it = openId && AV.getItem(openId);
      if (el && it) el.innerHTML = listerHTML(it);
    } catch (e) { console.warn('Listers unavailable', e); }
  }
  function listerHTML(it) {
    if (!state.listersOn) return '';
    const l = it.ownerId && state.listers[it.id];
    if (l) return `<div class="listed-by">Listed by ${AV.avatarHTML(l, 'sm')}<strong>${AV.esc(l.by)}</strong></div>`;
    return '<div class="listed-by">Listed by <span class="avatar sm av-house" aria-hidden="true"><img src="assets/logo-mark.png" alt=""></span><strong>Auction Vault</strong></div>';
  }
  const isMine = it => !!(it && it.ownerId && AV.account.session && AV.account.session.user && it.ownerId === AV.account.session.user.id);
  function topHTML(it) {
    const t = state.top[it.id];
    if (t) return `<div class="top-offer" title="Highest offer so far">🏆 Top offer: <strong>${AV.money(t.amount)}</strong> by ${AV.avatarHTML(t, 'sm')}<strong>${AV.esc(t.by)}</strong></div>`;
    if (!it.bidCount) return '<div class="top-offer none">No offers yet</div>';
    return state.topLoaded ? '' : '<div class="top-offer none">Top offer: loading…</div>';
  }
  function updateDetailTop() {
    const el = openId && document.querySelector('#av-modal #top-offer'); const it = openId && AV.getItem(openId);
    if (el && it) el.outerHTML = topHTML(it).replace('class="top-offer', 'id="top-offer" class="top-offer');
  }

  function filtered() {
    let items = AV.getItems().filter(it => {
      if (state.cat && it.category !== state.cat) return false;
      if (state.deals && !(it.discount > 0)) return false;
      if (state.q && !(`${it.name} ${it.description} ${it.category}`.toLowerCase().includes(state.q))) return false;
      return true;
    });
    const live = it => (it.sold || it.endsAt < Date.now()) ? 1 : 0;
    const sorters = {
      ending: (a, b) => a.endsAt - b.endsAt,
      newest: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
      low: (a, b) => a.currentBid - b.currentBid,
      high: (a, b) => b.currentBid - a.currentBid,
      deals: (a, b) => (b.discount || 0) - (a.discount || 0)
    };
    return items.slice().sort((a, b) => live(a) - live(b) || sorters[state.sort](a, b));
  }

  function priceBlock(it) {
    const d = Number(it.discount) || 0;
    return d > 0
      ? `<div class="bin">Full price: <span class="strike">${AV.money(it.buyNow)}</span><span class="sale-price">${AV.money(AV.salePrice(it))}</span></div>`
      : `<div class="bin">Full price: <strong>${AV.money(it.buyNow)}</strong></div>`;
  }
  function badges(it) {
    let b = '';
    if (it.discount > 0) b += `<span class="badge">${Math.round(it.discount)}% OFF</span>`;
    if (it.sold) b += `<span class="badge sold">SOLD</span>`;
    else if (it.source === 'seller') b += `<span class="badge new">NEW</span>`;
    if (isMine(it)) b += `<span class="badge mine">YOUR LISTING</span>`;
    return b;
  }
  const offerLine = n => `${n ? 'Highest offer' : 'Starting offer'} · ${n} offer${n === 1 ? '' : 's'}`;
  // Server messages say "bid"; show them in offer wording.
  const offerWords = t => String(t || '').replace(/\bbids\b/g, 'offers').replace(/\bbid\b/g, 'offer').replace(/\bBid\b/g, 'Offer');
  const timerText = (it, tl, suffix) => it.sold ? 'Sold' : tl.ended ? 'Ended' : '⏱ ' + tl.text + (suffix || '');

  function render() {
    if (!state.loaded) return;
    const items = filtered();
    $('#count').textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;
    if (!items.length) { $('#grid').innerHTML = `<div class="empty">${AV.getItems().length ? 'No items match your search.' : 'No items are listed right now. Check back soon!'}</div>`; return; }
    $('#grid').innerHTML = items.map(it => {
      const tl = AV.timeLeft(it.endsAt); const closed = it.sold || tl.ended;
      const n = it.bidCount;
      return `<article class="card" data-id="${AV.esc(it.id)}">
        ${AV.thumbHTML(it, badges(it))}
        <div class="card-body">
          <div class="cat">${AV.esc(it.category)}</div>
          <div class="card-title">${AV.esc(it.name)}</div>
          ${listerHTML(it)}
          <div class="bid-line">${offerLine(n)}</div>
          <div class="bid-amt">${AV.money(n ? it.currentBid : it.startBid)}</div>
          ${topHTML(it)}
          ${priceBlock(it)}
          <div class="timer ${tl.ending && !closed ? 'ending' : ''}" data-ends="${it.endsAt}" ${it.sold ? 'data-sold="1"' : ''}>${timerText(it, tl)}</div>
        </div>
        <div class="card-actions">
          <button class="btn" data-act="bid" ${closed ? 'disabled' : ''}>Make an offer</button>
          <button class="btn outline" data-act="buy" ${closed ? 'disabled' : ''}>Offer full price</button>
        </div>
      </article>`;
    }).join('');
  }

  function tick() {
    let justEnded = false;
    document.querySelectorAll('#grid .timer[data-ends]').forEach(el => {
      if (el.dataset.sold || el.textContent === 'Ended') return;
      const tl = AV.timeLeft(Number(el.dataset.ends));
      if (tl.ended) justEnded = true;
      el.textContent = tl.ended ? 'Ended' : '⏱ ' + tl.text; el.classList.toggle('ending', tl.ending);
    });
    if (justEnded) render(); // disable offer buttons on auctions that just ended (never relisted)
    if (openId) { const t = document.querySelector('#av-modal .timer'); if (t && !t.dataset.sold) { const tl = AV.timeLeft(Number(t.dataset.ends)); t.textContent = tl.ended ? 'Ended' : '⏱ ' + tl.text + ' left'; } }
  }

  function onGridClick(e) {
    const card = e.target.closest('.card'); if (!card) return;
    const id = card.dataset.id; const act = e.target.closest('[data-act]');
    if (act && act.dataset.act === 'buy') return buyNow(id);
    openDetail(id, act && act.dataset.act === 'bid');
  }

  // "Offer full price" (buy_now in the database): confirm the offer, then hand over to the cash-only meet-up flow.
  // The item is marked sold in the database (buy_now RPC) when the buyer confirms the last step.
  function buyNow(id) {
    const it = AV.getItem(id); if (!it || it.sold) return;
    if (needsLogin() || isMine(it)) return openDetail(id); // shows the sign-in prompt / "your listing" note
    const price = AV.salePrice(it);
    const body = AV.openModal(`<div class="bin-confirm">
        <div class="pu-item"><span class="pu-emoji" aria-hidden="true">${AV.esc(it.emoji || '📦')}</span>
          <div><div class="cat">${AV.esc(it.category)}</div><strong>${AV.esc(it.name)}</strong></div>
          <div class="pu-price">${AV.money(price)}</div></div>
        <h2>Offer full price?</h2>
        <p>You're offering <strong>${AV.money(price)}</strong> for <strong>${AV.esc(it.name)}</strong> — the full price${it.discount > 0 ? ` <span class="muted">(${Math.round(it.discount)}% off ${AV.money(it.buyNow)})</span>` : ''}. A full-price offer wins it straight away.</p>
        <p>You'll pay <strong>${AV.money(price)}</strong> in cash at a school meet-up you choose next — no cards.</p>
        <div class="msg err" id="bin-msg" role="alert"></div>
        <div class="pu-nav"><button class="btn outline" type="button" data-cancel>Cancel</button><button class="btn" type="button" data-confirm>Confirm offer</button></div>
      </div>`);
    body.querySelector('[data-cancel]').addEventListener('click', AV.closeModal);
    const btn = body.querySelector('[data-confirm]');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      let fresh;
      try { fresh = await AV.db.loadItem(id); } catch (e) { btn.disabled = false; body.querySelector('#bin-msg').textContent = AV.db.friendly(e); return; }
      if (!fresh || fresh.sold || fresh.endsAt < Date.now()) { AV.toast('Sorry, this listing has closed.'); AV.closeModal(); render(); return; }
      AV.startPickup({ itemId: fresh.id, item: fresh.name, emoji: fresh.emoji, price: AV.salePrice(fresh), type: 'Buy It Now' });
    });
  }

  function arrangeBidPickup(it, amt, banner) {
    AV.startPickup({ itemId: it.id, item: it.name, emoji: it.emoji, price: amt, type: 'Highest bid', banner });
  }
  function needsBidPickup(it) {
    const mine = AV.myBid(it.id);
    if (!mine || it.sold || Number(mine) !== Number(it.currentBid)) return false;
    return !AV.getPickups().some(p => p.itemId === it.id && p.type === 'Highest bid' && Number(p.price) === Number(mine));
  }

  function historyHTML(bids) {
    return `<strong>Offer history</strong>${bids.length ? bids.map(b => `<div class="bid-row">${AV.avatarHTML(b, 'sm')}<span class="bid-who"><strong>${AV.esc(b.by)}</strong>${b.username ? ` <span class="muted">@${AV.esc(b.username)}</span>` : ''}</span><span class="bid-val">${AV.money(b.amount)}</span><span class="bid-when muted">${AV.esc(new Date(b.at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))}</span></div>`).join('') : '<div>No offers yet. Be the first!</div>'}`;
  }

  /* Buyer accounts (supabase/migration_005.sql): once switched on, offers need a signed-in buyer
     with a profile, whose avatar + display name show on the offer. Before that, the old name box is used. */
  const acct = () => AV.account;
  const needsLogin = () => acct().ready && !(acct().session && acct().profile);
  function loginBoxHTML(what) {
    const a = acct();
    const finish = a.session && !a.profile;
    return `<div class="login-box">
      <div class="login-ico" aria-hidden="true">🔒</div>
      <div><strong>${finish ? 'Finish your profile' : 'Sign in'} to ${what}</strong>
        <p class="muted">Your avatar and display name show next to your offers.</p>
        <div class="login-actions">${finish ? '<a class="btn" href="account.html">Finish profile</a>'
          : `<a class="btn" href="${AV.esc(AV.accountURL())}">Sign in</a><a class="btn outline" href="${AV.esc(AV.accountURL('signup'))}">Create account</a>`}</div></div></div>`;
  }
  function offeringAsHTML() {
    const p = acct().profile;
    return `<div class="offering-as">${AV.avatarHTML(p)}<span>Offering as <strong>${AV.esc(p.display_name)}</strong></span><a href="account.html" class="muted">Edit</a></div>`;
  }

  function openDetail(id, focusBid) {
    const it = AV.getItem(id); if (!it) return;
    const tl = AV.timeLeft(it.endsAt); const closed = it.sold || tl.ended;
    const n = it.bidCount; const min = AV.minNextBid(it);
    const buyer = AV.read(AV.KEYS.buyer, {}) || {};
    const body = AV.openModal(`<div class="detail">
        <div>${AV.thumbHTML(it, badges(it))}</div>
        <div>
          <div class="cat">${AV.esc(it.category)}</div>
          <h2 style="letter-spacing:.06em">${AV.esc(it.name)}</h2>
          <div id="listed-by">${listerHTML(it)}</div>
          <button class="btn outline small" type="button" id="copy-link" data-link="${AV.esc(itemLink(it.id))}" style="margin-bottom:10px">🔗 Copy link</button>
          <p>${AV.esc(it.description || 'No description provided.')}</p>
          <div class="bid-line">${offerLine(n)}</div>
          <div class="bid-amt" style="font-size:1.8rem">${AV.money(n ? it.currentBid : it.startBid)}</div>
          ${topHTML(it).replace('class="top-offer', 'id="top-offer" class="top-offer')}
          <div class="timer ${tl.ending && !closed ? 'ending' : ''}" data-ends="${it.endsAt}" ${it.sold ? 'data-sold="1"' : ''}>${timerText(it, tl, ' left')}</div>
          ${closed ? `<p class="msg err">${it.sold ? 'This item has been sold.' : 'This auction has ended.'}</p>` : isMine(it) ? `
          <div class="login-box own-listing"><div class="login-ico" aria-hidden="true">🏷️</div><div><strong>This is your listing</strong>
            <p class="muted">You can't make offers on your own item. Edit it, change the discount or mark it sold on the Listing tab.</p>
            <div class="login-actions"><a class="btn" href="listing.html">Manage on Listing</a></div></div></div>
          ${priceBlock(it)}` : needsLogin() ? `
          <div class="muted" style="font-size:.85rem;margin:6px 0">Offer ${AV.money(min)} or more.</div>
          ${loginBoxHTML('make an offer')}
          <hr style="border:0;border-top:1px solid var(--grey-light);margin:14px 0">
          ${priceBlock(it)}` : `
          <form class="bid-form" id="bid-form">
            <input type="number" id="bid-amt" min="${min}" step="0.01" value="${min}" aria-label="Your offer">
            <button class="btn" type="submit">Make offer</button>
          </form>
          ${acct().ready ? offeringAsHTML() : `<input id="bid-name" maxlength="60" placeholder="Your name (shown in offer history)" aria-label="Your name" value="${AV.esc(buyer.name || '')}" style="width:100%;margin-top:8px;padding:10px;border:1px solid #cfd2d6;border-radius:8px;font:inherit">
          <span class="field-err" id="bid-name-err" aria-live="polite"></span>
          <div class="muted" id="bid-name-hint" style="font-size:.8rem">Enter your name to make an offer.</div>`}
          <div class="muted" style="font-size:.8rem">Offer ${AV.money(min)} or more.</div>
          <p class="offer-note">💵 Highest offer wins. Pay cash at the meet-up — no cards.</p>
          <div class="msg" id="bid-msg" role="alert"></div>
          <hr style="border:0;border-top:1px solid var(--grey-light);margin:14px 0">
          ${priceBlock(it)}
          <button class="btn outline" id="bin" style="margin-top:8px;width:100%">Offer full price — ${AV.money(AV.salePrice(it))}</button>`}
          ${!closed && needsBidPickup(it) ? `<button class="btn grey" id="arrange" style="margin-top:8px;width:100%">Arrange cash pickup for your ${AV.money(it.currentBid)} offer</button>` : ''}
          <div class="history" id="history"><strong>Offer history</strong><div>${n ? 'Loading…' : 'No offers yet. Be the first!'}</div></div>
        </div></div>`);
    openId = id;
    setItemParam(id);
    body.querySelector('#copy-link').addEventListener('click', () => copyLink(id));
    if (n) AV.db.itemBids(id).then(b => {
      const h = body.querySelector('#history'); if (h) h.innerHTML = historyHTML(b);
      const top = b.reduce((a, x) => (!a || x.amount > a.amount) ? x : a, null);
      if (top) { state.top[id] = top; if (openId === id) updateDetailTop(); }
    })
      .catch(() => { const h = body.querySelector('#history'); if (h) h.innerHTML = '<strong>Offer history</strong><div>Offer history is unavailable right now.</div>'; });
    const form = body.querySelector('#bid-form');
    if (form) {
      if (focusBid) body.querySelector('#bid-amt').focus();
      // Your name is checked as you type (no joke or rude names); "Make offer" stays disabled until it passes.
      const nameInput = body.querySelector('#bid-name'), hint = body.querySelector('#bid-name-hint');
      const watch = nameInput ? AV.watchEntries([{ input: nameInput, field: 'name', note: body.querySelector('#bid-name-err') }], form.querySelector('button'),
        () => { hint.hidden = nameInput.value.trim() !== ''; }) : { valid: () => true, reject() {} };
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const amt = Math.round(parseFloat(body.querySelector('#bid-amt').value) * 100) / 100;
        const name = nameInput ? nameInput.value.trim() : (acct().profile && acct().profile.display_name) || '';
        const msg = body.querySelector('#bid-msg'); const btn = form.querySelector('button');
        const err = t => { msg.className = 'msg err'; msg.textContent = t; };
        const cur = AV.getItem(id); const need = AV.minNextBid(cur);
        if (!(amt >= need)) return err(`Your offer must be at least ${AV.money(need)}.`);
        if (!watch.valid()) { nameInput.focus(); return; }
        if (name.length < 2) { if (nameInput) nameInput.focus(); return err('Please enter your name so the seller knows who made the offer.'); }
        if (cur.endsAt < Date.now() || cur.sold) return err('Sorry, this listing has closed.');
        btn.disabled = true; msg.className = 'msg'; msg.textContent = 'Sending your offer…';
        let r;
        try { r = await AV.db.placeBid(id, amt, name); }
        catch (ex) { btn.disabled = false; return err(AV.db.friendly(ex)); }
        btn.disabled = false;
        const bad = AV.entryError(r);
        if (bad && nameInput) { msg.className = 'msg'; msg.textContent = ''; watch.reject('name', name); nameInput.focus(); return; }
        if (r && (r.error === 'login_required' || r.error === 'profile_required')) {
          msg.className = 'msg'; msg.innerHTML = loginBoxHTML('make an offer'); return;
        }
        if (!r || !r.ok) {
          err(offerWords((r && r.message) || 'Your offer was not accepted.'));
          AV.db.loadItem(id).then(render).catch(() => {});
          return;
        }
        Object.assign(cur, { currentBid: Number(r.current_bid), bidCount: Number(r.bid_count) });
        AV.setMyBid(id, Number(r.current_bid));
        const p = acct().profile;
        state.top[id] = { amount: Number(r.current_bid), by: r.bidder_name || name, at: Date.now(), username: r.username || (p && p.username) || '',
          emoji: r.avatar_emoji || (p && p.avatar_emoji) || '', color: r.avatar_color || (p && p.avatar_color) || '' };
        if (nameInput) { const saved = AV.read(AV.KEYS.buyer, {}) || {}; AV.write(AV.KEYS.buyer, Object.assign(saved, { name })); }
        render();
        // Offer accepted → cash-only meet-up flow.
        arrangeBidPickup(cur, Number(r.current_bid), `✅ Your ${AV.money(r.current_bid)} offer is in — it's the highest offer right now!`);
      });
      body.querySelector('#bin').addEventListener('click', () => buyNow(id));
    }
    const arr = body.querySelector('#arrange');
    if (arr) arr.addEventListener('click', () => { const f = AV.getItem(id); arrangeBidPickup(f, f.currentBid); });
  }

  AV.onModalClose = () => { openId = null; setItemParam(null); };
  // Account state arrives after the first paint: refresh an open item so the offer box matches.
  let lastAcct = '';
  AV.onAccount(a => {
    const key = [a.ready, a.session && a.session.user.id, a.profile && a.profile.display_name].join('|');
    if (key === lastAcct) return; const first = !lastAcct; lastAcct = key;
    if (state.loaded) render();
    if (!first && openId && !document.querySelector('#av-modal input:focus')) openDetail(openId);
    else if (first && openId && a.ready) openDetail(openId);
  });
  AV.onDataChange = render;
  document.addEventListener('DOMContentLoaded', init);
})();
