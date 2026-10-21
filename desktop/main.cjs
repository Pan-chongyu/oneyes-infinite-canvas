const { app, BrowserWindow, protocol, net, ipcMain, shell, dialog } = require('electron');
const { join, resolve } = require('node:path');
const { createVault } = require('./vault.cjs');
const { route } = require('./protocol.cjs');
const { createAccount } = require('./account.cjs');
const { createAgent } = require('./agent.cjs');
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
    const account = createAccount({ vault: createVault(app.getPath('userData'), 'account'), fetcher: (...args) => net.fetch(...args) });
    if (smoke) {
        const smokePort = await new Promise(resolve => { const server = require('node:net').createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
        const fs = require('node:fs/promises');
        await fs.mkdir(join(app.getPath('userData'), 'agent'), { recursive: true });
        await fs.writeFile(join(app.getPath('userData'), 'agent/canvas-agent.json'), JSON.stringify({ url: `http://127.0.0.1:${smokePort}`, token: require('node:crypto').randomBytes(18).toString('hex') }));
    }
    const agent = createAgent({ directory: app.getPath('userData'), runtime: app.isPackaged ? join(process.resourcesPath, 'canvas-agent') : resolve(__dirname, '../canvas-agent'),
        ...(smoke ? { agentHome: join(app.getPath('userData'), 'agent'), codexHome: join(app.getPath('userData'), 'codex') } : {}) });
    app.on('before-quit', () => agent.stop());
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
    ipcMain.handle('account:call', async (event, operation, args) => {
        trusted(event);
        try { return { data: await account.call(operation, args) }; }
        catch (error) { return { error: error.message }; }
    });
    ipcMain.handle('agent:call', async (event, operation) => {
        trusted(event);
        if (!['status', 'setup', 'restore'].includes(operation)) throw new Error('不支持的接入操作');
        try { return { data: await agent[operation]() }; }
        catch (error) { return { error: error.message }; }
    });
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
                const connection = await agent.setup();
                if (!connection.configured || !(await agent.status()).configured) throw new Error('Persistent Codex setup failed');
                const mcp = await fetch(`${connection.url}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-canvas-agent-token': connection.token }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'desktop-smoke', version: '1' } } }) }).then(r => r.json());
                if (!mcp.result?.serverInfo) throw new Error('Packaged MCP handshake failed');
                const runtime = app.isPackaged ? join(process.resourcesPath, 'canvas-agent') : resolve(__dirname, '../canvas-agent');
                const cli = join(runtime, 'node_modules/@openai/codex/bin/codex.js');
                const result = await require('node:util').promisify(require('node:child_process').execFile)(process.execPath, [cli, 'mcp', 'get', 'infinite-canvas', '--json'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', CODEX_HOME: join(app.getPath('userData'), 'codex') }, windowsHide: true });
                if (JSON.parse(result.stdout).transport.url !== `${connection.url}/mcp`) throw new Error('Packaged Codex config validation failed');
                const moduleUrl = require('node:url').pathToFileURL(join(runtime, 'dist/agent/codex-client.js')).href;
                const initialize = `const {CodexAppClient}=await import(${JSON.stringify(moduleUrl)});await CodexAppClient.start(()=>{},()=>{});console.log('APP_SERVER_READY');process.exit(0);`;
                const initialized = await require('node:util').promisify(require('node:child_process').execFile)(process.execPath, ['--input-type=module', '-e', initialize], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ONEYES_DESKTOP_AGENT: '1', ONEYES_CANVAS_AGENT_HOME: join(app.getPath('userData'), 'agent'), CODEX_HOME: join(app.getPath('userData'), 'codex') }, windowsHide: true, timeout: 20_000 });
                if (!initialized.stdout.includes('APP_SERVER_READY')) throw new Error('Packaged Codex app-server initialization failed');
                console.log('ONEYES_CANVAS_SMOKE_OK', JSON.stringify({ ...info, codex: true, mcp: true })); agent.stop(); app.exit(0);
            } catch (error) { console.error('ONEYES_CANVAS_SMOKE_FAILED', error.message); agent.stop(); app.exit(1); }
        });
        void window.loadURL('oneyes-canvas://app/');
    }
    createWindow();
    app.on('activate', () => { if (!window) createWindow(); });
}).catch(() => { dialog.showErrorBox('OneYes Canvas', '无法读取本地配置。请备份应用数据后检查文件权限或配置完整性，原文件已保留。'); app.exit(1); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
