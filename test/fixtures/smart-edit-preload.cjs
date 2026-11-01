const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('oneYesDesktop', { media: {
    create: (...args) => ipcRenderer.invoke('edit:create', ...args), start: id => ipcRenderer.invoke('edit:start', id), release: id => ipcRenderer.invoke('edit:release', id),
    subscribe: callback => { const handler = (_, state) => callback(state); ipcRenderer.on('edit:state', handler); return () => ipcRenderer.removeListener('edit:state', handler); },
} });
