// Previsión de consumo: a partir de las lecturas guardadas (histórico) estima
// el ritmo reciente en % por hora y lo proyecta hasta el próximo reinicio.

const WEEKDAYS = { dom: 0, sun: 0, lun: 1, mon: 1, mar: 2, tue: 2, mie: 3, wed: 3, jue: 4, thu: 4, vie: 5, fri: 5, sab: 6, sat: 6 };
const WEEKDAY_RE = /\b(dom|lun|mar|mi[eé]|jue|vie|s[aá]b|sun|mon|tue|wed|thu|fri|sat)[a-zéáíóú]*\.?(?=\s|,|$)/i;
const TIME_RE = /\b(\d{1,2}):(\d{2})\s*(am|pm)?|\b(\d{1,2})\s*(am|pm)\b/i;
const UNIT = '(?:d[a-zíi]*|h[a-z]*|m[a-z]*)';
const REL_RE = new RegExp(`\\b(?:in|en)\\s+(\\d+\\s*${UNIT}\\.?(?:\\s+\\d+\\s*${UNIT}\\.?)*)`, 'i');

const HOUR = 3600 * 1000;
const WINDOW_MS = { session: 3 * HOUR };
const DEFAULT_WINDOW_MS = 48 * HOUR;
const MIN_SPAN_MS = 15 * 60 * 1000;
const IDLE_RATE = 0.02; // % por hora

/**
 * Convierte el texto de reinicio ("Resets in 3 hr 12 min", "Resets Thu 10:00 AM",
 * "Se restablece el jue 10:00") en una marca de tiempo. Devuelve null si no entiende el texto.
 */
function parseReset(text, now = Date.now()) {
  if (!text) return null;

  const rel = String(text).match(REL_RE);
  if (rel) {
    let ms = 0;
    for (const m of rel[1].matchAll(/(\d+)\s*([dhm])/gi)) {
      const n = Number(m[1]);
      const u = m[2].toLowerCase();
      ms += n * (u === 'd' ? 24 * HOUR : u === 'h' ? HOUR : 60 * 1000);
    }
    return ms > 0 ? now + ms : null;
  }

  const t = String(text).match(TIME_RE);
  if (!t) return null;
  let h = Number(t[1] ?? t[4]);
  const min = Number(t[2] ?? 0);
  const ap = (t[3] || t[5] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;

  const d = new Date(now);
  d.setHours(h, min, 0, 0);
  const w = String(text).match(WEEKDAY_RE);
  if (w) {
    const key = w[1].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').slice(0, 3);
    const wd = WEEKDAYS[key];
    if (wd !== undefined) {
      d.setDate(d.getDate() + ((wd - d.getDay() + 7) % 7));
      if (d.getTime() <= now) d.setDate(d.getDate() + 7);
      return d.getTime();
    }
  }
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/**
 * @param {Array<{t:number, values:Object}>} history lecturas guardadas
 * @param {{label:string, kind:string, used:number, reset:string|null}} item límite actual
 * @returns {{status:'collecting'|'idle'|'full'|'ok', ratePerHour?:number, hoursToFull?:number,
 *            resetAt?:number|null, projectedAtReset?:number|null, willExceed?:boolean|null}}
 */
function forecast(history, item, now = Date.now()) {
  if (item.used >= 100) return { status: 'full' };

  const windowMs = WINDOW_MS[item.kind] || DEFAULT_WINDOW_MS;
  const pts = (history || [])
    .filter((h) => h.t >= now - windowMs && h.values && h.values[item.label] !== undefined)
    .map((h) => ({ t: h.t, v: h.values[item.label] }));

  // Solo se usan las lecturas posteriores al último reinicio (una bajada brusca del uso).
  let start = 0;
  for (let i = pts.length - 1; i > 0; i--) {
    if (pts[i].v < pts[i - 1].v - 3) { start = i; break; }
  }
  const seg = pts.slice(start);
  if (seg.length < 3 || seg[seg.length - 1].t - seg[0].t < MIN_SPAN_MS) return { status: 'collecting' };

  // Regresión lineal por mínimos cuadrados: pendiente en % por hora.
  const n = seg.length;
  const tMean = seg.reduce((a, p) => a + p.t, 0) / n;
  const vMean = seg.reduce((a, p) => a + p.v, 0) / n;
  let num = 0;
  let den = 0;
  seg.forEach((p) => { num += (p.t - tMean) * (p.v - vMean); den += (p.t - tMean) ** 2; });
  const ratePerHour = den ? (num / den) * HOUR : 0;
  if (ratePerHour < IDLE_RATE) return { status: 'idle' };

  const hoursToFull = (100 - item.used) / ratePerHour;
  const resetAt = parseReset(item.reset, now);
  const projectedAtReset = resetAt
    ? Math.min(100, item.used + ratePerHour * ((resetAt - now) / HOUR))
    : null;
  const willExceed = resetAt ? now + hoursToFull * HOUR < resetAt : null;
  return { status: 'ok', ratePerHour, hoursToFull, resetAt, projectedAtReset, willExceed };
}

module.exports = { forecast, parseReset };
