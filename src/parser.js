// Extrae los límites de uso del texto de https://claude.ai/settings/usage.
// La página no tiene API, así que se lee su texto visible con heurísticas
// tolerantes a cambios de diseño y a la interfaz en inglés o en español.

const PCT_RE = /(\d{1,3}(?:[.,]\d+)?)\s*%/;
const USED_RE = /(used|usado|utilizado|consumido)/i;
const RESET_RE = /(reset|restablec|reinici|renuev|se renueva)/i;
const NOISE_RE = /(learn more|más información|more about|acerca de|last updated|última actualización|actualizado)/i;

function toNumber(s) {
  return Math.round(parseFloat(String(s).replace(',', '.')) * 10) / 10;
}

function classify(label) {
  if (/session|sesi[oó]n/i.test(label)) return 'session';
  if (/opus/i.test(label)) return 'opus';
  if (/sonnet/i.test(label)) return 'sonnet';
  if (/week|seman|all models|todos los modelos/i.test(label)) return 'weekly';
  return 'other';
}

function isLabelCandidate(line) {
  return (
    line.length > 1 &&
    line.length <= 60 &&
    !PCT_RE.test(line) &&
    !RESET_RE.test(line) &&
    !NOISE_RE.test(line)
  );
}

function makeItem(label, used, reset) {
  const u = Math.max(0, Math.min(100, used));
  return {
    label,
    kind: classify(label),
    used: u,
    remaining: Math.round((100 - u) * 10) / 10,
    reset: reset || null,
  };
}

/**
 * @param {string} text  innerText de la página de uso
 * @param {Array<{value:string|number,max?:string|number,context?:string}>} [bars]
 *        barras [role=progressbar] encontradas en la página (respaldo)
 */
function parseUsage(text, bars = []) {
  const lines = String(text || '')
    .split(/\r?\n+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const items = [];
  const seen = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(PCT_RE);
    if (!m) continue;

    // Solo porcentajes de "uso": "23% used", "23 % usado" o una línea que es solo "23%".
    const standalone = /^\d{1,3}(?:[.,]\d+)?\s*%$/.test(line);
    if (!USED_RE.test(line) && !standalone) continue;

    let label = null;
    let reset = null;
    for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
      const prev = lines[j];
      if (!reset && RESET_RE.test(prev)) { reset = prev; continue; }
      if (PCT_RE.test(prev)) break; // llegamos al bloque anterior
      if (!label && isLabelCandidate(prev)) { label = prev; break; }
    }
    // El texto de reinicio a veces va justo después del porcentaje.
    if (!reset && lines[i + 1] && RESET_RE.test(lines[i + 1])) reset = lines[i + 1];

    label = label || `Límite ${items.length + 1}`;
    if (seen.has(label)) continue;
    seen.add(label);
    items.push(makeItem(label, toNumber(m[1]), reset));
  }

  // Respaldo: barras de progreso accesibles.
  if (items.length === 0 && Array.isArray(bars)) {
    bars.forEach((b, idx) => {
      const max = Number(b.max) || 100;
      const val = Number(b.value);
      if (!Number.isFinite(val)) return;
      const ctx = String(b.context || '').split(/\r?\n+/).map((s) => s.trim()).filter(Boolean);
      const label = ctx.find(isLabelCandidate) || `Límite ${idx + 1}`;
      const reset = ctx.find((l) => RESET_RE.test(l)) || null;
      if (seen.has(label)) return;
      seen.add(label);
      items.push(makeItem(label, (val / max) * 100, reset));
    });
  }

  return items;
}

function looksLikeLogin(href, text) {
  if (/\/login|\/signin|\/auth/i.test(href || '')) return true;
  return /(continue with (email|google)|continuar con (correo|google)|iniciar sesión|log in|sign in)/i.test(
    String(text || '').slice(0, 2000)
  ) && !PCT_RE.test(String(text || ''));
}

module.exports = { parseUsage, looksLikeLogin, classify };
