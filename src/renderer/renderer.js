const $ = (id) => document.getElementById(id);
let current = null;

const ORDER = { session: 0, weekly: 1, opus: 2, sonnet: 3, other: 4 };
const LABELS_ES = {
  'current session': 'Sesión actual',
  'all models': 'Semanal · todos los modelos',
  'opus only': 'Semanal · solo Opus',
  'sonnet only': 'Semanal · solo Sonnet',
};

function niceLabel(label) {
  return LABELS_ES[label.toLowerCase()] || label;
}

function colorFor(used) {
  const css = getComputedStyle(document.documentElement);
  if (used < 60) return css.getPropertyValue('--ok').trim();
  if (used < 85) return css.getPropertyValue('--warn').trim();
  return css.getPropertyValue('--bad').trim();
}


function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'hace unos segundos';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  return `hace ${h} h`;
}

// ---------- Dibujo ----------
function drawSpark(canvas, points, color) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  if (points.length < 2) return;

  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const span = Math.max(1, t1 - t0);
  const x = (t) => ((t - t0) / span) * (w - 2) + 1;
  const y = (v) => h - 2 - (v / 100) * (h - 4);

  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(x(p.t), y(p.v)) : ctx.moveTo(x(p.t), y(p.v))));
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  ctx.lineTo(x(t1), h);
  ctx.lineTo(x(t0), h);
  ctx.closePath();
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawTrayIcon(used, status) {
  const c = $('icon-canvas');
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 32, 32);

  let bg = '#8a857b';
  let txt = '–';
  if (status === 'needs_login') txt = '?';
  else if (status === 'error' && used == null) { bg = '#e0625a'; txt = '!'; }
  else if (used != null) {
    bg = used < 60 ? '#5fb37a' : used < 85 ? '#e0a341' : '#e0625a';
    txt = String(Math.round(used));
  }

  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(0, 0, 32, 32, 7);
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${txt.length >= 3 ? 15 : 20}px "Segoe UI", sans-serif`;
  ctx.fillText(txt, 16, 17);

  window.api.sendTrayIcon(c.toDataURL('image/png'));
}

// ---------- Render ----------
function render(s) {
  current = s;
  const busy = s.status === 'loading' || s.status === 'refreshing';

  $('dot').className = 'dot ' + (busy ? 'busy' : s.status === 'ok' ? 'ok' : s.status === 'error' || s.status === 'needs_login' ? 'bad' : '');
  $('btn-refresh').classList.toggle('spin', busy);

  $('login').classList.toggle('hidden', s.status !== 'needs_login');
  $('error').classList.toggle('hidden', s.status !== 'error');
  $('error-text').textContent = s.error || '';

  renderSubtitle();

  const items = [...(s.items || [])].sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9));
  const primary = $('cards-primary');
  const secondary = $('cards-secondary');
  primary.innerHTML = '';
  secondary.innerHTML = '';
  const dayAgo = Date.now() - 24 * 3600 * 1000;

  items.forEach((it) => {
    const color = colorFor(it.used);
    const card = document.createElement('div');
    card.className = 'card';
    const R = 52;
    const C = 2 * Math.PI * R;
    card.innerHTML = `
      <div class="card-label"></div>
      <div class="gauge">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle class="ring-track" cx="60" cy="60" r="${R}" />
          <circle class="ring-fill" cx="60" cy="60" r="${R}"
                  stroke-dasharray="${C}" stroke-dashoffset="${C}" transform="rotate(-90 60 60)" />
        </svg>
        <div class="gauge-center">
          <div class="gauge-pct">${Math.round(it.used)}<span>%</span></div>
        </div>
      </div>
      <div class="card-reset"></div>
      <canvas class="spark"></canvas>`;
    card.querySelector('.card-label').textContent = niceLabel(it.label);
    card.querySelector('.card-reset').textContent = it.reset || `${Math.round(it.remaining)}% restante`;

    (it.kind === 'session' || it.kind === 'weekly' ? primary : secondary).appendChild(card);

    const ring = card.querySelector('.ring-fill');
    ring.setAttribute('stroke', color);
    // El arco representa lo consumido.
    requestAnimationFrame(() => ring.setAttribute('stroke-dashoffset', String(C * (1 - it.used / 100))));

    const pts = (s.history || [])
      .filter((h) => h.t >= dayAgo && h.values[it.label] !== undefined)
      .map((h) => ({ t: h.t, v: h.values[it.label] }));
    const spark = card.querySelector('.spark');
    if (pts.length < 2) spark.remove();
    else requestAnimationFrame(() => drawSpark(spark, pts, color));
  });

  renderForecast(items, s.forecasts || {});

  // Ajustes
  $('interval').value = String(s.settings.intervalMin);
  $('notify').checked = !!s.settings.notify;
  $('ontop').checked = !!s.settings.alwaysOnTop;
  $('autostart').checked = !!s.autostart;

  // Icono de la bandeja: % consumido de la sesión (o del límite más alto).
  const session = items.find((i) => i.kind === 'session');
  const highest = items.reduce((m, i) => (m == null || i.used > m.used ? i : m), null);
  drawTrayIcon((session || highest)?.used ?? null, s.status);
}

function fmtDur(hours) {
  const min = Math.round(hours * 60);
  if (min < 60) return `${Math.max(1, min)} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 48) return m ? `${h} h ${m} min` : `${h} h`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}
const fmtRate = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });

function renderForecast(items, forecasts) {
  const box = $('forecast-rows');
  box.innerHTML = '';
  const now = Date.now();

  items.forEach((it) => {
    const f = forecasts[it.label];
    if (!f) return;
    const row = document.createElement('div');
    row.className = 'frow';
    row.innerHTML = `
      <div class="frow-head"><span class="frow-label"></span><span class="frow-main"></span></div>
      <div class="fbar"><div class="fbar-used"></div><div class="fbar-proj"></div></div>
      <div class="frow-note"></div>`;
    row.querySelector('.frow-label').textContent = niceLabel(it.label);
    const main = row.querySelector('.frow-main');
    const note = row.querySelector('.frow-note');

    let projected = it.used;
    if (f.status === 'collecting') {
      main.textContent = '—';
      note.textContent = 'Recopilando lecturas para calcular la previsión…';
    } else if (f.status === 'idle') {
      main.textContent = 'estable';
      note.textContent = 'Sin consumo reciente';
    } else if (f.status === 'full') {
      main.textContent = '100 %';
      note.textContent = 'Límite agotado';
    } else {
      projected = f.projectedAtReset != null ? f.projectedAtReset : 100;
      main.textContent = f.projectedAtReset == null
        ? `100 % en ${fmtDur(f.hoursToFull)}`
        : f.willExceed
          ? `se agota en ${fmtDur(f.hoursToFull)}`
          : `≈ ${Math.round(f.projectedAtReset)} % al reiniciar`;
      note.textContent = `Ritmo ${fmtRate.format(f.ratePerHour)} %/h`
        + (f.resetAt ? ` · reinicio en ${fmtDur(Math.max(0, f.resetAt - now) / 3600000)}` : '');
    }

    const color = colorFor(f.willExceed ? 100 : projected);
    const used = row.querySelector('.fbar-used');
    const proj = row.querySelector('.fbar-proj');
    used.style.width = `${it.used}%`;
    used.style.background = colorFor(it.used);
    proj.style.left = `${it.used}%`;
    proj.style.width = `${Math.max(0, Math.min(100, projected) - it.used)}%`;
    proj.style.background = color;
    box.appendChild(row);
  });

  $('forecast').classList.toggle('hidden', !box.children.length);
}

function renderSubtitle() {
  if (!current) return;
  const s = current;
  const txt = {
    starting: 'Iniciando…',
    loading: 'Leyendo tu página de uso…',
    needs_login: 'Necesitas iniciar sesión',
  }[s.status];
  $('subtitle').textContent = txt || (s.updatedAt
    ? `Actualizado ${timeAgo(s.updatedAt)} · cada ${s.settings.intervalMin} min`
    : '');
}

// ---------- Eventos ----------
window.api.onState(render);
$('btn-refresh').onclick = () => window.api.refresh();
$('btn-login').onclick = () => window.api.login();
$('btn-retry').onclick = () => window.api.refresh();
$('btn-view').onclick = () => window.api.showScraper();
$('btn-open').onclick = () => window.api.openUsagePage();
$('btn-logout').onclick = () => window.api.logout();
$('interval').onchange = (e) => window.api.setSetting('intervalMin', Number(e.target.value));
$('notify').onchange = (e) => window.api.setSetting('notify', e.target.checked);
$('ontop').onchange = (e) => window.api.setSetting('alwaysOnTop', e.target.checked);
$('autostart').onchange = (e) => window.api.setAutostart(e.target.checked);

setInterval(renderSubtitle, 30 * 1000);
drawTrayIcon(null, 'starting');
