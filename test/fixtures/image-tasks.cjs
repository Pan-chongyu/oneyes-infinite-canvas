const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'canvas-image-tasks-')));
app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1300, height: 850, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    win.webContents.on('console-message', (...args) => { const details = args[0]; if (details.level === 'error' || details.level >= 2 || args[1] >= 2) console.error(details.message || args[2]); });
    const js = code => win.webContents.executeJavaScript(code);
    const wait = async condition => { const end = Date.now() + 20000; while (!await js(`(window.asyncImageTest || window.generationTest) && (${condition})`)) { if (Date.now() > end) throw Error('Timed out: ' + condition); await new Promise(resolve => setTimeout(resolve, 25)); } };
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
        await win.webContents.session.clearStorageData();
        await win.loadURL(new URL('/__image-generation', process.argv[2]).href);
        await wait('window.generationTest && Array.from(document.querySelectorAll("[data-node-id=generate] button")).some(b => b.textContent.trim() === "开始生成")');
        await js('Array.from(document.querySelectorAll("[data-node-id=generate] button")).find(b => b.textContent.trim() === "开始生成").click()');
        await wait('generationTest.started() === 2 && document.querySelector("[data-node-id] [role=status]")');
        assert.equal(await js('generationTest.posts()'), 0, 'preparing a node must not submit before its receipt is ready');
        win.webContents.debugger.attach('1.3');
        await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
        for (const dark of [false, true]) {
            await js(`generationTest.theme(${dark})`);
            await new Promise(resolve => setTimeout(resolve, 300));
            assert.equal(await js('generationTest.orphanWarning()'), false, 'normal preparation must never flash a missing-task error');
            assert.match(await js('document.querySelector("[data-node-id] [role=status]").textContent'), /正在准备生成.*完成后会自动显示/);
            const spinner = await js('(() => { const element = document.querySelector("[role=status] [aria-hidden=true]"); return { size: element.offsetWidth, animation: getComputedStyle(element).animationName }; })()');
            assert.equal(spinner.size, 24);
            assert.equal(spinner.animation, 'spin');
            if (process.env.CANVAS_GENERATION_SCREENSHOT_DIR) {
                await win.webContents.capturePage();
                await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
                const image = await win.webContents.capturePage();
                require('node:fs').writeFileSync(join(process.env.CANVAS_GENERATION_SCREENSHOT_DIR, `generation-${dark ? 'dark' : 'light'}.png`), image.toPNG());
            }
        }
        await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        assert.equal(await js('getComputedStyle(document.querySelector("[role=status] [aria-hidden=true]")).animationName'), 'none');
        win.webContents.debugger.detach();
        await js('generationTest.release(0)');
        await wait('generationTest.state()[0]?.status === "processing"');
        await new Promise(resolve => setTimeout(resolve, 300));
        assert.equal(await js('generationTest.orphanWarning()'), false, 'a batch sibling still preparing must remain loading');
        await js('generationTest.release(1)');
        await wait('generationTest.state().length === 2 && generationTest.state().every(t => t.status === "processing")');
        await js('generationTest.complete()');
        await wait('generationTest.state().every(t => t.status === "completed") && document.querySelector("[data-node-id] img")');
        assert.equal(await js('generationTest.posts()'), 2, 'each requested image is submitted exactly once');
        assert.equal(await js('generationTest.orphanWarning()'), false);
        console.log('CANVAS_GENERATION_UI_OK: real generate click, delayed/partial batch receipt binding, light/dark compact animation, reduced motion, completed images, no false errors');
        console.log('ASYNC_IMAGE_OK: real IndexedDB receipt and Blob storage, generation/edit, offline reload, download interruption, original canvas target, no duplicate POST');
        app.exit(0);
    } catch (error) { console.error(error); console.error(await js('({body:document.body.innerText.slice(0,1000),api:!!window.asyncImageTest,errors:window.fixtureErrors,submitError:sessionStorage.getItem("submitError"),tasks:window.asyncImageTest?.state(),posts:window.asyncImageTest?.posts()})')); app.exit(1); }
});
