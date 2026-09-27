const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld(
  'workroom',
  Object.freeze({
    call: (method, args = {}) => ipcRenderer.invoke('workroom:call', method, args),
    runtime: (method, args = {}) => ipcRenderer.invoke('workroom:runtime', method, args),
    chooseFolder: () => ipcRenderer.invoke('workroom:folder'),
    exportPortfolio: (id, revision) => ipcRenderer.invoke('workroom:export', id, revision),
    connectionInfo: () => ipcRenderer.invoke('workroom:connection'),
    codexSetup: (productId, revision) =>
      ipcRenderer.invoke('workroom:codex-setup', productId, revision),
    codexConnection: (action, productId, value) =>
      ipcRenderer.invoke('workroom:codex-connection', action, productId, value),
  }),
);
