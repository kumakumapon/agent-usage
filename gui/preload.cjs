const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agentUsage', {
  requestLimits: () => ipcRenderer.invoke('limits:request'),
  refresh: () => ipcRenderer.invoke('limits:refresh'),
  hide: () => ipcRenderer.invoke('window:hide'),
  onUpdate: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('limits:update', listener);
    return () => ipcRenderer.removeListener('limits:update', listener);
  },
  onLanguage: (callback) => {
    const listener = (_event, lang) => callback(lang);
    ipcRenderer.on('lang:update', listener);
    return () => ipcRenderer.removeListener('lang:update', listener);
  },
  onLayout: (callback) => {
    const listener = (_event, mode) => callback(mode);
    ipcRenderer.on('layout:update', listener);
    return () => ipcRenderer.removeListener('layout:update', listener);
  },
});
