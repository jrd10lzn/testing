const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  refresh: () => ipcRenderer.invoke('refresh'),
  login: () => ipcRenderer.invoke('login'),
  logout: () => ipcRenderer.invoke('logout'),
  openUsagePage: () => ipcRenderer.invoke('open-usage-page'),
  showScraper: () => ipcRenderer.invoke('show-scraper'),
  setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),
  setAutostart: (on) => ipcRenderer.invoke('set-autostart', on),
  sendTrayIcon: (dataUrl) => ipcRenderer.send('tray-icon', dataUrl),
});
