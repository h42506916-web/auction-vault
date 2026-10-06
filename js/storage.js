/* Storage Units page: tiers come from Supabase (storage_tiers); checkout uses the local cart. */
(function () {
  'use strict';
  let tiers = [];
  async function load() {
    const el = document.getElementById('tiers');
    el.innerHTML = AV.db.loadingHTML('Loading vaults…');
    try {
      tiers = await AV.db.loadTiers();
      el.innerHTML = tiers.map(t => `
        <div class="tier ${AV.esc(t.cls)}">
          ${t.ribbon ? '<span class="ribbon">' + AV.esc(t.ribbon) + '</span>' : ''}
          <div class="vault-art">${AV.esc(t.emoji)}</div>
          <h3>${AV.esc(t.name)}</h3>
          <div class="price">${AV.money(t.price)}</div>
          <ul>${t.perks.map(p => '<li>' + AV.esc(p) + '</li>').join('')}</ul>
          <button class="btn" data-id="${AV.esc(t.id)}">Buy Now</button>
        </div>`).join('') || '<div class="empty">No vaults are available right now. Check back soon!</div>';
    } catch (e) {
      console.error(e);
      el.innerHTML = AV.db.errorHTML(e);
      el.querySelector('[data-retry]').addEventListener('click', load);
    }
  }
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('tiers').addEventListener('click', e => {
      const b = e.target.closest('[data-id]'); if (!b) return;
      const t = tiers.find(x => x.id === b.dataset.id); if (!t) return;
      AV.addToCart({ name: t.name, price: t.price, emoji: t.emoji, kind: 'Mystery Storage Vault' });
    });
    load();
  });
})();
