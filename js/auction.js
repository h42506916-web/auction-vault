/* Auction page: grid, search/filter, detail modal, bidding, Buy It Now */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const state = { q: '', cat: '', sort: 'ending', deals: false };
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
    const hash = decodeURIComponent(location.hash.slice(1)); if (hash) setTimeout(() => openDetail(hash), 50);
    render();
    setInterval(tick, 1000);
  }
  function syncChips() { document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.cat === state.cat)); }

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
    return items.sort((a, b) => live(a) - live(b) || sorters[state.sort](a, b));
  }

  function priceBlock(it) {
    const d = Number(it.discount) || 0;
    return d > 0
      ? `<div class="bin">Buy It Now: <span class="strike">${AV.money(it.buyNow)}</span><span class="sale-price">${AV.money(AV.salePrice(it))}</span></div>`
      : `<div class="bin">Buy It Now: <strong>${AV.money(it.buyNow)}</strong></div>`;
  }
  function badges(it) {
    let b = '';
    if (it.discount > 0) b += `<span class="badge">${Math.round(it.discount)}% OFF</span>`;
    if (it.sold) b += `<span class="badge sold">SOLD</span>`;
    else if (it.source === 'seller') b += `<span class="badge new">NEW</span>`;
    return b;
  }

  function render() {
    const items = filtered();
    $('#count').textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;
    if (!items.length) { $('#grid').innerHTML = '<div class="empty">No items match your search.</div>'; return; }
    $('#grid').innerHTML = items.map(it => {
      const tl = AV.timeLeft(it.endsAt); const closed = it.sold || tl.ended;
      const n = (it.bids || []).length;
      return `<article class="card" data-id="${AV.esc(it.id)}">
        ${AV.thumbHTML(it, badges(it))}
        <div class="card-body">
          <div class="cat">${AV.esc(it.category)}</div>
          <div class="card-title">${AV.esc(it.name)}</div>
          <div class="bid-line">${n ? 'Current bid' : 'Starting bid'} · ${n} bid${n === 1 ? '' : 's'}</div>
          <div class="bid-amt">${AV.money(n ? it.currentBid : it.startBid)}</div>
          ${priceBlock(it)}
          <div class="timer ${tl.ending ? 'ending' : ''}" data-ends="${it.endsAt}">${it.sold ? 'Sold' : '⏱ ' + tl.text}</div>
        </div>
        <div class="card-actions">
          <button class="btn" data-act="bid" ${closed ? 'disabled' : ''}>Bid</button>
          <button class="btn outline" data-act="buy" ${closed ? 'disabled' : ''}>Buy It Now</button>
        </div>
      </article>`;
    }).join('');
  }

  function tick() {
    document.querySelectorAll('.timer[data-ends]').forEach(el => {
      if (el.textContent === 'Sold') return;
      const tl = AV.timeLeft(Number(el.dataset.ends));
      el.textContent = '⏱ ' + tl.text; el.classList.toggle('ending', tl.ending);
    });
    if (openId) { const t = document.querySelector('#av-modal .timer'); if (t) { const tl = AV.timeLeft(Number(t.dataset.ends)); t.textContent = t.dataset.sold ? 'Sold' : '⏱ ' + tl.text + (tl.ended ? '' : ' left'); } }
  }

  function onGridClick(e) {
    const card = e.target.closest('.card'); if (!card) return;
    const id = card.dataset.id; const act = e.target.closest('[data-act]');
    if (act && act.dataset.act === 'buy') return buyNow(id);
    openDetail(id, act && act.dataset.act === 'bid');
  }

  // Buy It Now: confirm the offer, then hand over to the cash-only pickup flow (no cart / card payment).
  function buyNow(id) {
    const it = AV.getItem(id); if (!it || it.sold) return;
    const price = AV.salePrice(it);
    const body = AV.openModal(`<div class="bin-confirm">
        <div class="pu-item"><span class="pu-emoji" aria-hidden="true">${AV.esc(it.emoji || '📦')}</span>
          <div><div class="cat">${AV.esc(it.category)}</div><strong>${AV.esc(it.name)}</strong></div>
          <div class="pu-price">${AV.money(price)}</div></div>
        <h2>Buy It Now?</h2>
        <p>You're offering to buy <strong>${AV.esc(it.name)}</strong> for <strong>${AV.money(price)}</strong>${it.discount > 0 ? ` <span class="muted">(${Math.round(it.discount)}% off ${AV.money(it.buyNow)})</span>` : ''}.
        Payment is <strong>cash only</strong>, at a school meet-up you'll choose next.</p>
        <div class="pu-nav"><button class="btn outline" type="button" data-cancel>Cancel</button><button class="btn" type="button" data-confirm>Confirm offer</button></div>
      </div>`);
    body.querySelector('[data-cancel]').addEventListener('click', AV.closeModal);
    body.querySelector('[data-confirm]').addEventListener('click', () => {
      const fresh = AV.getItem(id);
      if (!fresh || fresh.sold || fresh.endsAt < Date.now()) { AV.toast('Sorry, this listing has closed.'); AV.closeModal(); render(); return; }
      AV.startPickup({ itemId: fresh.id, item: fresh.name, emoji: fresh.emoji, price: AV.salePrice(fresh), type: 'Buy It Now' });
    });
  }

  function arrangeBidPickup(it, amt, banner) {
    AV.startPickup({ itemId: it.id, item: it.name, emoji: it.emoji, price: amt, type: 'Highest bid', banner });
  }
  function needsBidPickup(it) {
    const last = (it.bids || []).slice(-1)[0];
    if (!last || last.by !== 'You' || it.sold) return false;
    return !AV.getPickups().some(p => p.itemId === it.id && p.type === 'Highest bid' && p.price === last.amount);
  }

  function openDetail(id, focusBid) {
    const it = AV.getItem(id); if (!it) return;
    const tl = AV.timeLeft(it.endsAt); const closed = it.sold || tl.ended;
    const n = (it.bids || []).length; const min = AV.minNextBid(it);
    const body = AV.openModal(`<div class="detail">
        <div>${AV.thumbHTML(it, badges(it))}</div>
        <div>
          <div class="cat">${AV.esc(it.category)}</div>
          <h2 style="letter-spacing:.06em">${AV.esc(it.name)}</h2>
          <p>${AV.esc(it.description || 'No description provided.')}</p>
          <div class="bid-line">${n ? 'Current bid' : 'Starting bid'} · ${n} bid${n === 1 ? '' : 's'}</div>
          <div class="bid-amt" style="font-size:1.8rem">${AV.money(n ? it.currentBid : it.startBid)}</div>
          <div class="timer ${tl.ending ? 'ending' : ''}" data-ends="${it.endsAt}" ${it.sold ? 'data-sold="1"' : ''}>${it.sold ? 'Sold' : '⏱ ' + tl.text + (tl.ended ? '' : ' left')}</div>
          ${closed ? '<p class="msg err">This listing has closed.</p>' : `
          <form class="bid-form" id="bid-form">
            <input type="number" id="bid-amt" min="${min}" step="0.01" value="${min}" aria-label="Your bid">
            <button class="btn" type="submit">Place Bid</button>
          </form>
          <div class="muted" style="font-size:.8rem">Enter ${AV.money(min)} or more.</div>
          <div class="msg" id="bid-msg"></div>
          <hr style="border:0;border-top:1px solid var(--grey-light);margin:14px 0">
          ${priceBlock(it)}
          <button class="btn outline" id="bin" style="margin-top:8px;width:100%">Buy It Now for ${AV.money(AV.salePrice(it))}</button>`}
          ${!closed && needsBidPickup(it) ? `<button class="btn grey" id="arrange" style="margin-top:8px;width:100%">Arrange cash pickup for your ${AV.money(it.currentBid)} bid</button>` : ''}
          <div class="history"><strong>Bid history</strong>${n ? it.bids.slice().reverse().map(b => `<div>${AV.money(b.amount)} — ${AV.esc(b.by)} · ${new Date(b.at).toLocaleString()}</div>`).join('') : '<div>No bids yet. Be the first!</div>'}</div>
        </div></div>`);
    openId = id;
    history.replaceState(null, '', '#' + encodeURIComponent(id));
    const form = body.querySelector('#bid-form');
    if (form) {
      if (focusBid) body.querySelector('#bid-amt').focus();
      form.addEventListener('submit', e => {
        e.preventDefault();
        const amt = Math.round(parseFloat(body.querySelector('#bid-amt').value) * 100) / 100;
        const msg = body.querySelector('#bid-msg');
        const fresh = AV.getItem(id);
        const need = AV.minNextBid(fresh);
        if (!(amt >= need)) { msg.className = 'msg err'; msg.textContent = `Your bid must be at least ${AV.money(need)}.`; return; }
        if (fresh.endsAt < Date.now() || fresh.sold) { msg.className = 'msg err'; msg.textContent = 'Sorry, this listing has closed.'; return; }
        AV.updateItem(id, x => { x.currentBid = amt; x.bids = x.bids || []; x.bids.push({ amount: amt, by: 'You', at: Date.now() }); });
        render();
        // Bid accepted = offer confirmed → cash-only pickup flow.
        arrangeBidPickup(AV.getItem(id), amt, `✅ Bid of ${AV.money(amt)} placed — you're the highest bidder!`);
      });
      body.querySelector('#bin').addEventListener('click', () => buyNow(id));
      const arr = body.querySelector('#arrange');
      if (arr) arr.addEventListener('click', () => { const f = AV.getItem(id); arrangeBidPickup(f, f.currentBid); });
    }
  }

  AV.onModalClose = () => { openId = null; if (location.hash) history.replaceState(null, '', location.pathname + location.search); };
  AV.onDataChange = render;
  document.addEventListener('DOMContentLoaded', init);
})();
