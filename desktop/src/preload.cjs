const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mailman', {
  version: '',
  platform: process.platform,
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings) => ipcRenderer.invoke('settings:set', settings),
  testConnection: (settings) => ipcRenderer.invoke('settings:test', settings),
  getUpdateState: () => ipcRenderer.invoke('update:state'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateState: (cb) => { const h = (_e, state) => cb(state); ipcRenderer.on('update:status', h); return () => ipcRenderer.off('update:status', h); },
});
