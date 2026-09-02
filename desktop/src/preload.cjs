const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mailman', {
  version: process.env.npm_package_version || '',
  platform: process.platform,
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings) => ipcRenderer.invoke('settings:set', settings),
  testConnection: (settings) => ipcRenderer.invoke('settings:test', settings),
});
