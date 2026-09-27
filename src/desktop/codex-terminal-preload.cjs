const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld(
  'codexTerminal',
  Object.freeze({
    request: (action, value) => ipcRenderer.invoke('workroom:terminal', action, value),
    onData: (callback) => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on('workroom:terminal-data', listener);
      return () => ipcRenderer.removeListener('workroom:terminal-data', listener);
    },
  }),
);
