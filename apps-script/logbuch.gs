/**
 * Logbuch-Erweiterung für das Kite-Trim-Skript.
 *
 * Einbau (einmalig):
 * 1. In der Tabelle: Erweiterungen → Apps Script → neue Datei „logbuch“ anlegen
 *    und diesen ganzen Inhalt hineinkopieren.
 * 2. In deiner bestehenden doGet(e) direkt NACH der Passwort-Prüfung diese Zeile einfügen:
 *
 *      const lb = logbuchRoute_(e.parameter); if (lb) return lb;
 *
 * 3. Bereitstellen → Bereitstellungen verwalten → Bearbeiten (Stift) →
 *    Version: „Neue Version“ → Bereitstellen. Die /exec-URL bleibt gleich.
 *    Beim ersten Mal fragt Google nach der Berechtigung für externe Abrufe (Nora-Winddaten).
 *
 * Das Logbuch steht im jeweiligen Kite-Blatt ab Spalte S (Überschriften in Zeile 2).
 */

const LB_COL = 19; // Spalte S
const LB_HEAD_ROW = 2;
const LB_FIELDS = [
  ['datum', 'Datum'], ['typ', 'Typ'], ['zeit', 'Zeit'], ['methode', 'Methode / Referenz'],
  ['last', 'Last/Leine kg'], ['versatz', 'Versatz F/B mm (+ = Front länger)'], ['knoten', 'Knoten Bar'],
  ['board', 'Board / Stand / Bar'], ['wind', 'Wind Ø kn'], ['boeen', 'Böen kn'], ['richtung', 'Richtung °'],
  ['station', 'Station'], ['spruenge', 'Sprünge'], ['hoehe_avg', 'Ø Höhe m'], ['hoehe_max', 'Max. Höhe m'],
  ['hangtime', 'Hangtime s'], ['datei', 'Datei'], ['notiz', 'Notiz'], ['vorrichtung', 'Vorrichtung']
];

function logbuchRoute_(p) {
  const actions = { log: lbAdd_, logs: lbList_, wind: lbWind_ };
  if (!actions[p.action]) return null;
  let out;
  try { out = Object.assign({ ok: true }, actions[p.action](p)); }
  catch (err) { out = { ok: false, error: String(err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function lbSheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Blatt „' + name + '“ nicht gefunden');
  const need = LB_COL + LB_FIELDS.length - 1;
  if (sh.getMaxColumns() < need) sh.insertColumnsAfter(sh.getMaxColumns(), need - sh.getMaxColumns());
  const head = sh.getRange(LB_HEAD_ROW, LB_COL, 1, LB_FIELDS.length);
  const want = LB_FIELDS.map(f => f[1]);
  if (head.getValues()[0].join('|') !== want.join('|')) { // fehlende/neue Überschriften ergänzen
    sh.getRange(LB_HEAD_ROW - 1, LB_COL).setValue('Trimm- & Session-Logbuch').setFontWeight('bold');
    head.setValues([want]).setFontWeight('bold');
  }
  return sh;
}

function lbLastRow_(sh) {
  const n = sh.getMaxRows() - LB_HEAD_ROW;
  const vals = sh.getRange(LB_HEAD_ROW + 1, LB_COL, n, 1).getDisplayValues();
  let last = 0;
  for (let i = 0; i < vals.length; i++) if (vals[i][0] !== '') last = i + 1;
  return LB_HEAD_ROW + last;
}

function lbAdd_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = lbSheet_(p.kite);
    const d = JSON.parse(p.data || '{}');
    if (!d.datum) throw new Error('Datum fehlt');
    const row = lbLastRow_(sh) + 1;
    if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 50);
    const vals = LB_FIELDS.map(([k]) => (d[k] === undefined || d[k] === null) ? '' : d[k]);
    vals[0] = "'" + d.datum; // Datum als Text, damit es nicht umformatiert wird
    sh.getRange(row, LB_COL, 1, vals.length).setValues([vals]);
    return { row: row };
  } finally { lock.releaseLock(); }
}

function lbList_(p) {
  const sh = lbSheet_(p.kite);
  const last = lbLastRow_(sh);
  if (last <= LB_HEAD_ROW) return { entries: [] };
  const vals = sh.getRange(LB_HEAD_ROW + 1, LB_COL, last - LB_HEAD_ROW, LB_FIELDS.length).getDisplayValues();
  return {
    entries: vals.filter(r => r[0] !== '').map(r => {
      const o = {}; LB_FIELDS.forEach(([k], i) => o[k] = r[i]); return o;
    })
  };
}

/** Wind-Mittelwerte einer Nora-Station für ein Zeitfenster (ISO-Zeiten in p.from / p.to). */
function lbWind_(p) {
  const st = String(p.station || '').replace(/[^a-z0-9-]/gi, '');
  if (!st) throw new Error('Keine Station angegeben');
  const from = new Date(p.from), to = new Date(p.to);
  if (isNaN(from) || isNaN(to) || to <= from) throw new Error('Ungültiges Zeitfenster');
  const url = 'https://www.getnora.app/api/station/' + st + '?limit=1440&since=' + encodeURIComponent(from.toISOString());
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Nora antwortet mit ' + res.getResponseCode());
  const all = JSON.parse(res.getContentText());
  // ZAMG misst nur alle 10–20 min: Fenster bei Bedarf um je 10 min erweitern
  let pick = [];
  for (const pad of [0, 10, 20]) {
    const a = from.getTime() - pad * 60000, b = to.getTime() + pad * 60000;
    pick = all.filter(x => { const t = new Date(x.datetime).getTime(); return t >= a && t <= b; });
    if (pick.length) break;
  }
  if (!pick.length) throw new Error('Keine Messwerte in diesem Zeitraum');
  const mean = k => pick.reduce((s, x) => s + Number(x[k] || 0), 0) / pick.length;
  let sx = 0, sy = 0;
  pick.forEach(x => { const r = Number(x.directionDegree) * Math.PI / 180; sx += Math.sin(r); sy += Math.cos(r); });
  const dir = (Math.atan2(sx, sy) * 180 / Math.PI + 360) % 360;
  return {
    avg: Math.round(mean('avg') * 10) / 10,
    gust: Math.round(mean('gust') * 10) / 10,
    dir: Math.round(dir),
    n: pick.length
  };
}
