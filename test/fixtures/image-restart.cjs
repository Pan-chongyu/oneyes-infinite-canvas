const { app, BrowserWindow, protocol, net, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { createVault } = require('../../desktop/vault.cjs');
const base = process.argv[2], profile = process.env.CANVAS_IMAGE_TEST_PROFILE, phase = process.env.CANVAS_IMAGE_TEST_PHASE;
console.log('ASYNC_IMAGE_RESTART_START', phase);
app.setPath('userData', profile);
protocol.registerSchemesAsPrivileged([{ scheme: 'oneyes-canvas', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
app.whenReady().then(async () => {
    const vault = createVault(profile);
    ipcMain.handle('config:read', () => vault.read());
    ipcMain.handle('config:write', (_event, value) => vault.write(value));
    ipcMain.handle('config:remove', () => vault.remove());
    protocol.handle('oneyes-canvas', request => {
        const url = new URL(request.url);
        return net.fetch(`${base}${url.pathname === '/' ? '/__image-restart' : url.pathname}${url.search}`);
    });
    const win = new BrowserWindow({ show: false, width: 1300, height: 850, webPreferences: { preload: resolve('desktop/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const js = code => win.webContents.executeJavaScript(code);
    const wait = async condition => { const end = Date.now() + 20000; while (!await js(condition)) { if (Date.now() > end) throw Error('Timed out: ' + condition); await new Promise(resolve => setTimeout(resolve, 25)); } };
    try {
        await win.loadURL(`oneyes-canvas://app/${phase === 'submit' ? '?submit' : ''}`);
        await wait('!!window.restartTest');
        if (phase === 'submit') {
            await wait('restartTest.state().tasks[0]?.remoteId === "imgtask_restart"');
            assert.equal(await js('restartTest.posts()'), 1);
            assert.ok(await js('restartTest.node().metadata.images[0].imageTaskId'));
            await js('restartTest.refresh()');
            await wait('restartTest.state().tasks[0].status === "waiting"');
        } else {
            assert.equal(await js('restartTest.keyRestored()'), true, 'encrypted Key must restore before recovery');
            await wait('restartTest.state().tasks[0]?.status === "completed"');
            await wait('restartTest.node().metadata.status === "success" && !!document.querySelector("[data-node-id=restart-node] img")');
            assert.ok(await js('restartTest.blob()'), 'downloaded Blob survives process restart');
            assert.equal(await js('restartTest.posts()'), 1, 'restart must never repeat a paid POST');
            await js('restartTest.flush()');
        }
        await win.webContents.session.flushStorageData();
        console.log(`ASYNC_IMAGE_RESTART_OK: ${phase}`);
        app.exit(0);
    } catch (error) {
        console.error(error);
        console.error(await js('({tasks: window.restartTest?.state(), node: window.restartTest?.node(), errors: window.fixtureErrors, body:document.body.innerText.slice(0,1000)})'));
        app.exit(1);
    }
}).catch(error => { console.error(error); app.exit(1); });
