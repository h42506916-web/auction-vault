/* Auction Vault — shared helpers: header/footer, modal, offer + cash meet-up flow, secret code.
   Auction items, offers (bids), pickups and storage tiers live in Supabase (see js/db.js).
   No cards or online payments anywhere: buyers make an offer, highest offer wins, cash at the meet-up. */
(function () {
  'use strict';
  const KEYS = { pickups: 'av_pickups_v1', buyer: 'av_buyer_v1', myBids: 'av_my_bids_v1' };
  const SECRET_CODE = 'SCOUT TROOPER!'; // Only a shortcut to seller.html — the dashboard itself needs an email sign-in.
  const OWNER_PHONE = '455982359';
  const HOUR = 3600 * 1000;

  const CATEGORIES = ['Electronics', 'Collectibles', 'Tools', 'Fashion', 'Home & Garden', 'Sports', 'Toys & Games', 'Music', 'Other'];

  function read(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function write(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { console.warn('localStorage unavailable', e); } }

  // Items come from Supabase (AV.db); these read the copy loaded on this page.
  function getItems() { return (window.AV && AV.db) ? AV.db.items : []; }
  function getItem(id) { return (window.AV && AV.db) ? AV.db.cached(id) : null; }

  function salePrice(it) {
    const d = Math.min(95, Math.max(0, Number(it.discount) || 0));
    return Math.round(it.buyNow * (100 - d)) / 100;
  }
  // Must match public.min_next_bid() in supabase/schema.sql
  function minNextBid(it) {
    const cur = Number(it.currentBid) || 0;
    const step = cur < 50 ? 1 : cur < 200 ? 5 : 10;
    return (Number(it.bidCount) || 0) > 0 ? cur + step : (Number(it.startBid) || 0);
  }
  // Remember bids made from this browser (to offer "Arrange cash pickup" later)
  function myBid(id) { return (read(KEYS.myBids, {}) || {})[id]; }
  function setMyBid(id, amt) { const m = read(KEYS.myBids, {}) || {}; m[id] = amt; write(KEYS.myBids, m); }

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

  /* ---------- Buyer entry check (name / class / contact on every offer + pickup form) ----------
     Rejects joke or fake entries: placeholder words, keyboard mash and rude words (incl. leetspeak
     and spaced-out letters). Any genuine name is fine — first name only, nicknames, hyphens,
     apostrophes and non-English letters all pass. The database repeats a simpler version of this
     (public.is_bad_entry / is_bad_name in supabase/migration_003.sql), so it can't be bypassed. */
  const ENTRY_MSG_NAME = 'Invalid — please enter your real name';
  const ENTRY_MSG = 'Invalid entry';
  const ENTRY_RULES = {
    // whole-entry placeholders (an entry made only of these words / numbers is rejected)
    placeholders: ('test tests testing tester testname asdf asdfg asdfgh asdfghjkl asd sdf dfg jkl qwe qwer qwert qwerty ' +
      'zxc zxcv abc abcd abcde abcdef abcdefg xyz aaa xxx zzz none nothing na nil null undefined idk dunno name myname ' +
      'yourname noname firstname lastname fullname surname blah blahblah bla fake fakename anonymous anon nobody noone ' +
      'someone somebody unknown lol lmao lmfao rofl lel xd haha hehe hello hi hey hiya yo sdfsdf jkljkl foo foobar user ' +
      'username guest me myself nope no nah yes yeah ok okay whatever random idc student person human thing stuff ' +
      'class contact phone email number mobile n/a').split(' '),
    // rude words matched as a whole word (plurals and compounds like "...head" / "...face" too)
    whole: ('shit shite shitty shitter crap crappy cunt dick cock prick twat tit tits titty titties boob boobs booby ass arse ' +
      'asshat butthole buttface bastard piss pissed pisser wank bollocks bollock bugger slut slag skank douche douchebag ' +
      'idiot stupid dumb moron loser retard retarded poop poopy sex sexy porn porno nude nudes nazi hitler kys stfu gtfo ' +
      'wtf omfg milf cum jizz spunk knob knobhead nob bellend tosser pussy fag fags chink spic kike wog paki gook tranny ' +
      'homo lesbo rape rapist pedo paedo pedophile paedophile suck sucks balls fart turd booger ugly fatso fatty noob ' +
      'fuk fuq fck fcuk fuc fk fkn fking effing phuk phuck biatch penis vagina').split(' '),
    // rude words caught even inside a longer word ("dumbass", "fuuuck", "b1tches")
    embed: ('fuck motherf nigger nigga faggot bitch asshole arsehole dickhead shithead bullshit horseshit chickenshit ' +
      'batshit apeshit dipshit cocksucker wanker whore dumbass jackass smartass fatass lardass kissass badass retard dildo ' +
      'blowjob handjob jizz pussy twat').split(' '),
    compounds: 'head face hole hat bag wad wipe stain lord licker sucker nugget brain weasel'.split(' '),
    // joke names
    phrases: ['ben dover', 'bend over', 'mike hunt', 'mike hawk', 'mike oxlong', 'mike litoris', 'hugh jass', 'hugh janus',
      'amanda hugginkiss', 'seymour butts', 'harry balls', 'joe mama', 'yo mama', 'ur mom', 'your mom', 'ur mum', 'your mum',
      'deez nuts', 'ligma', 'sugma', 'phil mccracken', 'dixie normous', 'ivana tinkle', 'heywood jablome', 'moe lester',
      'john doe', 'jane doe', 'joe bloggs', 'your name', 'my name', 'first last', 'first name', 'last name'],
    // keyboard mash (4-letter runs that never appear in real names, plus any 5-letter run along a key row)
    keys4: 'asdf sdfg dfgh fghj ghjk hjkl qwer zxcv xcvb cvbn vbnm poiu lkjh kjhg jhgf hgfd gfds fdsa rewq vcxz mnbv bvcx'.split(' '),
    rows: ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']
  };
  // letters and the look-alikes people use to dodge filters (sh1t, f*ck, a$$, b!tch)
  const LEET = { a: 'a4@', b: 'b8', e: 'e3', g: 'g9', i: 'i1!|', l: 'l1|', o: 'o0', s: 's5$', t: 't7+', u: 'uv' };
  const leetWord = w => w.split('').map(c => '[' + (LEET[c] || c) + '*]+').join('');
  const RX = (() => {
    const R = ENTRY_RULES;
    const keyRuns = R.keys4.slice();
    R.rows.forEach(r => { for (const s of [r, r.split('').reverse().join('')]) for (let i = 0; i + 5 <= s.length; i++) keyRuns.push(s.slice(i, i + 5)); });
    return {
      whole: new RegExp('^(?:' + R.whole.map(leetWord).join('|') + ')(?:e?s)?(?:(?:' + R.compounds.join('|') + ')(?:e?s)?)?$'),
      embed: new RegExp(R.embed.map(leetWord).join('|')),
      keys: new RegExp(keyRuns.join('|')),
      placeholders: new Set(R.placeholders.map(p => p.replace(/[^a-z]/g, '')))
    };
  })();

  // → { ok: true } or { ok: false, reason, message }. field: 'name' (required) | 'class' | 'contact' (optional)
  function validateEntry(value, field) {
    field = field === 'cls' ? 'class' : (field || 'name');
    const isName = field === 'name', isContact = field === 'contact';
    const message = isName ? ENTRY_MSG_NAME : ENTRY_MSG;
    const bad = reason => ({ ok: false, reason, message });
    const raw = String(value == null ? '' : value).replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').normalize('NFC').trim();
    if (!raw) return isName ? bad('empty') : { ok: true };
    if (isName && !/\p{L}/u.test(raw)) return bad('no_letters');
    if (isName && raw.length < 2) return bad('too_short');
    if (!isName && !/[\p{L}\p{N}]/u.test(raw)) return bad('symbols_only');

    const base = raw.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
    const isEmail = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(base); // split emails at the @ (any field, same as the database)
    // split into words; * $ @ ! | + stay inside a word because they stand in for letters
    const parts = base.split(isEmail ? /[^\p{L}\p{N}*$!|+]+/u : /[^\p{L}\p{N}*$@!|+]+/u).filter(Boolean);
    // "f u c k", "n/a", "a.s.s" → join runs of single characters into one word
    const toks = [];
    let run = '';
    for (const p of parts) {
      if ([...p].length === 1) { run += p; continue; }
      if (run) { toks.push(run); run = ''; }
      toks.push(p);
    }
    if (run) toks.push(run);
    if (!toks.length) return bad('symbols_only');

    // placeholders: the whole entry is only placeholder words (and numbers)
    const own = isEmail ? base.split('@')[0].split(/[^\p{L}\p{N}]+/u).filter(Boolean) : toks; // test@test.com → "test"
    const plain = own.map(t => t.replace(/[*$@!|+]/g, '').replace(/^\d+|\d+$/g, ''));
    if (plain.some(t => RX.placeholders.has(t)) && plain.every(t => !t || RX.placeholders.has(t))) return bad('placeholder');

    for (const t of toks) {
      const letters = t.replace(/[^a-z]/g, '');
      // rude words (only checked on words with a letter in them, so phone numbers are left alone)
      if (letters && (RX.whole.test(t) || RX.embed.test(t))) return bad('rude');
      // keyboard mash
      if (letters && RX.keys.test(letters)) return bad('mash');
      if (/^(.{2,4})\1{2,}$/.test(t)) return bad('mash');                       // hahaha, asdasdasd
      const rep = /^(.{2,4})\1+$/.exec(t);                                       // asdasd, testtest
      if (rep && RX.placeholders.has(rep[1])) return bad('mash');
      if (isContact ? /(\p{L})\1{3}/u.test(t) : /(\p{L})\1{2}/u.test(t)) return bad('mash'); // aaaa
      if (!isContact && /^[a-z]{5,}$/.test(t) && !/[aeiouy]/.test(t)) return bad('mash');     // no vowels
      if ([...t].length > 40 && !(isContact && isEmail)) return bad('too_long');
    }

    const spaced = ' ' + toks.join(' ') + ' ', compact = toks.join('');
    for (const ph of ENTRY_RULES.phrases) {
      const c = ph.replace(/ /g, '');
      if (spaced.includes(' ' + ph + ' ') || compact === c || toks.includes(c)) return bad('joke');
    }
    return { ok: true };
  }
  // Database rejection of a buyer entry (supabase/migration_003.sql) → field + message, else null
  function entryError(r) {
    const code = r && (r.error || r.code);
    if (code !== 'invalid_entry' && code !== 'bad_name') return null;
    const field = r.field === 'class' ? 'cls' : (r.field === 'contact' ? 'contact' : 'name');
    return { field, message: field === 'name' ? ENTRY_MSG_NAME : ENTRY_MSG };
  }
  /* Live-check a set of inputs: an "Invalid" note under each bad field and the submit button disabled
     until every field passes. fields: [{ input, field, note? }]. Returns { valid(), reject(field, value) }. */
  function watchEntries(fields, button, onChange) {
    const rejected = {}; // values the database refused (kept invalid until changed)
    const check = f => {
      const v = f.input.value;
      if (rejected[f.field] != null && v.trim() === rejected[f.field]) return { ok: false, message: f.field === 'name' ? ENTRY_MSG_NAME : ENTRY_MSG };
      return validateEntry(v, f.field);
    };
    const show = (f, r) => {
      let el = f.note;
      if (!el) { el = document.createElement('span'); el.className = 'field-err'; el.setAttribute('aria-live', 'polite'); f.input.insertAdjacentElement('afterend', el); f.note = el; }
      const visible = !r.ok && f.touched;
      el.textContent = visible ? r.message : '';
      if (visible) f.input.setAttribute('aria-invalid', 'true'); else f.input.removeAttribute('aria-invalid');
    };
    const update = () => {
      let all = true;
      fields.forEach(f => { const r = check(f); if (!r.ok) all = false; show(f, r); });
      if (button) button.disabled = !all;
      if (onChange) onChange(all);
      return all;
    };
    fields.forEach(f => {
      f.touched = f.input.value.trim() !== ''; // prefilled values are checked straight away
      let t;
      f.input.addEventListener('input', () => {
        clearTimeout(t);
        if (f.input.getAttribute('aria-invalid')) update();                    // clear the note as soon as it's fixed
        else { update(); t = setTimeout(() => { f.touched = f.input.value.trim() !== '' || f.touched; update(); }, 700); }
      });
      f.input.addEventListener('blur', () => { clearTimeout(t); f.touched = true; update(); });
    });
    update();
    return {
      valid: () => { fields.forEach(f => { f.touched = true; }); return update(); },
      reject(field, value) { rejected[field] = String(value || '').trim(); const f = fields.find(x => x.field === field); if (f) f.touched = true; update(); }
    };
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

  /* ---------- Offer + cash-only meet-up, emailed to the owner via FormSubmit ----------
     Used for auction offers, full-price offers and storage vault offers. No cards, ever. */
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
  // purchase_type values stored in the database → wording shown to people
  const TYPE_LABELS = { 'Buy It Now': 'Full-price offer', 'Highest bid': 'Highest offer', 'Vault offer': 'Vault offer' };
  const typeLabel = t => TYPE_LABELS[t] || t;
  const CASH_LINE = 'Highest offer wins. Pay cash at the meet-up — no cards.';

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
    const vault = p.type === 'Vault offer';
    const out = {
      _subject: (vault ? 'New Auction Vault offer: ' : 'New Auction Vault pickup: ') + p.item + ' — ' + money(p.price) + ' cash',
      _template: 'table',
      _captcha: 'false',
      name: p.name,
      class: p.cls || '—',
      contact: p.contact || '—',
      item: p.item,
      offer: money(p.price),
      price: money(p.price),
      purchase_type: p.type,
      offer_type: typeLabel(p.type),
      payment: 'Cash at meet-up (no cards)',
      meetup: p.meetup,
      time: p.time,
      reference: p.id,
      submitted_at: new Date(p.at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })
    };
    if (vault && p.listPrice != null) out.listed_price = money(p.listPrice);
    return out;
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

  // offer: { itemId, item, emoji, price, type: 'Buy It Now' | 'Highest bid' | 'Vault offer', banner?, listPrice? }
  //  - 'Highest bid': the buyer's accepted auction offer (price = their offer)
  //  - 'Buy It Now':  an offer at the full listed price (shown as "Offer full price")
  //  - 'Vault offer': a storage vault offer; the buyer types the amount (listPrice is the guide)
  function startPickup(offer) {
    const saved = read(KEYS.buyer, {}) || {};
    const isVault = offer.type === 'Vault offer';
    const isBid = offer.type === 'Highest bid';
    const isFull = offer.type === 'Buy It Now';
    const prevVault = isVault ? getPickups().find(p => p.itemId === offer.itemId && p.type === 'Vault offer' && !p.collected) : null;
    const st = { i: 0, name: saved.name || '', cls: saved.cls || '', contact: saved.contact || '', meetup: '', time: '',
      amount: isVault ? (prevVault ? Number(prevVault.price) : null) : Number(offer.price), done: false, rejected: null };
    const STEPS = isVault
      ? [['offer', 'Your offer'], ['meetup', 'Meet-up point'], ['time', 'Time'], ['confirm', 'Reminder']]
      : [['cash', 'Cash only'], ['details', 'Your details'], ['meetup', 'Meet-up point'], ['time', 'Time'], ['confirm', 'Confirm']];
    const key = () => STEPS[st.i][0];
    const isForm = () => key() === 'details' || key() === 'offer';
    const body = openModal('<div class="pickup" id="pickup"></div>');
    const root = body.querySelector('#pickup');
    const amt = () => money(st.amount);

    const head = () => `
      ${offer.banner && st.i === 0 ? `<div class="msg ok pu-banner">${esc(offer.banner)}</div>` : ''}
      <div class="pu-item"><span class="pu-emoji" aria-hidden="true">${esc(offer.emoji || '📦')}</span>
        <div><div class="cat">${isVault ? 'Storage vault — make an offer' : isBid ? 'Your offer' : 'Offer full price'}</div>
        <strong>${esc(offer.item)}</strong></div>
        <div class="pu-price">${isVault ? (st.amount ? amt() : `<small class="muted">Guide ${money(offer.listPrice)}</small>`) : amt()}</div></div>
      <ol class="pu-steps" aria-label="Progress">${STEPS.map((n, i) => `<li class="${i < st.i ? 'done' : i === st.i ? 'current' : ''}"><span>${i + 1}</span><em>${n[1]}</em></li>`).join('')}</ol>
      <div class="pu-stepno">Step ${st.i + 1} of ${STEPS.length}</div>`;
    const nav = (nextLabel, nextDisabled) => `<div class="pu-nav">
      ${st.i > 0 ? '<button type="button" class="btn outline" data-nav="back">← Back</button>' : '<span></span>'}
      <button type="${isForm() ? 'submit' : 'button'}" class="btn" data-nav="next" ${nextDisabled ? 'disabled' : ''}>${nextLabel}</button></div>`;
    const options = (list, cur, field) => `<div class="pu-options" role="radiogroup">${list.map(o => `
      <button type="button" class="pu-option ${cur === o.v ? 'selected' : ''}" role="radio" aria-checked="${cur === o.v}" data-${field}="${esc(o.v)}">
        <span class="pu-ico" aria-hidden="true">${o.icon}</span><span>${esc(o.v)}</span></button>`).join('')}</div>`;
    const detailFields = () => `
      <label>Your name<input name="name" required maxlength="60" autocomplete="name" value="${esc(st.name)}"></label>
      <div class="row2"><label>Class (optional)<input name="cls" maxlength="30" placeholder="e.g. 8B" value="${esc(st.cls)}"></label>
      <label>Contact (optional)<input name="contact" maxlength="80" placeholder="Phone or email" value="${esc(st.contact)}"></label></div>`;
    const reminder = () => {
      const lead = isBid ? `You're offering <strong>${amt()}</strong> — the highest offer right now.`
        : isFull ? `You're offering <strong>${amt()}</strong> — the full price.`
        : `You're offering <strong>${amt()}</strong>.`;
      return `<div class="cash-box offer-reminder" id="pu-reminder"><div class="cash-ico" aria-hidden="true">💵</div><div>
        <strong>${lead} Highest offer wins.</strong>
        <p>You'll pay <strong>${amt()}</strong> in cash at the meet-up — no cards.</p></div></div>`;
    };

    function render() {
      let html = '';
      const k = key();
      if (k === 'cash') {
        html = `<h2>Cash only — no cards</h2>
          <div class="cash-box"><div class="cash-ico" aria-hidden="true">💵</div><div>
            <strong>${isBid ? `Your offer: ${amt()}. Highest offer wins.` : `Your offer: ${amt()} (full price).`}</strong>
            <p>You'll pay <strong>${amt()}</strong> in cash when you collect the item at the meet-up. No cards, bank transfers or online payments.</p></div></div>
          <p class="muted pu-note">${isBid ? 'Your offer stands either way — you can also arrange pickup later from the item page.' : 'Closing this window before the last step cancels your offer.'}</p>
          ${nav('Got it — next →')}`;
      } else if (k === 'details') {
        html = `<h2>Who are you?</h2><p class="muted">So the seller knows who to look for.</p>
          <form class="stack" id="pu-form" novalidate>
            ${detailFields()}
            <div class="msg err" id="pu-err" role="alert"></div>
            ${nav('Next →')}
          </form>`;
      } else if (k === 'offer') {
        html = `<h2>Make an offer</h2>
          <p class="muted">${esc(CASH_LINE)}</p>
          <form class="stack" id="pu-form" novalidate>
            <label>Your offer ($)<input name="amount" type="number" inputmode="decimal" min="1" step="0.01" required value="${st.amount ? esc(st.amount) : ''}" placeholder="e.g. ${esc(Number(offer.listPrice) || '')}"></label>
            <div class="muted pu-guide" style="font-size:.85rem">Guide price: <strong>${money(offer.listPrice)}</strong>. Offer what you like — the highest offer wins.</div>
            ${detailFields()}
            <div class="msg err" id="pu-err" role="alert"></div>
            ${nav('Next →')}
          </form>`;
      } else if (k === 'meetup') {
        html = `<h2>Choose a meet-up point</h2><p class="muted">Where should you meet the seller and pay in cash?</p>
          ${options(MEETUP_POINTS, st.meetup, 'meetup')}${nav('Next →', !st.meetup)}`;
      } else if (k === 'time') {
        html = `<h2>Lunch or recess?</h2><p class="muted">When will you meet at <strong>${esc(st.meetup)}</strong>?</p>
          ${options(MEETUP_TIMES, st.time, 'time')}${nav('Next →', !st.time)}`;
      } else if (k === 'confirm') {
        html = `<h2>${isVault ? 'Check your offer' : 'Confirm your offer'}</h2>
          ${reminder()}
          <table class="pu-summary">
            <tr><th>${isVault ? 'Vault' : 'Item'}</th><td>${esc(offer.item)}</td></tr>
            <tr><th>Your offer</th><td><strong>${amt()}</strong>${isVault ? ` <span class="muted">(guide ${money(offer.listPrice)})</span>` : isFull ? ' <span class="muted">(full price)</span>' : ''}</td></tr>
            <tr><th>Payment</th><td>💵 Cash at the meet-up — no cards</td></tr>
            <tr><th>Meet-up point</th><td>${esc(st.meetup)}</td></tr>
            <tr><th>Time</th><td>${esc(st.time)}</td></tr>
            <tr><th>Your name</th><td>${esc(st.name)}${st.cls ? ' · ' + esc(st.cls) : ''}${st.contact ? '<br><span class="muted">' + esc(st.contact) + '</span>' : ''}</td></tr>
          </table>
          <div class="msg err" id="pu-err" role="alert"></div>
          ${nav(isVault ? 'Send my offer' : 'Confirm &amp; notify seller')}`;
      }
      root.innerHTML = head() + html;
      bind();
    }

    function bind() {
      root.querySelectorAll('[data-nav="back"]').forEach(b => b.addEventListener('click', () => { st.i--; render(); }));
      const next = root.querySelector('[data-nav="next"]');
      if (isForm()) {
        const f = root.querySelector('#pu-form');
        // Name, class and contact are checked as they type; Next stays disabled until all pass.
        const fields = [{ input: f.name, field: 'name' }, { input: f.cls, field: 'cls' }, { input: f.contact, field: 'contact' }];
        const watch = watchEntries(fields, next);
        if (st.rejected) { watch.reject(st.rejected.field, st.rejected.value); }
        f.addEventListener('submit', e => {
          e.preventDefault();
          const err = (t, el) => { root.querySelector('#pu-err').textContent = t; if (el) el.focus(); };
          if (f.amount) {
            const a = Math.round(parseFloat(f.amount.value) * 100) / 100;
            if (!(a > 0) || a > 100000) return err('Please enter how much you want to offer.', f.amount);
            st.amount = a;
          }
          if (!watch.valid()) { const bad = fields.find(x => x.input.getAttribute('aria-invalid')); if (bad) bad.input.focus(); return; }
          st.name = f.name.value.trim(); st.cls = f.cls.value.trim(); st.contact = f.contact.value.trim();
          if (st.name.length < 2) return err('Please enter your name.', f.name);
          write(KEYS.buyer, { name: st.name, cls: st.cls, contact: st.contact });
          st.i++; render();
        });
        setTimeout(() => { const first = f.amount || f.name; if (first) first.focus(); }, 0);
        return;
      }
      root.querySelectorAll('[data-meetup]').forEach(b => b.addEventListener('click', () => { st.meetup = b.dataset.meetup; render(); }));
      root.querySelectorAll('[data-time]').forEach(b => b.addEventListener('click', () => { st.time = b.dataset.time; render(); }));
      if (!next) return;
      if (key() === 'confirm') next.addEventListener('click', submit);
      else next.addEventListener('click', () => { if (!next.disabled) { st.i++; render(); } });
    }

    // job tracks which parts already succeeded, so "Try again" only redoes the failed ones
    let pickup = null; const job = { sold: !isFull, saved: false, emailed: false };
    const busy = text => { root.innerHTML = `<div class="success-box pu-sending"><div class="spinner" aria-hidden="true"></div><h3>${esc(text)}</h3></div>`; };
    function failScreen(title, text, retry) {
      root.innerHTML = `<div class="success-box pu-result err"><div class="tick">⚠️</div><h2>${esc(title)}</h2>
        <p>${text}</p>
        <p class="muted">Still stuck? Call the owner on <a href="tel:${OWNER_PHONE}">${OWNER_PHONE}</a>${pickup ? ' and quote ' + esc(pickup.id) : ''}.</p>
        <div class="pu-nav"><button class="btn outline" type="button" data-done>Close</button>${retry ? '<button class="btn" type="button" data-retry>Try again</button>' : ''}</div></div>`;
      root.querySelector('[data-done]').addEventListener('click', closeModal);
      if (retry) root.querySelector('[data-retry]').addEventListener('click', submit);
      if (window.AV && AV.onDataChange) AV.onDataChange();
    }
    function saveRemote(p) {
      const fail = (r, text) => { const e = new Error((r && r.message) || text); e.code = r && r.error; e.field = r && r.field; throw e; };
      if (isVault) {
        // Needs supabase/migration_002.sql. Until it is run, the emailed copy still reaches the owner.
        return AV.db.createVaultOffer(p).then(r => { if (!r || !r.ok) fail(r, 'Could not save offer'); });
      }
      return AV.db.createPickup(p).then(r => { if (!r || !r.ok) fail(r, 'Could not save pickup'); });
    }
    // The database refused the name/class/contact (supabase/migration_003.sql): back to the form with "Invalid".
    function backToDetails(e) {
      const ee = entryError({ error: e.code, field: e.field });
      st.done = false;
      st.rejected = { field: ee.field, value: st[ee.field] };
      st.i = STEPS.findIndex(s => s[0] === 'details' || s[0] === 'offer');
      render();
    }
    async function submit() {
      if (pickup) Object.assign(pickup, { name: st.name, cls: st.cls, contact: st.contact, meetup: st.meetup, time: st.time, price: st.amount, at: Date.now() });
      if (!pickup) {
        // One pickup per item (or vault) from this browser: a new/higher offer replaces the earlier one.
        const prev = !isFull ? getPickups().find(p => p.itemId === offer.itemId && p.type === offer.type && !p.collected) : null;
        const prefix = isVault ? 'VO-' : 'PU-';
        pickup = {
          id: prev ? prev.id : prefix + Date.now().toString(36).toUpperCase().slice(-5) + Math.random().toString(36).slice(2, 5).toUpperCase(),
          itemId: offer.itemId, item: offer.item, emoji: offer.emoji || '📦', price: st.amount, type: offer.type,
          listPrice: isVault ? Number(offer.listPrice) : undefined,
          name: st.name, cls: st.cls, contact: st.contact, payment: 'Cash', meetup: st.meetup, time: st.time,
          at: Date.now(), emailStatus: 'sending', collected: false
        };
      }
      st.done = true;
      if (!job.sold) { // Full-price offer: claim the item in the shared database first
        busy('Confirming your offer…');
        let r;
        try { r = await AV.db.buyNow(offer.itemId); } catch (e) { return failScreen("Couldn't confirm your offer", esc(AV.db.friendly(e)), true); }
        if (!r || !r.ok) { st.done = false; return failScreen('Sorry — this item is no longer available', esc((r && r.message) || 'It may have just been sold.'), false); }
        job.sold = true;
        if (r.price != null) pickup.price = st.amount = Number(r.price);
        const cachedItem = AV.db.cached(offer.itemId); if (cachedItem) { cachedItem.sold = true; cachedItem.status = 'sold'; }
        if (window.AV && AV.onDataChange) AV.onDataChange();
      }
      busy(isVault ? 'Sending your offer to the seller…' : 'Sending your pickup details to the seller…');
      // Save to the database first: if it rejects the name/class/contact, nothing is emailed and the buyer fixes it.
      const [saved] = await Promise.allSettled([job.saved ? Promise.resolve() : saveRemote(pickup)]);
      if (saved.status === 'rejected' && entryError({ error: saved.reason && saved.reason.code })) return backToDetails(saved.reason);
      st.rejected = null;
      upsertPickup(pickup);
      const [mailed] = await Promise.allSettled([job.emailed ? Promise.resolve() : sendPickupEmail(pickup)]);
      if (saved.status === 'fulfilled') job.saved = true; else console.warn(isVault ? 'create_vault_offer failed' : 'create_pickup failed', saved.reason);
      if (mailed.status === 'fulfilled') job.emailed = true; else console.warn('FormSubmit email failed', mailed.reason);
      updatePickup(pickup.id, p => { p.emailStatus = job.emailed ? 'sent' : 'failed'; p.saved = job.saved; p.emailError = job.emailed ? '' : String(mailed.reason && mailed.reason.message || mailed.reason || ''); });
      if (job.saved || job.emailed) {
        const when = `<strong>${esc(pickup.meetup)}</strong> at <strong>${esc(pickup.time.toLowerCase())}</strong>`;
        root.innerHTML = `<div class="success-box pu-result ok"><div class="tick">✅</div><h2>${isVault ? 'Offer sent!' : "You're all set!"}</h2>
          <p class="pu-recap"><strong>You offered ${money(pickup.price)}.</strong> Highest offer wins.</p>
          <p>${job.emailed ? 'The seller has been emailed your details.' : 'Your details have been sent to the seller\'s dashboard.'}${isVault ? ' The owner will confirm with you if yours is the highest offer.' : ''}</p>
          <p class="pu-recap">${isVault ? 'Then meet' : 'Meet'} at ${when} and bring <strong>${money(pickup.price)} in cash</strong> — no cards.</p>
          <p class="muted">Reference ${esc(pickup.id)}</p>
          <button class="btn" type="button" data-done>Done</button></div>`;
        root.querySelector('[data-done]').addEventListener('click', closeModal);
        if (window.AV && AV.onDataChange) AV.onDataChange();
      } else {
        failScreen("Couldn't reach the seller", `Your ${isBid ? 'offer stands' : isFull ? 'offer is confirmed' : 'offer is not sent yet'}, but we couldn't send your details just now. Please check your internet connection and try again.`, true);
      }
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
        window.location.href = 'seller.html'; // the dashboard then asks for the owner's email sign-in
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
        <div class="header-tools">${codeFormHTML}</div>
      </div>`;
      header.querySelector('.menu-toggle').addEventListener('click', () => header.querySelector('.tabs').classList.toggle('open'));
      bindCodeForm(header.querySelector('.code-form'));
    }
    const footer = document.getElementById('site-footer');
    if (footer) {
      footer.className = 'site-footer';
      footer.innerHTML = `<div class="container footer-inner">
        <div><div class="brand">Auction Vault</div><div>Mystery vaults &amp; online auctions.</div></div>
        <div>Need help? Call the owner on <a href="tel:${OWNER_PHONE}">${OWNER_PHONE}</a><br><a href="support.html">Customer Service</a></div>
        <div>${codeFormHTML}</div>
      </div><div class="container" style="margin-top:16px;font-size:.75rem;color:#8A8D91">© ${new Date().getFullYear()} Auction Vault. Cash only at the meet-up. No card payments — make an offer, highest offer wins.</div>`;
      bindCodeForm(footer.querySelector('.code-form'));
    }
  }

  window.addEventListener('storage', () => { if (window.AV && AV.onDataChange) AV.onDataChange(); });
  // The old storage-vault cart is gone (vaults now go through offers); tidy up its leftover data.
  try { localStorage.removeItem('av_cart_v1'); localStorage.removeItem('av_orders_v1'); } catch (e) {}
  document.addEventListener('DOMContentLoaded', renderChrome);

  window.AV = Object.assign(window.AV || {}, {
    KEYS, CATEGORIES, OWNER_PHONE, HOUR, getItems, getItem, myBid, setMyBid,
    salePrice, minNextBid, money, esc, timeLeft, thumbHTML,
    openModal, closeModal, toast, checkCode, read, write,
    validateEntry, entryError, watchEntries, ENTRY_RULES,
    startPickup, getPickups, savePickups, updatePickup, sendPickupEmail, pickupPayload, typeLabel, CASH_LINE, MEETUP_POINTS, MEETUP_TIMES, PICKUP_ENDPOINT
  });
})();
