const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('oneYesEditor', {
    platform: process.platform,
    close: () => ipcRenderer.invoke('editor:close'),
    report: (stage, error) => ipcRenderer.invoke('editor:report',stage,error),
});
