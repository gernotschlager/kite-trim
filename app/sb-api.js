/* Trimwerk – Datenzugriff der Mess-App über Supabase.
 * Bildet die bisherigen Aktionen des Google-Skripts nach (gleiche Antworten), damit die App unverändert bleibt.
 * Braucht: supabase-js, ../config.js, ../auth.js (window.TW). */
(function () {
  if (!window.TW) return;
  const sb = TW.sb;
  const LB_FIELDS = [
    ['datum', 'Datum'], ['typ', 'Typ'], ['zeit', 'Zeit'], ['methode', 'Methode / Referenz'],
    ['last', 'Last/Leine kg'], ['versatz', 'Versatz F/B mm (+ = Front länger)'], ['knoten', 'Knoten Bar'],
    ['board', 'Board / Stand / Bar'], ['wind', 'Wind Ø kn'], ['boeen', 'Böen kn'], ['richtung', 'Richtung °'],
    ['station', 'Station'], ['spruenge', 'Sprünge'], ['hoehe_avg', 'Ø Höhe m'], ['hoehe_max', 'Max. Höhe m'],
    ['hangtime', 'Hangtime s'], ['datei', 'Datei'], ['notiz', 'Notiz'], ['vorrichtung', 'Vorrichtung'],
    ['marker', 'Marker-Leinen A,B,C,Z'],
    ['m_A_L', 'Marker A L'], ['m_A_R', 'Marker A R'], ['m_B_L', 'Marker B L'], ['m_B_R', 'Marker B R'],
    ['m_C_L', 'Marker C L'], ['m_C_R', 'Marker C R'], ['m_Z_L', 'Marker Z L'], ['m_Z_R', 'Marker Z R'],
    ['versatz_l', 'Versatz L mm'], ['versatz_r', 'Versatz R mm'],
    ['schl_B_L', 'Schlaufe B L mm'], ['schl_C_L', 'Schlaufe C L mm'], ['schl_B_R', 'Schlaufe B R mm'], ['schl_C_R', 'Schlaufe C R mm'],
    ['bar_breite', 'Bar-Breite'],
    ['front_L', 'Frontline L mm'], ['front_R', 'Frontline R mm'], ['back_L', 'Backline L mm'], ['back_R', 'Backline R mm'],
    ['foto_versatz', 'Fotos Versatz'], ['foto_tuch', 'Fotos Tuch'],
    ['tuner_L', 'Perf. Tuner L'], ['tuner_R', 'Perf. Tuner R'],
    ['pulley_B_L', 'Pulleyline B L mm'], ['pulley_C_L', 'Pulleyline C L mm'], ['pulley_B_R', 'Pulleyline B R mm'], ['pulley_C_R', 'Pulleyline C R mm'],
    ['seriennr', 'Seriennummer'], ['foto_etikett', 'Foto Etikett']
  ];
  const HEAD2KEY = Object.fromEntries(LB_FIELDS.map(([k, h]) => [h, k]));
  const PAUSE_MIN = 5;
  const sheetOf = model => model + 'm²';
  const modelOf = sheet => String(sheet || '').replace(/\s*m²\s*$/, '').trim();
  const today = () => new Date().toISOString().slice(0, 10);
  const ok = (o = {}) => Object.assign({ ok: true }, o);
  const chk = r => { if (r.error) throw new Error(r.error.message); return r.data; };

  let uid = null;
  const kiteIds = {};        // 'Sonic5 7m²' → kites.id
  const orderCache = {};     // 'Sonic5 7m²' → { line: sort }
  const planCache = {};      // 'Sonic5 7m²' → Leinenplan-Zeilen
  async function me() { if (!uid) { const s = await TW.session(); if (!s) throw new Error('Bitte neu anmelden'); uid = s.user.id; } return uid; }

  async function myKites() {
    const rows = chk(await sb.from('kites').select('id, model_key, serial, created_at').order('created_at'));
    rows.forEach(k => { const s = sheetOf(k.model_key); if (!kiteIds[s]) kiteIds[s] = k.id; });
    return rows;
  }
  async function kiteId(sheet) {
    if (!kiteIds[sheet]) await myKites();
    const id = kiteIds[sheet];
    if (!id) throw new Error('Kite nicht gefunden: ' + sheet);
    return id;
  }
  async function current(sheet, create) {
    const kid = await kiteId(sheet);
    const rows = chk(await sb.from('measurements').select('id, created_at').eq('kite_id', kid).eq('locked', false)
      .order('created_at', { ascending: false }).limit(1));
    if (rows.length) return rows[0].id;
    if (!create) return null;
    return chk(await sb.from('measurements').insert({ kite_id: kid, label: 'Laufende Messung' }).select('id').single()).id;
  }
  async function plan(sheet) {
    const rows = chk(await sb.from('lineplans').select('line, level, soll, sort').eq('kite', modelOf(sheet)).order('sort'));
    orderCache[sheet] = Object.fromEntries(rows.map(r => [r.line, r.sort]));
    planCache[sheet] = rows;
    return rows;
  }
  async function values(mid) {
    return mid ? chk(await sb.from('measurement_values').select('line, side, value_mm, soll, grp').eq('measurement_id', mid)) : [];
  }
  function toLines(vals, order) {
    const m = {};
    vals.forEach(v => {
      const l = m[v.line] || (m[v.line] = { group: v.grp || '', name: v.line, soll: v.soll, L: null, R: null });
      l[v.side] = v.value_mm == null ? null : Number(v.value_mm);
    });
    return Object.values(m).sort((a, b) => ((order[a.name] ?? 999) - (order[b.name] ?? 999)) || a.name.localeCompare(b.name, 'de', { numeric: true }));
  }
  async function stats(mid) {
    if (!mid) return { n: 0 };
    const ev = chk(await sb.from('measurement_events').select('ts').eq('measurement_id', mid).order('ts'));
    const t = ev.map(e => new Date(e.ts).getTime()).filter(x => !isNaN(x));
    if (!t.length) return { n: 0 };
    let active = 0, pauses = 0;
    for (let i = 1; i < t.length; i++) { const g = t[i] - t[i - 1]; if (g <= PAUSE_MIN * 60000) active += g; else pauses++; }
    return { n: t.length, start: new Date(t[0]).toISOString(), end: new Date(t[t.length - 1]).toISOString(),
      totalMin: Math.round((t[t.length - 1] - t[0]) / 60000), activeMin: Math.round(active / 60000), pauses,
      secPerPoint: t.length > 1 ? Math.round(active / 1000 / (t.length - 1)) : null };
  }
  const fmtT = iso => iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Europe/Vienna' }).slice(0, 16) : '';
  const statMeta = st => st.n ? { start: fmtT(st.start), ende: fmtT(st.end), dauer_min: st.totalMin, messzeit_min: st.activeMin, messungen: st.n } : {};

  const A = {
    async catalog() {
      const lib = chk(await sb.from('lineplan_kites').select('kite, model, size'));
      const mine = await myKites(), have = new Set(mine.map(k => k.model_key));
      const kites = lib.map(k => ({ name: k.kite, model: k.model, size: String(k.size).replace('.', ','), sheet: have.has(k.kite) ? sheetOf(k.kite) : '', lib: true }));
      mine.filter(k => !lib.some(l => l.kite === k.model_key)).forEach(k => {
        const m = k.model_key.match(/^(.*?)\s*([\d.,]+)$/);
        kites.push({ name: k.model_key, model: m ? m[1] : k.model_key, size: m ? m[2] : '', sheet: sheetOf(k.model_key), lib: false });
      });
      return ok({ kites });
    },
    async kites() { return ok({ kites: (await myKites()).map(k => sheetOf(k.model_key)) }); },
    async kite_new(p) {
      const name = String(p.name || '').trim(); if (!name) throw new Error('Kein Kite angegeben');
      await me();
      const r = chk(await sb.from('kites').insert({ model_key: name }).select('id').single());
      kiteIds[sheetOf(name)] = r.id;
      return ok({ sheet: sheetOf(name) });
    },
    async lines(p) {
      const pl = await plan(p.kite);
      const vals = await values(await current(p.kite, false));
      const vm = {}; vals.forEach(v => { vm[v.line + v.side] = v.value_mm == null ? null : Number(v.value_mm); });
      const lines = pl.map(r => ({ row: r.sort, name: r.line, group: r.level + '-Main', soll: r.soll == null ? null : Number(r.soll),
        L: vm[r.line + 'L'] ?? null, R: vm[r.line + 'R'] ?? null }));
      return ok({ lines });
    },
    async set(p) {
      const mid = await current(p.kite, true);
      if (p.value === '' || p.value == null) {
        chk(await sb.from('measurement_values').delete().eq('measurement_id', mid).eq('line', p.name).eq('side', p.side));
      } else {
        const pl = planCache[p.kite] || await plan(p.kite);
        const lp = pl.find(r => r.line === p.name);
        const soll = lp ? lp.soll : null, level = lp ? lp.level : null;
        chk(await sb.from('measurement_values').upsert({ measurement_id: mid, line: p.name, side: p.side, value_mm: Number(p.value),
          soll, grp: level ? level + '-Main' : null, updated_at: new Date().toISOString() }, { onConflict: 'measurement_id,line,side' }));
      }
      return ok();
    },
    async mlog(p) {
      const mid = await current(p.kite, true);
      chk(await sb.from('measurement_events').insert({ measurement_id: mid, ts: p.ts || new Date().toISOString(), line: p.name, side: p.side,
        value_mm: p.value === '' ? null : Number(p.value), action: p.value === '' ? 'gelöscht' : 'gemessen' }));
      return ok();
    },
    async mlog_stats(p) { return ok(await stats(await current(p.kite, false))); },
    async arch_list(p) {
      const kid = await kiteId(p.kite);
      const rows = chk(await sb.from('measurements').select('id, measured_at, label, created_at, meta, measurement_values(count)')
        .eq('kite_id', kid).eq('locked', true).order('created_at', { ascending: false }));
      return ok({ series: rows.map(r => {
        const m = r.meta || {}, cnt = (r.measurement_values && r.measurement_values[0] && r.measurement_values[0].count) || 0;
        return { id: r.id, gesichert: m.gesichert_am || String(r.created_at).slice(0, 10), datum: r.measured_at, kite: p.kite, label: r.label || '',
          n: cnt, gemessen: cnt, start: m.start || '', ende: m.ende || '', dauer: m.dauer_min ?? '', messzeit: m.messzeit_min ?? '', messungen: m.messungen ?? '' };
      }) });
    },
    async arch_get(p) {
      const m = chk(await sb.from('measurements').select('id, offset_mm, kite_id, kites(model_key)').eq('id', p.id).single());
      const sheet = sheetOf(m.kites.model_key);
      if (!orderCache[sheet]) await plan(sheet);
      const lines = toLines(await values(m.id), orderCache[sheet]).map(l => Object.assign(l, { offset: Number(m.offset_mm) || 0 }));
      if (!lines.length) throw new Error('Messreihe ist leer');
      return ok({ id: m.id, lines });
    },
    async arch_save(p) {
      const kid = await kiteId(p.kite), cid = await current(p.kite, false);
      const vals = await values(cid);
      if (!vals.some(v => v.value_mm != null)) throw new Error('Keine Messwerte zum Sichern vorhanden');
      const meta = Object.assign({ gesichert_am: today() }, statMeta(await stats(cid)));
      const nm = chk(await sb.from('measurements').insert({ kite_id: kid, measured_at: p.datum || today(), label: p.label || '',
        offset_mm: Number(p.offset) || 18, meta }).select('id').single());
      chk(await sb.from('measurement_values').insert(vals.map(v => ({ measurement_id: nm.id, line: v.line, side: v.side, value_mm: v.value_mm, soll: v.soll, grp: v.grp }))));
      chk(await sb.from('measurements').update({ locked: true }).eq('id', nm.id));
      return ok({ id: nm.id, n: vals.length });
    },
    async new_series(p) {
      if (p.confirm !== '1') throw new Error('Bestätigung fehlt');
      const cid = await current(p.kite, false);
      let saved = null;
      if (cid) {
        const vals = await values(cid);
        if (vals.some(v => v.value_mm != null)) {
          const meta = Object.assign({ gesichert_am: today() }, statMeta(await stats(cid)));
          chk(await sb.from('measurements').update({ label: p.label || '', measured_at: p.datum || today(), offset_mm: Number(p.offset) || 18, meta }).eq('id', cid));
          chk(await sb.from('measurements').update({ locked: true }).eq('id', cid));
          saved = { id: cid, n: vals.length };
        }
      }
      return ok({ saved });
    },
    async share_create(p) {
      const m = chk(await sb.from('measurements').select('id, share_token, kite_id').eq('id', p.id).single());
      if (p.zustand) chk(await sb.from('measurements').update({ state: p.zustand }).eq('id', m.id));
      if (p.serial) chk(await sb.from('kites').update({ serial: p.serial }).eq('id', m.kite_id));
      const token = chk(await sb.rpc('share_enable', { m: m.id, opt_in: p.basis === '1' }));
      return ok({ token, existing: !!m.share_token });
    },
    async log(p) {
      const kid = await kiteId(p.kite);
      const d = JSON.parse(p.data || '{}');
      if (!d.datum) throw new Error('Datum fehlt');
      const when = new Date(d.datum + 'T' + (/^\d{1,2}:\d{2}/.test(d.zeit || '') ? d.zeit.slice(0, 5) : '12:00'));
      chk(await sb.from('logbook_entries').insert({ kite_id: kid, kind: /session/i.test(d.typ || '') ? 'session' : 'trim',
        happened_at: isNaN(when) ? new Date().toISOString() : when.toISOString(), data: d }));
      return ok({ row: 0 });
    },
    async logs(p) {
      const kid = await kiteId(p.kite);
      const rows = chk(await sb.from('logbook_entries').select('happened_at, data').eq('kite_id', kid).order('happened_at'));
      return ok({ entries: rows.map(r => {
        const o = {}; LB_FIELDS.forEach(([k]) => o[k] = '');
        Object.entries(r.data || {}).forEach(([k, v]) => {
          const key = HEAD2KEY[k] || k;
          o[key] = Array.isArray(v) ? v.map((_, i) => 'Foto ' + (i + 1)).join('  ') : (v == null ? '' : v);
        });
        if (!o.datum) o.datum = String(r.happened_at).slice(0, 10);
        return o;
      }) });
    }
  };

  async function photo(body) {
    const u = await me();
    const cat = String(body.cat || 'foto').replace(/[^a-z0-9_-]/gi, '');
    const datum = String(body.datum || today()).replace(/[^0-9-]/g, '');
    const folder = modelOf(body.kite).replace(/[^A-Za-z0-9]+/g, '-');
    const name = `${datum}_${cat}_${Date.now().toString(36)}.jpg`;
    const path = `${u}/${folder}/${name}`;
    const bin = Uint8Array.from(atob(body.data), c => c.charCodeAt(0));
    chk(await sb.storage.from('photos').upload(path, new Blob([bin], { type: body.mime || 'image/jpeg' }), { contentType: body.mime || 'image/jpeg' }));
    const s = chk(await sb.storage.from('photos').createSignedUrl(path, 60 * 60 * 24 * 365 * 5));
    return ok({ id: path, url: s.signedUrl, name });
  }

  window.SBAPI = {
    has: a => !!A[a],
    async call(p) { const f = A[p.action]; if (!f) throw new Error('Unbekannte Aktion: ' + p.action); return f(p); },
    async post(b) { if (b.action === 'photo') return photo(b); throw new Error('Unbekannte Aktion: ' + b.action); }
  };
})();
