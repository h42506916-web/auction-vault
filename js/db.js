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
    if (/invalid_entry/i.test(m)) return 'Invalid — please enter your real name';
    const code = (e && e.code) || '';
    if (code === 'invalid_credentials' || /invalid login credentials/i.test(m)) return 'Wrong username or password.';
    if (code === 'user_already_exists' || /already registered/i.test(m)) return 'That username is taken — try another, or sign in.';
    if (code === 'email_address_invalid' || code === 'signup_disabled' || /email address .* is invalid|signups? not allowed/i.test(m)) return ACCOUNTS_OFF;
    if (code === 'weak_password' || /password should/i.test(m)) return 'Please choose a longer password (at least 6 characters).';
    if (/database error saving new user/i.test(m)) return "That username isn't allowed — please pick another.";
    if (code === 'over_request_rate_limit' || /rate limit|too many/i.test(m)) return 'Too many tries — please wait a minute and try again.';
    if (/Failed to fetch|NetworkError|Load failed|abort|timed? ?out|network/i.test(m)) return "We couldn't reach the shop's server. Please check your internet connection and try again.";
    if (/JWT|permission|row-level|not authori[sz]ed|42501/i.test(m)) return 'You are not allowed to do that. Please sign in again.';
    return m || 'Something went wrong. Please try again.';
  }

  // A function added by a migration that has not been run yet (PostgREST: PGRST202 / 404)
  const missingFn = err => /PGRST202|42883/.test(err.code || '') || /could not find the function|does not exist|schema cache/i.test(err.message || '');
  const ACCOUNTS_OFF = "Accounts aren't switched on yet — please try again later.";
  const ACCOUNT_DOMAIN = 'auctionvault.local';
  const PROFILE_COLS = 'id,username,display_name,avatar_emoji,avatar_color';
  const MIGRATION_004 = 'Paid tracking is not set up yet. Run supabase/migration_004.sql in the Supabase SQL Editor, then try again.';

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
    // Offer history; username / avatar come from supabase/migration_005.sql (absent before it runs)
    async itemBids(id) {
      return check(await sb().rpc('item_bids', { p_item_id: id })).map(b => ({ amount: num(b.amount), by: b.bidder_name, at: Date.parse(b.created_at),
        username: b.username || '', emoji: b.avatar_emoji || '', color: b.avatar_color || '' }));
    },

    // Highest offer per item: { [itemId]: { amount, by, at } }. Uses top_offers() (migration_004.sql);
    // before that migration runs, falls back to item_bids() for each item that has offers.
    async topOffers(items) {
      const out = {};
      const res = await sb().rpc('top_offers');
      if (!res.error) {
        (res.data || []).forEach(r => { out[r.item_id] = { amount: num(r.amount), by: r.bidder_name || 'Anonymous', at: Date.parse(r.created_at),
          username: r.username || '', emoji: r.avatar_emoji || '', color: r.avatar_color || '' }; });
        return out;
      }
      if (!missingFn(res.error)) check(res);
      const withBids = (items || cache).filter(it => it.bidCount > 0);
      await Promise.all(withBids.map(async it => {
        try {
          const bids = await db.itemBids(it.id);
          const top = bids.reduce((a, b) => (!a || b.amount > a.amount || (b.amount === a.amount && b.at < a.at)) ? b : a, null);
          if (top) out[it.id] = top;
        } catch (e) { /* leave this item without a top offer */ }
      }));
      return out;
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

    /* ----- buyer accounts (username + password; supabase/migration_005.sql) -----
       The username becomes the login email <username>@auctionvault.local (never emailed). */
    account: {
      domain: ACCOUNT_DOMAIN, ACCOUNTS_OFF,
      emailFor: u => String(u || '').trim().toLowerCase() + '@' + ACCOUNT_DOMAIN,
      usernameOf: email => { const m = /^([a-z0-9_]+)@auctionvault\.local$/i.exec(email || ''); return m ? m[1].toLowerCase() : ''; },
      // true once the profiles table exists (cached for 5 minutes)
      async ready() {
        try { const c = JSON.parse(sessionStorage.getItem('av_acct_ready') || 'null'); if (c && Date.now() - c.t < 300000) return c.v; } catch (e) {}
        const res = await sb().from('profiles').select('id').limit(1);
        let v = true;
        if (res.error) {
          if (/42P01|PGRST205|PGRST204/.test(res.error.code || '') || /does not exist|could not find the table|schema cache/i.test(res.error.message || '')) v = false;
          else check(res);
        }
        try { sessionStorage.setItem('av_acct_ready', JSON.stringify({ v, t: Date.now() })); } catch (e) {}
        return v;
      },
      async usernameAvailable(u) { return check(await sb().rpc('username_available', { p_username: u })); },
      async signUp(username, password) {
        const data = check(await sb().auth.signUp({ email: db.account.emailFor(username), password, options: { data: { username } } }));
        if (!data.session) throw new Error(ACCOUNTS_OFF); // "Confirm email" is still on in Supabase
        return data;
      },
      async signIn(username, password) { return check(await sb().auth.signInWithPassword({ email: db.account.emailFor(username), password })); },
      async profile(uid) { return check(await sb().from('profiles').select(PROFILE_COLS).eq('id', uid).maybeSingle()); },
      async saveProfile(p) {
        return check(await sb().rpc('save_profile', { p_display_name: p.display_name, p_avatar_emoji: p.avatar_emoji, p_avatar_color: p.avatar_color, p_username: p.username || null }));
      },
      // The signed-in buyer's own offers, one row per item (supabase/migration_006.sql).
      // Returns null when migration 006 hasn't been run yet.
      async myBids() {
        const res = await sb().rpc('my_bids');
        if (res.error && missingFn(res.error)) return null;
        return (check(res) || []).map(r => ({
          itemId: r.item_id, name: r.item_name, emoji: r.item_emoji || '📦', image: r.image_url || '',
          status: r.item_status, endsAt: r.ends_at ? new Date(r.ends_at).getTime() : 0,
          amount: Number(r.my_amount) || 0, count: r.my_count || 0, lastAt: r.last_bid_at ? new Date(r.last_bid_at).getTime() : 0,
          top: Number(r.top_amount) || 0, isTop: !!r.is_top
        }));
      }
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
      async deletePickup(id) { return check(await sb().from('pickups').delete().eq('id', id)); },
      // Debts / receipts: mark pickups paid or unpaid (admin-only RPC from supabase/migration_004.sql)
      async markPaid(ids, paid) {
        const res = await sb().rpc('mark_pickups_paid', { p_ids: ids, p_paid: !!paid });
        if (res.error && missingFn(res.error)) throw new Error(MIGRATION_004);
        return check(res);
      }
    }
  };

  // Loading / error placeholders used by the public pages
  db.loadingHTML = (text) => `<div class="empty load-state" role="status"><div class="spinner" aria-hidden="true"></div>${text || 'Loading…'}</div>`;
  db.errorHTML = (e) => `<div class="empty load-state err" role="alert"><div style="font-size:2rem">⚠️</div><strong>Sorry — we couldn't load this right now.</strong><p class="muted">${String(friendly(e)).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))}</p><button class="btn" type="button" data-retry>Try again</button></div>`;

  window.AV = Object.assign(window.AV || {}, { db });
})();
