const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'canvas-update-ui-')));
app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1000, height: 720, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    win.webContents.on('console-message', details => { if (details.level >= 2) console.error(details.message); });
    const js = async code => { try { return await win.webContents.executeJavaScript(code); } catch(error) { throw new Error(code + ': ' + error.message); } };
    const wait = async condition => { const end = Date.now() + 20000; while (!await js(condition)) { if (Date.now() > end) throw Error('Timed out: ' + condition); await new Promise(resolve => setTimeout(resolve, 25)); } };
    try {
        await win.loadURL(process.argv[2]);
        await wait('window.updateTest && document.querySelector("[aria-expanded]")');
        await js('document.querySelector("[aria-expanded]").click()');
        await wait('document.querySelector("section[aria-label=软件更新]")');
        assert.match(await js('document.body.textContent'), /新版本 v0.20.21 已下载完成/);
        await js('updateTest.agentBusy(true);Array.from(document.querySelectorAll("section button")).find(x=>x.textContent === "更新并重启").click()');
        await js('new Promise(resolve => setTimeout(resolve, 100))');
        assert.ok(!(await js('updateTest.state().operations')).includes('install'));
        await js('updateTest.agentBusy(false);Array.from(document.querySelectorAll("section button")).find(x=>x.textContent === "更新并重启").click()');
        await wait('updateTest.state().operations.includes("install")');
        assert.equal(await js('updateTest.saved()'), 'OTA 未落盘画布');
        await js('updateTest.status("downloading")');
        await wait('document.querySelector("[role=progressbar]")');
        assert.equal(await js('document.querySelector("[role=progressbar]").getAttribute("aria-valuenow")'), '36');
        await js('updateTest.status("ready")');
        await wait('document.body.textContent.includes("新版本 v0.20.21")');
        await js('updateTest.retryAfterTargetFailure()');
        await wait('document.body.textContent.includes("请将应用移到")');
        assert.equal(await js('Array.from(document.querySelectorAll("section button")).find(x=>x.textContent === "重试更新").disabled'), false, 'target errors must remain retryable');
        await js('Array.from(document.querySelectorAll("section button")).find(x=>x.textContent === "重试更新").click()');
        await wait('updateTest.state().operations.includes("check")');
        const before = await js('document.querySelector("section").getBoundingClientRect().toJSON()');
        assert.ok(before.width <= 321 && before.height < 320, 'compact update panel');
        if (process.env.CANVAS_UPDATE_SCREENSHOT) {
            await js('new Promise(resolve => requestAnimationFrame(resolve))');
            writeFileSync(process.env.CANVAS_UPDATE_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
            await js('updateTest.theme(true)');
            win.setSize(400, 680);
            await js('new Promise(resolve => requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
            const narrow = await js('document.querySelector("section").getBoundingClientRect().toJSON()');
            assert.ok(narrow.left >= 0 && narrow.right <= 400);
            writeFileSync(process.env.CANVAS_UPDATE_SCREENSHOT.replace('.png', '-dark.png'), (await win.webContents.capturePage()).toPNG());
        }
        console.log('OTA_UI_OK: version prompt, background progress, busy guard, save before install, compact panel'); app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});
