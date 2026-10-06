/* Account page: sign up / sign in with a username + password, edit profile (display name and
   avatar = emoji on a coloured circle), sign out. Needs supabase/migration_005.sql. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const db = AV.db, A = AV.account;
  const params = new URLSearchParams(location.search);
  let mode = params.get('mode') === 'signup' ? 'signup' : 'signin';
  let busy = false;
  // only same-site pages, e.g. auction.html?item=seed-1
  const next = (() => { const n = params.get('next') || ''; return /^[a-z]+\.html(\?[\w=&%.-]*)?$/i.test(n) && !/^account\.html/i.test(n) ? n : ''; })();
  const USER_RE = /^[a-z0-9_]{3,20}$/;

  function usernameProblem(u) {
    if (!USER_RE.test(u)) return '3–20 characters: lowercase letters, numbers and _ only.';
    if (!/[a-z]/.test(u)) return 'Include at least one letter.';
    if (!AV.validateEntry(u.replace(/_/g, ' '), 'name').ok || !AV.validateEntry(u.replace(/_/g, ''), 'name').ok) return "That username isn't allowed — please pick another.";
    return '';
  }
  function nameProblem(n) {
    n = n.trim();
    if (n.length < 2 || n.length > 30) return 'Display name: 2–30 characters.';
    return AV.validateEntry(n, 'name').ok ? '' : 'Invalid — please use your real name or a friendly nickname.';
  }
  const FIELD_MSG = { username: "That username isn't allowed — please pick another.", display_name: 'Invalid — please use your real name or a friendly nickname.',
    avatar_emoji: 'Please pick an emoji.', avatar_color: 'Please pick a colour.' };

  /* ---------- avatar picker ---------- */
  function pickerHTML(p) {
    return `<div class="acct-preview" aria-live="polite">${AV.avatarHTML(p, 'xl')}<div><div class="acct-preview-name" id="pv-name">${AV.esc(p.display_name || 'Your name')}</div>
        <div class="muted" id="pv-user">${p.username ? '@' + AV.esc(p.username) : ''}</div></div></div>
      <label>Display name<input name="display_name" maxlength="30" autocomplete="nickname" value="${AV.esc(p.display_name || '')}" placeholder="e.g. Sam L"></label>
      <fieldset class="acct-pick"><legend>Avatar</legend>
        <div class="emoji-grid" role="radiogroup" aria-label="Avatar emoji">${AV.AVATAR_EMOJIS.map(e => `<button type="button" class="emoji-opt ${e === p.avatar_emoji ? 'selected' : ''}" role="radio" aria-checked="${e === p.avatar_emoji}" data-emoji="${e}">${e}</button>`).join('')}</div>
        <div class="color-grid" role="radiogroup" aria-label="Avatar colour">${AV.AVATAR_COLORS.map(c => `<button type="button" class="color-opt ${c === p.avatar_color ? 'selected' : ''}" role="radio" aria-checked="${c === p.avatar_color}" aria-label="Colour ${c}" data-color="${c}" style="--av:${c}"></button>`).join('')}</div>
      </fieldset>`;
  }
  function bindPicker(form, p) {
    const state = { emoji: p.avatar_emoji, color: p.avatar_color };
    const preview = () => {
      form.querySelector('.acct-preview .avatar').outerHTML = AV.avatarHTML({ emoji: state.emoji, color: state.color }, 'xl');
      form.querySelector('#pv-name').textContent = form.display_name.value.trim() || 'Your name';
    };
    form.querySelectorAll('[data-emoji]').forEach(b => b.addEventListener('click', () => {
      state.emoji = b.dataset.emoji;
      form.querySelectorAll('[data-emoji]').forEach(x => { x.classList.toggle('selected', x === b); x.setAttribute('aria-checked', x === b); });
      preview();
    }));
    form.querySelectorAll('[data-color]').forEach(b => b.addEventListener('click', () => {
      state.color = b.dataset.color;
      form.querySelectorAll('[data-color]').forEach(x => { x.classList.toggle('selected', x === b); x.setAttribute('aria-checked', x === b); });
      preview();
    }));
    form.display_name.addEventListener('input', preview);
    return state;
  }
  const randomOf = list => list[Math.floor(Math.random() * list.length)];

  /* ---------- views ---------- */
  function render() {
    const root = $('#acct-root');
    if (!A.ready) {
      root.innerHTML = `<div class="panel acct-panel"><h2>Accounts are coming soon</h2><p class="muted">Buyer accounts aren't switched on yet. You can still make offers on the <a href="auction.html">Auction</a> page.</p></div>`;
      return;
    }
    if (A.session && A.profile) return profileView(root);
    if (A.session) return finishView(root);
    return signedOutView(root);
  }

  function signedOutView(root) {
    const p = { display_name: '', avatar_emoji: randomOf(AV.AVATAR_EMOJIS), avatar_color: randomOf(AV.AVATAR_COLORS) };
    root.innerHTML = `<div class="panel acct-panel">
      <div class="acct-tabs" role="tablist">
        <button type="button" role="tab" data-mode="signin" aria-selected="${mode === 'signin'}" class="${mode === 'signin' ? 'active' : ''}">Sign in</button>
        <button type="button" role="tab" data-mode="signup" aria-selected="${mode === 'signup'}" class="${mode === 'signup' ? 'active' : ''}">Create account</button>
      </div>
      ${mode === 'signin' ? `
      <form class="stack" id="signin" autocomplete="on" novalidate>
        <label>Username<input name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="20" required></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
        <div class="msg err" id="acct-err" role="alert"></div>
        <button class="btn" type="submit">Sign in</button>
        <p class="muted acct-note">New here? <a href="#" data-mode="signup">Create an account</a> — it takes 20 seconds.</p>
      </form>` : `
      <form class="stack" id="signup" autocomplete="on" novalidate>
        <label>Username<input name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="20" required placeholder="e.g. sam_lee"></label>
        <span class="acct-hint" id="user-hint">3–20 characters: lowercase letters, numbers and _ only.</span>
        <label>Password<input name="password" type="password" autocomplete="new-password" minlength="6" required placeholder="At least 6 characters"></label>
        ${pickerHTML(p)}
        <div class="msg err" id="acct-err" role="alert"></div>
        <button class="btn" type="submit">Create account</button>
        <p class="muted acct-note">Your display name and avatar show next to your offers. No email needed — remember your password, it can't be reset.</p>
      </form>`}
    </div>`;
    root.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); mode = b.dataset.mode; render(); }));
    const form = root.querySelector('form'); const err = root.querySelector('#acct-err');
    form.username.addEventListener('input', () => { const v = form.username.value.toLowerCase().replace(/\s+/g, '_'); if (v !== form.username.value) form.username.value = v; });
    if (mode === 'signin') {
      form.addEventListener('submit', async e => {
        e.preventDefault(); if (busy) return;
        const u = form.username.value.trim().toLowerCase(), pw = form.password.value;
        if (!u || !pw) { err.textContent = 'Enter your username and password.'; return; }
        await run(form, 'Signing in…', async () => { const r = await db.account.signIn(u, pw); await AV.refreshAccount(r.session); done(); });
      });
    } else {
      const pick = bindPicker(form, p);
      const hint = root.querySelector('#user-hint');
      let t;
      form.username.addEventListener('input', () => {
        clearTimeout(t); const u = form.username.value.trim(); const bad = u ? usernameProblem(u) : '';
        hint.textContent = bad || (u ? 'Checking…' : '3–20 characters: lowercase letters, numbers and _ only.'); hint.className = 'acct-hint' + (bad ? ' err' : '');
        if (!u || bad) return;
        t = setTimeout(async () => {
          try { const r = await db.account.usernameAvailable(u); if (form.username.value.trim() !== u) return;
            hint.textContent = r.ok && r.available ? '✓ Available' : r.ok ? 'Taken — try another.' : FIELD_MSG.username;
            hint.className = 'acct-hint ' + (r.ok && r.available ? 'ok' : 'err'); } catch (ex) { hint.textContent = ''; }
        }, 400);
      });
      form.addEventListener('submit', async e => {
        e.preventDefault(); if (busy) return;
        const u = form.username.value.trim().toLowerCase(), pw = form.password.value, name = form.display_name.value.trim();
        const bad = usernameProblem(u) || (pw.length < 6 ? 'Password: at least 6 characters.' : '') || nameProblem(name);
        if (bad) { err.textContent = bad; return; }
        await run(form, 'Creating your account…', async () => {
          const a = await db.account.usernameAvailable(u);
          if (!a.ok) throw new Error(FIELD_MSG.username);
          if (!a.available) throw new Error('That username is taken — try another, or sign in.');
          const r = await db.account.signUp(u, pw);
          await saveProfile({ display_name: name, avatar_emoji: pick.emoji, avatar_color: pick.color });
          AV.toast('Welcome, ' + name + '!');
          await AV.refreshAccount(r.session); done();
        });
      });
    }
    setTimeout(() => form.username.focus(), 0);
  }

  function finishView(root) {
    const email = A.session.user.email || '';
    const synthetic = db.account.usernameOf(email);
    const p = { username: synthetic, display_name: '', avatar_emoji: randomOf(AV.AVATAR_EMOJIS), avatar_color: randomOf(AV.AVATAR_COLORS) };
    root.innerHTML = `<div class="panel acct-panel"><h2>Finish your profile</h2>
      <p class="muted">Pick a display name and an avatar — they show next to your offers.</p>
      <form class="stack" id="finish" novalidate>
        ${synthetic ? '' : `<label>Username<input name="username" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="20" required placeholder="e.g. sam_lee"></label>`}
        ${pickerHTML(p)}
        <div class="msg err" id="acct-err" role="alert"></div>
        <button class="btn" type="submit">Save profile</button>
        <button class="btn outline" type="button" data-signout>Sign out</button>
      </form></div>`;
    const form = root.querySelector('form'); const pick = bindPicker(form, p);
    form.querySelector('[data-signout]').addEventListener('click', signOut);
    form.addEventListener('submit', async e => {
      e.preventDefault(); if (busy) return;
      const name = form.display_name.value.trim(); const u = form.username ? form.username.value.trim().toLowerCase() : '';
      const bad = (form.username ? usernameProblem(u) : '') || nameProblem(name);
      if (bad) { root.querySelector('#acct-err').textContent = bad; return; }
      await run(form, 'Saving…', async () => { await saveProfile({ display_name: name, avatar_emoji: pick.emoji, avatar_color: pick.color, username: u }); AV.toast('Profile saved'); done(); });
    });
  }

  function profileView(root) {
    const p = A.profile;
    root.innerHTML = `<div class="panel acct-panel">
      ${next ? `<a class="btn acct-continue" href="${AV.esc(next)}">Continue →</a>` : ''}
      <h2>Edit profile</h2>
      <form class="stack" id="edit" novalidate>
        ${pickerHTML(p)}
        <div class="msg" id="acct-err" role="alert"></div>
        <button class="btn" type="submit">Save changes</button>
      </form>
      <hr class="acct-rule">
      <div class="acct-foot"><span class="muted">Signed in as <strong>@${AV.esc(p.username)}</strong></span><button class="btn outline" type="button" data-signout>Sign out</button></div>
    </div>`;
    const form = root.querySelector('form'); const pick = bindPicker(form, p); const msg = root.querySelector('#acct-err');
    root.querySelector('[data-signout]').addEventListener('click', signOut);
    form.addEventListener('submit', async e => {
      e.preventDefault(); if (busy) return;
      const name = form.display_name.value.trim(); const bad = nameProblem(name);
      if (bad) { msg.className = 'msg err'; msg.textContent = bad; return; }
      await run(form, 'Saving…', async () => {
        await saveProfile({ display_name: name, avatar_emoji: pick.emoji, avatar_color: pick.color });
        AV.toast('Profile saved');
      });
    });
  }

  /* ---------- actions ---------- */
  async function saveProfile(p) {
    const r = await db.account.saveProfile(p);
    if (!r || !r.ok) {
      const m = r && r.error === 'username_taken' ? 'That username is taken — try another.' : (r && FIELD_MSG[r.field]) || (r && r.message) || 'Could not save your profile.';
      throw new Error(m);
    }
    AV.setProfile(r.profile);
    return r.profile;
  }
  async function run(form, label, fn) {
    const btn = form.querySelector('button[type="submit"]'); const err = form.querySelector('#acct-err'); const old = btn.textContent;
    busy = true; btn.disabled = true; btn.textContent = label; err.className = 'msg err'; err.textContent = '';
    try { await fn(); }
    catch (e) { console.error(e); if (document.body.contains(err)) err.textContent = db.friendly(e); }
    finally { busy = false; if (document.body.contains(btn)) { btn.disabled = false; btn.textContent = old; } }
  }
  function done() { if (next && A.profile) location.href = next; else render(); }
  async function signOut() {
    try { await db.signOut(); } catch (e) { console.warn(e); }
    await AV.refreshAccount(null); mode = 'signin'; render(); AV.toast('Signed out');
  }

  document.addEventListener('DOMContentLoaded', () => {
    let first = true;
    AV.onAccount(() => { if (busy) return; if (first || !document.querySelector('#acct-root form:focus-within')) render(); first = false; });
  });
})();
