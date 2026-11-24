/* Trimwerk – Anmeldung (Supabase). Braucht vorher config.js und supabase-js. */
(function () {
  const C = window.TRIMWERK_CONFIG || {};
  const root = new URL('./', document.currentScript.src).href;
  // Art des Links aus der Mail merken, bevor supabase-js die Adresse aufräumt
  const hash = new URLSearchParams(location.hash.slice(1));
  const linkType = hash.get('type') || new URLSearchParams(location.search).get('type');
  const sb = window.supabase.createClient(C.supabaseUrl, C.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  function show() { document.documentElement.classList.remove('tw-wait'); }
  window.TW = {
    sb, root, linkType,
    async session() { const { data } = await sb.auth.getSession(); return data.session; },
    /* Für geschützte Seiten: ohne Login zur Startseite (dort Anmeldung), danach zurück */
    async guard() {
      if (!C.gate) return show();
      const s = await this.session();
      if (s) return show();
      location.replace(root + 'index.html?next=' + encodeURIComponent(location.pathname + location.search + location.hash));
    },
    async logout() { await sb.auth.signOut(); location.href = root + 'index.html'; }
  };
})();
