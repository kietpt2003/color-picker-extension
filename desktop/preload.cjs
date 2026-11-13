const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('drawingDesktop', {
  send: (action, value) => {
    ipcRenderer.send('drawing:command', { action, value });
  },
  state: (value) => {
    ipcRenderer.send('drawing:state', value);
  },
  activate: () => {
    ipcRenderer.send('drawing:activate');
  },
  export: (data, mode) => { return ipcRenderer.invoke('drawing:export', { data, mode }); },
  prepareCapture: () => { return ipcRenderer.invoke('drawing:prepareCapture'); },
  capture: () => { return ipcRenderer.invoke('drawing:capture'); },
  finishCapture: () => { return ipcRenderer.invoke('drawing:finishCapture'); },
  subscribe: (callback) => {
    const listener = (_event, message) => { callback(message); };
    ipcRenderer.on('drawing:update', listener);
    return () => { ipcRenderer.removeListener('drawing:update', listener); };
  },
});
