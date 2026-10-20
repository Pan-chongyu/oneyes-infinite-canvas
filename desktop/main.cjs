const { app, BrowserWindow, protocol, net, ipcMain, shell, dialog } = require('electron');
const { join, resolve } = require('node:path');
const { createVault } = require('./vault.cjs');
const { route } = require('./protocol.cjs');
protocol.registerSchemesAsPrivileged([{ scheme: 'oneyes-canvas', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
let window;
const smoke = process.argv.includes('--smoke-test');
if (smoke) app.setPath('userData', join(app.getPath('temp'), 'oneyes-canvas-smoke-' + process.pid));
if (!app.requestSingleInstanceLock()) app.quit();
else {
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
app.whenReady().then(async () => {
    const root = resolve(__dirname, '../web/dist'), vault = createVault(app.getPath('userData'));
    await vault.read(); // Refuse to overwrite an unreadable vault.
    protocol.handle('oneyes-canvas', async request => {
        try {
            const target = route(request.url, root);
            if (target.file) return net.fetch(target.file);
            if (!['GET', 'POST', 'DELETE', 'PATCH', 'PUT'].includes(request.method)) return new Response(null, { status: 405 });
            const headers = {};
            for (const name of ['authorization', 'content-type', 'accept']) if (request.headers.has(name)) headers[name] = request.headers.get(name);
            const upstream = await net.fetch(target.api, {
                method: request.method, headers, redirect: 'manual', signal: request.signal,
                ...(!['GET', 'HEAD'].includes(request.method) ? { body: await request.arrayBuffer() } : {}),
            });
            if (upstream.status >= 300 && upstream.status < 400) return Response.json({ error: { message: 'OneYes 接口发生重定向，已停止请求以保护 API Key' } }, { status: 502 });
            return new Response(upstream.body, { status: upstream.status, headers: { 'Content-Type': upstream.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'no-store' } });
        } catch { return Response.json({ error: { message: '连接 OneYes 失败，请检查网络后重试' } }, { status: 502 }); }
    });
    const trusted = event => {
        if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !event.senderFrame.url.startsWith('oneyes-canvas://app/')) throw new Error('拒绝访问配置');
    };
    ipcMain.handle('config:read', event => { trusted(event); return vault.read(); });
    ipcMain.handle('config:write', (event, value) => { trusted(event); return vault.write(value); });
    ipcMain.handle('config:remove', event => { trusted(event); return vault.remove(); });
    function createWindow() {
        window = new BrowserWindow({ width: 1380, height: 900, minWidth: 980, minHeight: 650, title: 'OneYes Canvas', show: !smoke, backgroundColor: '#1c1917', icon: join(__dirname, 'resources/icon.png'), webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
        window.setMenuBarVisibility(false);
        const external = url => { try { const u = new URL(url); if (u.protocol === 'https:' && !u.username && !u.password) void shell.openExternal(u.href); } catch {} };
        window.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
        window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('oneyes-canvas://app/')) { event.preventDefault(); external(url); } });
        window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
        window.webContents.session.setPermissionCheckHandler(() => false);
        window.webContents.session.on('will-download', (_event, item) => item.setSaveDialogOptions({ title: '保存文件' }));
        window.on('closed', () => { window = null; });
        if (smoke) window.webContents.on('did-finish-load', async () => {
            try {
                const info = await window.webContents.executeJavaScript(`new Promise(resolve => {
                    const ready = () => { if (!document.body.dataset.canvasReady) return; observer.disconnect(); resolve({title:document.title,protocol:location.protocol,bridge:!!window.oneYesDesktop}); };
                    const observer = new MutationObserver(ready); observer.observe(document.body, {attributes:true}); ready();
                })`);
                if (info.protocol !== 'oneyes-canvas:' || !info.bridge || !info.title.includes('OneYes')) throw new Error('Desktop boot smoke failed');
                console.log('ONEYES_CANVAS_SMOKE_OK', JSON.stringify(info)); app.exit(0);
            } catch { app.exit(1); }
        });
        void window.loadURL('oneyes-canvas://app/');
    }
    createWindow();
    app.on('activate', () => { if (!window) createWindow(); });
}).catch(() => { dialog.showErrorBox('OneYes Canvas', '无法读取本地配置。请备份应用数据后检查文件权限或配置完整性，原文件已保留。'); app.exit(1); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
