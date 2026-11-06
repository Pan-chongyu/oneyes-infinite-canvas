const { join } = require('node:path');

// Only app-created editor main frames receive the small editor preload API.
function createEditorWindows({ BrowserWindow, dialog, mainWindow, directory, chrome, theme, report }) {
    const windows = new Map();
    const editorUrl = 'oneyes-canvas://app/editor/index.html';
    function trusted(event) {
        return [...windows.values()].some(w => !w.isDestroyed() && event.sender === w.webContents && event.senderFrame === w.webContents.mainFrame && event.senderFrame.url.startsWith(editorUrl + '?'));
    }
    async function flush(w) {
        if (!w.isDestroyed() && !w.webContents.isCrashed()) await w.webContents.executeJavaScript('window.oneYesEditorFlush ? window.oneYesEditorFlush() : Promise.reject(new Error("剪辑项目尚未就绪"))');
    }
    return {
        trusted,
        disconnectHost() {
            for (const w of windows.values()) if (!w.isDestroyed() && !w.webContents.isCrashed()) void w.webContents.executeJavaScript('window.dispatchEvent(new Event("oneyes-host-offline"))').catch(() => {});
        },
        async flushAll() { for (const w of windows.values()) await flush(w); },
        close(event) { const w = BrowserWindow.fromWebContents(event.sender); if (trusted(event)) w.close(); },
        async open(key) {
            if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw new Error('无效剪辑项目');
            const existing = windows.get(key);
            if (existing && !existing.isDestroyed()) { existing.restore(); existing.show(); existing.focus(); return; }
            const w = new BrowserWindow({ width: 1440, height: 920, minWidth: 960, minHeight: 640, show: false, title: 'OneYes 智能剪辑', backgroundColor: '#181715', ...chrome(), icon: join(directory, process.platform === 'win32' ? 'resources/icon.ico' : 'resources/icon.png'), webPreferences: { preload: join(directory, 'editor-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
            windows.set(key, w);
            w.setMenuBarVisibility(false);
            w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
            w.webContents.on('will-navigate', (e, url) => { if (url !== `${editorUrl}?project=${key}`) e.preventDefault(); });
            w.webContents.on('render-process-gone', (_e, d) => { if (d.reason !== 'clean-exit') report('app', 'crash', new Error('editor runtime')); });
            let closing = false, saved = false;
            w.on('close', event => {
                if (saved) return;
                event.preventDefault();
                if (closing) return;
                closing = true;
                void flush(w).then(() => { saved = true; w.close(); }).catch(async error => {
                    report('app', 'save', error);
                    const result = await dialog.showMessageBox(w, { type: 'error', message: '剪辑项目未能保存', detail: '可返回窗口重试。强制关闭可能丢失尚未保存的修改。', buttons: ['返回剪辑', '强制关闭'], defaultId: 0, cancelId: 0 });
                    closing = false;
                    if (result.response === 1) { saved = true; w.close(); }
                });
            });
            w.on('closed', () => windows.delete(key));
            try {await w.loadURL(`${editorUrl}?project=${key}`);}catch(error){w.destroy();throw error;}
            theme(w);
            w.show(); w.focus();
        },
    };
}
module.exports = { createEditorWindows };
