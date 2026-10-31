const { contextBridge, ipcRenderer } = require('electron');
const key = 'infinite-canvas:ai_config_store';
function check(name) { if (name !== key) throw new Error('不支持的配置'); }
contextBridge.exposeInMainWorld('oneYesDesktop', {
    diagnostics: { report: input => ipcRenderer.invoke('diagnostics:report', input) },
    windowChrome: {
        platform: process.platform,
        theme: theme => ipcRenderer.invoke('window:theme', theme),
        fullscreen: () => ipcRenderer.invoke('window:fullscreen'),
        subscribe(callback) {
            const listener = (_event, fullscreen) => callback(fullscreen);
            ipcRenderer.on('window:fullscreen', listener);
            return () => ipcRenderer.removeListener('window:fullscreen', listener);
        },
    },
    proxy: { test: config => ipcRenderer.invoke('proxy:test', config) },
    models: { list: apiKey => ipcRenderer.invoke('models:list', apiKey) },
    account: { call: (operation, args) => ipcRenderer.invoke('account:call', operation, args) },
    agent: { call: operation => ipcRenderer.invoke('agent:call', operation) },
    updates: {
        call: operation => ipcRenderer.invoke('update:call', operation),
        subscribe(callback) {
            const listener = (_event, state) => callback(state);
            ipcRenderer.on('update:state', listener);
            return () => ipcRenderer.removeListener('update:state', listener);
        },
    },
    storage: {
        getItem(name) { check(name); return ipcRenderer.invoke('config:read'); },
        setItem(name, value) { check(name); return ipcRenderer.invoke('config:write', value); },
        removeItem(name) { check(name); return ipcRenderer.invoke('config:remove'); },
    },
});
