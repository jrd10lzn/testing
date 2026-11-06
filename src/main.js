const {
  app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, Notification, shell, session,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { parseUsage, looksLikeLogin } = require('./parser');
const { forecast } = require('./forecast');

const USAGE_URL = 'https://claude.ai/settings/usage';
const LOGIN_URL = 'https://claude.ai/login';
const PARTITION = 'persist:claude';
const HISTORY_DAYS = 7;
// Solo se muestran estos límites (se descartan chats, Cowork y demás).
const SHOWN_KINDS = new Set(['session', 'weekly', 'opus', 'sonnet']);
const APP_ICON = path.join(__dirname, '..', 'assets', 'icon.png');

// ---------- Almacenamiento local (ajustes + histórico) ----------
const DEFAULTS = {
  settings: { intervalMin: 5, alwaysOnTop: false, notify: true, thresholds: [80, 95] },
  history: [],      // [{ t, values: { label: used } }]
  lastValues: {},   // label -> último % usado (para avisos)
};

function loadStore() {
  const file = path.join(app.getPath('userData'), 'data.json');
  let data = JSON.parse(JSON.stringify(DEFAULTS));
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    data = { ...data, ...raw, settings: { ...data.settings, ...(raw.settings || {}) } };
  } catch { /* primera ejecución */ }
  return {
    data,
    save() {
      try { fs.writeFileSync(file, JSON.stringify(data)); } catch (e) { console.error(e); }
    },
  };
}

// ---------- Estado ----------
let store;
let dashWin = null;
let scraperWin = null;
let loginWin = null;
let tray = null;
let timer = null;
let scraping = false;
let quitting = false;
let state = { status: 'starting', items: [], updatedAt: null, error: null };

function setState(patch) {
  state = { ...state, ...patch };
  broadcast();
  updateTray();
}

function computeForecasts() {
  const now = Date.now();
  const out = {};
  (state.items || []).forEach((it) => { out[it.label] = forecast(store.data.history, it, now); });
  return out;
}

function broadcast() {
  if (dashWin && !dashWin.isDestroyed()) {
    dashWin.webContents.send('state', {
      ...state,
      forecasts: computeForecasts(),
      settings: store.data.settings,
      history: store.data.history,
      autostart: app.getLoginItemSettings().openAtLogin,
    });
  }
}

// ---------- Lectura de la página de uso ----------
const EXTRACT_JS = `(() => {
  const bars = [...document.querySelectorAll('[role="progressbar"]')].map((el) => {
    let c = el;
    for (let i = 0; i < 4 && c.parentElement; i++) c = c.parentElement;
    return {
      value: el.getAttribute('aria-valuenow'),
      max: el.getAttribute('aria-valuemax') || 100,
      context: c.innerText || '',
    };
  });
  return { href: location.href, text: document.body ? document.body.innerText : '', bars };
})()`;

function ensureScraper() {
  if (scraperWin && !scraperWin.isDestroyed()) return scraperWin;
  scraperWin = new BrowserWindow({
    show: false,
    width: 1100,
    height: 900,
    webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  scraperWin.webContents.setAudioMuted(true);
  scraperWin.on('closed', () => { scraperWin = null; });
  return scraperWin;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function refresh() {
  if (scraping) return;
  scraping = true;
  setState({ status: state.items.length ? 'refreshing' : 'loading', error: null });
  try {
    const win = ensureScraper();
    await win.loadURL(USAGE_URL);

    // claude.ai es una SPA: esperamos a que aparezcan los porcentajes o la pantalla de login.
    let result = null;
    let fallback = null;
    for (let i = 0; i < 25; i++) {
      await sleep(1000);
      const data = await win.webContents.executeJavaScript(EXTRACT_JS, true);
      if (looksLikeLogin(data.href, data.text)) {
        setState({ status: 'needs_login', error: null });
        return;
      }
      const items = parseUsage(data.text, data.bars);
      const known = items.filter((it) => SHOWN_KINDS.has(it.kind));
      if (known.length) {
        // La página carga por partes: esperamos un instante y leemos otra vez para no quedarnos a medias.
        await sleep(800);
        const again = await win.webContents.executeJavaScript(EXTRACT_JS, true);
        const more = parseUsage(again.text, again.bars).filter((it) => SHOWN_KINDS.has(it.kind));
        result = more.length >= known.length ? more : known;
        break;
      }
      if (items.length) fallback = items;
    }
    // Si no se reconoce ningún límite conocido, mejor mostrar lo que haya que dejar el panel vacío.
    if (!result) result = fallback;

    if (!result) {
      setState({ status: 'error', error: 'No se encontraron datos de uso en la página. Puede que Anthropic haya cambiado su diseño: pulsa «Ver página» para comprobarlo.' });
      return;
    }

    const now = Date.now();
    recordHistory(now, result);
    maybeNotify(result);
    setState({ status: 'ok', items: result, updatedAt: now, error: null });
  } catch (e) {
    setState({ status: 'error', error: `Error al leer la página: ${e.message}` });
  } finally {
    scraping = false;
  }
}

function recordHistory(t, items) {
  const values = {};
  items.forEach((it) => { values[it.label] = it.used; });
  const h = store.data.history;
  h.push({ t, values });
  const cutoff = t - HISTORY_DAYS * 24 * 3600 * 1000;
  while (h.length && h[0].t < cutoff) h.shift();
  store.save();
}

function maybeNotify(items) {
  const { notify, thresholds } = store.data.settings;
  items.forEach((it) => {
    const prev = store.data.lastValues[it.label];
    if (notify && prev !== undefined && Notification.isSupported()) {
      thresholds.forEach((th) => {
        if (prev < th && it.used >= th) {
          new Notification({
            title: `Claude: ${it.label} al ${Math.round(it.used)}%`,
            body: `Has consumido el ${Math.round(it.used)}% (te queda ${Math.round(it.remaining)}%).${it.reset ? ' ' + it.reset : ''}`,
            icon: APP_ICON,
          }).show();
        }
      });
    }
    store.data.lastValues[it.label] = it.used;
  });
  store.save();
}

function schedule() {
  if (timer) clearInterval(timer);
  const min = Math.max(1, Number(store.data.settings.intervalMin) || 5);
  timer = setInterval(refresh, min * 60 * 1000);
}

// ---------- Inicio de sesión ----------
function openLogin() {
  if (loginWin && !loginWin.isDestroyed()) { loginWin.focus(); return; }
  loginWin = new BrowserWindow({
    width: 480,
    height: 720,
    title: 'Inicia sesión en Claude',
    icon: APP_ICON,
    autoHideMenuBar: true,
    webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  loginWin.loadURL(LOGIN_URL);

  const check = (_e, url) => {
    if (/claude\.ai\/(new|chats?|recents|project|settings)/.test(url)) {
      loginWin.close();
      refresh();
    }
  };
  loginWin.webContents.on('did-navigate', check);
  loginWin.webContents.on('did-navigate-in-page', check);
  loginWin.on('closed', () => { loginWin = null; });
}

async function logout() {
  await session.fromPartition(PARTITION).clearStorageData();
  setState({ status: 'needs_login', items: [], updatedAt: null });
}

// ---------- Ventana del panel ----------
function createDashboard() {
  dashWin = new BrowserWindow({
    show: false,
    width: 400,
    height: 720,
    minWidth: 340,
    minHeight: 420,
    title: 'Claude Usage',
    icon: APP_ICON,
    autoHideMenuBar: true,
    alwaysOnTop: !!store.data.settings.alwaysOnTop,
    backgroundColor: '#1a1917',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  dashWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  dashWin.webContents.on('did-finish-load', broadcast);
  dashWin.on('close', (e) => {
    if (!quitting) { e.preventDefault(); dashWin.hide(); }
  });
}

function showDashboard() {
  if (!dashWin || dashWin.isDestroyed()) createDashboard();
  dashWin.show();
  dashWin.focus();
}

// ---------- Bandeja del sistema ----------
function trayTooltip() {
  if (state.status === 'needs_login') return 'Claude Usage — inicia sesión';
  if (!state.items.length) return 'Claude Usage';
  return ['Claude Usage', ...state.items.map((it) => `${it.label}: ${Math.round(it.used)}% consumido`)].join('\n');
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Mostrar panel', click: showDashboard },
    { label: 'Actualizar ahora', click: refresh },
    { label: 'Abrir página de uso en el navegador', click: () => shell.openExternal(USAGE_URL) },
    { type: 'separator' },
    {
      label: 'Siempre visible', type: 'checkbox', checked: !!store.data.settings.alwaysOnTop,
      click: (item) => setSetting('alwaysOnTop', item.checked),
    },
    {
      label: 'Iniciar con Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => setAutostart(item.checked),
    },
    { type: 'separator' },
    { label: 'Iniciar sesión…', click: openLogin },
    { label: 'Cerrar sesión', click: logout },
    { type: 'separator' },
    { label: 'Salir', click: () => { quitting = true; app.quit(); } },
  ]);
}

function updateTray() {
  if (!tray) return;
  tray.setToolTip(trayTooltip());
  tray.setContextMenu(buildTrayMenu());
}

function setTrayIcon(dataUrl) {
  const img = nativeImage.createFromDataURL(dataUrl);
  if (img.isEmpty()) return;
  if (!tray) {
    tray = new Tray(img);
    tray.on('click', () => (dashWin && dashWin.isVisible() ? dashWin.hide() : showDashboard()));
    updateTray();
  } else {
    tray.setImage(img);
  }
}

// ---------- Ajustes ----------
function setSetting(key, value) {
  store.data.settings[key] = value;
  store.save();
  if (key === 'intervalMin') schedule();
  if (key === 'alwaysOnTop' && dashWin) dashWin.setAlwaysOnTop(!!value);
  broadcast();
  updateTray();
}

function setAutostart(on) {
  app.setLoginItemSettings({ openAtLogin: !!on, args: ['--hidden'] });
  broadcast();
  updateTray();
}

// ---------- IPC ----------
ipcMain.handle('refresh', () => refresh());
ipcMain.handle('login', () => openLogin());
ipcMain.handle('logout', () => logout());
ipcMain.handle('open-usage-page', () => shell.openExternal(USAGE_URL));
ipcMain.handle('show-scraper', () => {
  const win = ensureScraper();
  win.setTitle('Página de uso (vista interna)');
  win.show();
  if (!win.__hideOnClose) {
    win.__hideOnClose = true;
    win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
  }
});
ipcMain.handle('set-setting', (_e, key, value) => setSetting(key, value));
ipcMain.handle('set-autostart', (_e, on) => setAutostart(on));
ipcMain.on('tray-icon', (_e, dataUrl) => setTrayIcon(dataUrl));

// ---------- Arranque ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showDashboard);

  app.whenReady().then(() => {
    app.setAppUserModelId('com.jrdlzn.claudeusage'); // necesario para notificaciones en Windows
    store = loadStore();

    // Agente de usuario de Chrome normal (sin "Electron/x.y") para que el login funcione mejor.
    const ses = session.fromPartition(PARTITION);
    ses.setUserAgent(ses.getUserAgent().replace(/\s?Electron\/\S+/, '').replace(/\s?claude-usage-dashboard\/\S+/, ''));

    createDashboard();
    if (!process.argv.includes('--hidden')) dashWin.once('ready-to-show', () => dashWin.show());
    else dashWin.hide();

    refresh();
    schedule();
  });

  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', (e) => e.preventDefault()); // sigue vivo en la bandeja
}
