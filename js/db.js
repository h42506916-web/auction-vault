/* Auction Vault — shared data layer (Supabase). Every visitor reads the same data;
   public writes go through RPC functions, seller writes need the admin to be signed in. */
(function () {
  'use strict';
  const cfg = window.AV_CONFIG || {};
  const TIMEOUT_MS = 15000;
  let client = null;

  function configured() {
    return !!(cfg.supabaseUrl && cfg.supabaseAnonKey && !/^REPLACE/.test(cfg.supabaseUrl) && !/^REPLACE/.test(cfg.supabaseAnonKey));
  }
  // fetch with a timeout so an unreachable server shows a friendly error instead of spinning forever
  function timedFetch(url, opts) {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    opts = Object.assign({}, opts || {});
    if (opts.signal) opts.signal.addEventListener('abort', () => ctrl.abort());
    opts.signal = ctrl.signal;
    return fetch(url, opts).finally(() => clearTimeout(t));
  }
  function sb() {
    if (client) return client;
    if (!configured()) throw new Error('The shop database is not set up yet (js/config.js).');
    if (!window.supabase || !window.supabase.createClient) throw new Error('Could not load the database library. Please check your internet connection.');
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
      global: { fetch: timedFetch }
    });
    return client;
  }
  function check(res) {
    if (res.error) { const e = new Error(res.error.message || 'Database error'); e.code = res.error.code; e.details = res.error; throw e; }
    return res.data;
  }
  function friendly(e) {
    const m = String((e && e.message) || e || '');
    if (/not set up|database library/i.test(m)) return m;
    if (/Failed to fetch|NetworkError|Load failed|abort|timed? ?out|network/i.test(m)) return "We couldn't reach the shop's server. Please check your internet connection and try again.";
    if (/JWT|permission|row-level|not authori[sz]ed|42501/i.test(m)) return 'You are not allowed to do that. Please sign in again.';
    return m || 'Something went wrong. Please try again.';
  }

  const num = v => (v == null ? 0 : Number(v));
  function fromRow(r) {
    return {
      id: r.id, name: r.name, description: r.description || '', category: r.category || 'Other', emoji: r.emoji || '📦',
      image: r.image_url || '', startBid: num(r.starting_bid), currentBid: num(r.current_bid), buyNow: num(r.buy_now),
      discount: num(r.discount), bidCount: num(r.bid_count), endsAt: Date.parse(r.ends_at), status: r.status,
      sold: r.status === 'sold', removed: r.status === 'removed', source: r.source || 'seller', createdAt: Date.parse(r.created_at) || 0
    };
  }
  const tierFromRow = r => ({ id: r.id, name: r.name, emoji: r.emoji, price: num(r.price), perks: r.perks || [], ribbon: r.ribbon || '', cls: r.cls || '', sort: r.sort || 0, active: r.active !== false });

  let cache = [];
  function cacheItem(it) { const i = cache.findIndex(x => x.id === it.id); if (i >= 0) cache[i] = it; else cache.push(it); return it; }

  const db = {
    configured, client: sb, friendly,
    get items() { return cache; },
    cached: id => cache.find(i => i.id === id) || null,

    /* ----- public reads ----- */
    async loadItems() {
      const rows = check(await sb().from('items').select('*').neq('status', 'removed').order('ends_at', { ascending: true }));
      cache = rows.map(fromRow); return cache;
    },
    async loadItem(id) {
      const row = check(await sb().from('items').select('*').eq('id', id).neq('status', 'removed').maybeSingle());
      if (!row) { cache = cache.filter(i => i.id !== id); return null; }
      return cacheItem(fromRow(row));
    },
    async loadTiers() {
      const rows = check(await sb().from('storage_tiers').select('*').eq('active', true).order('sort', { ascending: true }));
      return rows.map(tierFromRow);
    },
    async itemBids(id) {
      return check(await sb().rpc('item_bids', { p_item_id: id })).map(b => ({ amount: num(b.amount), by: b.bidder_name, at: Date.parse(b.created_at) }));
    },

    /* ----- public writes (RPC, validated in the database) ----- */
    async placeBid(id, amount, bidderName) {
      return check(await sb().rpc('place_bid', { p_item_id: id, p_amount: amount, p_bidder_name: bidderName }));
    },
    async buyNow(id) { return check(await sb().rpc('buy_now', { p_item_id: id })); },
    async createPickup(p) {
      return check(await sb().rpc('create_pickup', {
        p_item_id: p.itemId, p_item_name: p.item, p_price: p.price, p_purchase_type: p.type,
        p_buyer_name: p.name, p_class: p.cls || '', p_contact: p.contact || '', p_meetup: p.meetup, p_time: p.time, p_reference: p.id
      }));
    },
    // Storage vault offer (RPC added by supabase/migration_002.sql)
    async createVaultOffer(p) {
      return check(await sb().rpc('create_vault_offer', {
        p_tier_id: p.itemId, p_amount: p.price, p_buyer_name: p.name, p_class: p.cls || '', p_contact: p.contact || '',
        p_meetup: p.meetup, p_time: p.time, p_reference: p.id
      }));
    },

    /* ----- auth (seller) ----- */
    adminEmail: cfg.adminEmail || '',
    isAdmin(session) { return !!(session && session.user && session.user.email && cfg.adminEmail && session.user.email.toLowerCase() === cfg.adminEmail.toLowerCase()); },
    async getSession() { return check(await sb().auth.getSession()).session; },
    onAuth(fn) { return sb().auth.onAuthStateChange((evt, session) => fn(evt, session)); },
    async sendLoginLink(email) {
      return check(await sb().auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } }));
    },
    async verifyCode(email, token) { return check(await sb().auth.verifyOtp({ email, token, type: 'email' })); },
    async signOut() { return check(await sb().auth.signOut()); },

    /* ----- admin (RLS: only the admin email may do these) ----- */
    admin: {
      async items() { return check(await sb().from('items').select('*').order('created_at', { ascending: false })).map(fromRow); },
      async insertItem(row) { return fromRow(check(await sb().from('items').insert(row).select().single())); },
      async updateItem(id, patch) { return fromRow(check(await sb().from('items').update(patch).eq('id', id).select().single())); },
      async tiers() { return check(await sb().from('storage_tiers').select('*').order('sort', { ascending: true })).map(tierFromRow); },
      async updateTier(id, patch) { return tierFromRow(check(await sb().from('storage_tiers').update(patch).eq('id', id).select().single())); },
      async pickups() { return check(await sb().from('pickups').select('*').order('created_at', { ascending: false })); },
      async updatePickup(id, patch) { return check(await sb().from('pickups').update(patch).eq('id', id).select().single()); },
      async deletePickup(id) { return check(await sb().from('pickups').delete().eq('id', id)); }
    }
  };

  // Loading / error placeholders used by the public pages
  db.loadingHTML = (text) => `<div class="empty load-state" role="status"><div class="spinner" aria-hidden="true"></div>${text || 'Loading…'}</div>`;
  db.errorHTML = (e) => `<div class="empty load-state err" role="alert"><div style="font-size:2rem">⚠️</div><strong>Sorry — we couldn't load this right now.</strong><p class="muted">${String(friendly(e)).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))}</p><button class="btn" type="button" data-retry>Try again</button></div>`;

  window.AV = Object.assign(window.AV || {}, { db });
})();
