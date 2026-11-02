const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('oneYesDesktop',{editor:{open:key=>ipcRenderer.invoke('editor:open',key)}});
