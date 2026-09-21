const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agentUsage', {
  requestLimits: () => ipcRenderer.invoke('limits:request'),
  refresh: () => ipcRenderer.invoke('limits:refresh'),
  onUpdate: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('limits:update', listener);
    return () => ipcRenderer.removeListener('limits:update', listener);
  },
});
