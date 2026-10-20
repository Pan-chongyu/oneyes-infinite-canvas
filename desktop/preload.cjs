const { contextBridge, ipcRenderer } = require('electron');
const key = 'infinite-canvas:ai_config_store';
function check(name) { if (name !== key) throw new Error('不支持的配置'); }
contextBridge.exposeInMainWorld('oneYesDesktop', {
    storage: {
        getItem(name) { check(name); return ipcRenderer.invoke('config:read'); },
        setItem(name, value) { check(name); return ipcRenderer.invoke('config:write', value); },
        removeItem(name) { check(name); return ipcRenderer.invoke('config:remove'); },
    },
});
