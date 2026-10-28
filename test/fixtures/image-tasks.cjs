const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'canvas-image-tasks-')));
app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1300, height: 850, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    win.webContents.on('console-message', (...args) => { const details = args[0]; if (details.level === 'error' || details.level >= 2 || args[1] >= 2) console.error(details.message || args[2]); });
    const js = code => win.webContents.executeJavaScript(code);
    const wait = async condition => { const end = Date.now() + 20000; while (!await js(`typeof asyncImageTest !== 'undefined' && (${condition})`)) { if (Date.now() > end) throw Error('Timed out: ' + condition); await new Promise(resolve => setTimeout(resolve, 25)); } };
    try {
        for (const edit of [false, true]) {
            console.log('ASYNC_IMAGE_PHASE', edit ? 'edit' : 'generation');
            if (edit) await js('sessionStorage.clear()');
            await win.webContents.session.clearStorageData();
            await win.loadURL(process.argv[2]);
            await wait('window.asyncImageTest && document.querySelector("main")');
            await js(`asyncImageTest.start(${edit})`);
            await wait('asyncImageTest.state().tasks[0]?.remoteId === "imgtask_fixture"');
            assert.equal(await js('asyncImageTest.posts()'), 1);
            assert.ok(await js('asyncImageTest.node().metadata.imageTaskId'));
            await js('asyncImageTest.refresh()');
            await wait('asyncImageTest.state().tasks[0]?.status === "waiting"');
            await win.loadURL(process.argv[2]);
            await wait('window.asyncImageTest && asyncImageTest.state().tasks[0]?.status === "waiting"');
            assert.equal(await js('asyncImageTest.posts()'), 1, 'reload must not submit another paid request');
            await js('asyncImageTest.connect(true)');
            await wait('asyncImageTest.state().tasks[0]?.status === "waiting"');
            assert.equal(await js('asyncImageTest.state().tasks[0].images.length'), 0);
            await js('asyncImageTest.connect(false)');
            await wait('asyncImageTest.state().tasks[0]?.status === "completed"');
            assert.equal(await js('asyncImageTest.posts()'), 1);
            assert.ok((await js('asyncImageTest.blob()')).bytes > 0, 'image must be stored as a local Blob');
            assert.equal((await js('asyncImageTest.logs()')).length, 1);
            assert.ok(!JSON.stringify(await js('asyncImageTest.cached()')).includes('fixture-private-key'));
            await js('asyncImageTest.apply()');
            assert.equal((await js('asyncImageTest.node()')).metadata.status, 'success');
            await win.loadURL(process.argv[2]);
            await wait('window.asyncImageTest && asyncImageTest.state().tasks[0]?.status === "completed"');
            assert.ok((await js('asyncImageTest.blob()')).bytes > 0);
            assert.equal(await js('asyncImageTest.posts()'), 1);
        }
        console.log('ASYNC_IMAGE_OK: real IndexedDB receipt and Blob storage, generation/edit, offline reload, download interruption, original canvas target, no duplicate POST');
        app.exit(0);
    } catch (error) { console.error(error); console.error(await js('({body:document.body.innerText.slice(0,1000),api:!!window.asyncImageTest,errors:window.fixtureErrors,submitError:sessionStorage.getItem("submitError"),tasks:window.asyncImageTest?.state(),posts:window.asyncImageTest?.posts()})')); app.exit(1); }
});
