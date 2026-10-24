const { contextBridge, ipcRenderer } = require('electron');
const key = 'infinite-canvas:ai_config_store';
function check(name) { if (name !== key) throw new Error('不支持的配置'); }
contextBridge.exposeInMainWorld('oneYesDesktop', {
    proxy: { test: config => ipcRenderer.invoke('proxy:test', config) },
    models: { list: apiKey => ipcRenderer.invoke('models:list', apiKey) },
    account: { call: (operation, args) => ipcRenderer.invoke('account:call', operation, args) },
    agent: { call: operation => ipcRenderer.invoke('agent:call', operation) },
    storage: {
        getItem(name) { check(name); return ipcRenderer.invoke('config:read'); },
        setItem(name, value) { check(name); return ipcRenderer.invoke('config:write', value); },
        removeItem(name) { check(name); return ipcRenderer.invoke('config:remove'); },
    },
});
