const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld(
  'workroom',
  Object.freeze({
    call: (method, args = {}, requestId) =>
      ipcRenderer.invoke('workroom:call', method, args, requestId),
    runtime: (method, args = {}, requestId) =>
      ipcRenderer.invoke('workroom:runtime', method, args, requestId),
    publication: (method, args = {}, requestId) =>
      ipcRenderer.invoke('workroom:publication', method, args, requestId),
    chooseFolder: () => ipcRenderer.invoke('workroom:folder'),
    exportPortfolio: (id, revision) => ipcRenderer.invoke('workroom:export', id, revision),
    projectReportOutput: (requestId, action) =>
      ipcRenderer.invoke('workroom:project-report', requestId, action),
    connectionInfo: (action) => ipcRenderer.invoke('workroom:connection', action),
    language: (value) => ipcRenderer.invoke('workroom:language', value),
    codexSetup: (productId, revision) =>
      ipcRenderer.invoke('workroom:codex-setup', productId, revision),
    codexConnection: (action, productId, value) =>
      ipcRenderer.invoke('workroom:codex-connection', action, productId, value),
  }),
);
