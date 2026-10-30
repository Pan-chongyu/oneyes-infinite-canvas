const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const { writeFileSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const profile = process.env.CANVAS_PLUGIN_TEST_PROFILE;
const restore = process.env.CANVAS_PLUGIN_TEST_PHASE === 'restore';
app.setPath('userData', profile);
app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1100, height: 820, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    const js = code => win.webContents.executeJavaScript(code);
    const wait = async condition => { const end = Date.now() + 20000; while (!await js(condition)) { if (Date.now() > end) throw Error('Timed out: ' + condition); await new Promise(resolve => setTimeout(resolve, 25)); } };
    const drop = (target, name, source) => js(`(() => { const transfer = new DataTransfer(); transfer.items.add(new File([${source}], ${JSON.stringify(name)}, {type:'text/javascript'})); const el = ${target}; el.dispatchEvent(new DragEvent('dragover', {bubbles:true,cancelable:true,dataTransfer:transfer})); el.dispatchEvent(new DragEvent('drop', {bubbles:true,cancelable:true,dataTransfer:transfer})); })()`);
    try {
        // The second real Electron process has no access to the original file and
        // cannot fetch any plugin source. Only cached IndexedDB code may load.
        if (restore) win.webContents.session.webRequest.onBeforeRequest({ urls: ['*://*/plugins/*'] }, (_details, callback) => callback({ cancel: true }));
        await win.loadURL(process.argv[2]);
        await wait('window.pluginTest && document.querySelector("[data-canvas-surface]")');
        if (restore) {
            await wait('document.querySelector("[data-node-id=plugin-node] textarea")');
            assert.equal(await js('document.querySelector("[data-node-id=plugin-node] textarea").value'), '离线重启后保留的笔记');
            assert.equal(await js('pluginTest.state()[0].version'), '2.0.0');
            assert.equal(await js('pluginTest.state()[0].fileName'), 'updated.js');
            assert.equal(await js('pluginTest.registered()'), true);
            await js('pluginTest.toggle(false)'); assert.equal(await js('pluginTest.registered()'), false);
            await js('pluginTest.toggle(true)'); assert.equal(await js('pluginTest.registered()'), true);
            await js('pluginTest.uninstall()'); assert.equal(await js('pluginTest.registered()'), false);
            assert.equal(await js('pluginTest.state().length'), 0);
            console.log('PLUGIN_RESTART_OK: cached file, actual custom node, metadata, toggle, uninstall');
        } else {
            await js('pluginTest.theme(false)');
            await js('document.querySelector("[data-test-plugins]").click()');
            await wait('document.querySelector(".ant-tabs")');
            // Drag over the default built-in tab: the manager must reveal file installation.
            await drop('document.querySelector(".ant-tabs")', 'quick-note.mjs', 'pluginTest.sample');
            await wait('pluginTest.state()[0]?.fileName === "quick-note.mjs"');
            await wait('document.body.textContent.includes("quick-note.mjs")');
            assert.equal(await js('pluginTest.owner()'), 'my-quick-note');
            // Native file picker change takes the same shared installer path.
            await js(`(() => { const input = document.querySelector('input[type=file][accept=".js,.mjs"]'); const transfer = new DataTransfer(); transfer.items.add(new File([pluginTest.sample.replace("version: '1.0.0'", "version: '2.0.0'")], 'updated.js')); input.files=transfer.files; input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
            await wait('pluginTest.state()[0]?.version === "2.0.0"');
            assert.equal(await js('pluginTest.state().length'), 1, 'same ID updates instead of duplicating');
            assert.match(await js('pluginTest.install("export default {}", "bad.txt")'), /js|mjs/i);
            assert.ok(await js('pluginTest.install("export default {}")'));
            assert.ok(await js('pluginTest.install("this is not javascript")'));
            assert.ok(await js('pluginTest.install(pluginTest.sample.replace("my-quick-note:note", pluginTest.builtinType))'));
            assert.ok(await js('pluginTest.install(pluginTest.sample.replace("id: \'my-quick-note\'", "id: \'" + pluginTest.builtinId + "\'"))'));
            assert.ok(await js('pluginTest.install(pluginTest.sample.replace("width: 280", "width: -1"))'));
            assert.ok(await js('pluginTest.install(pluginTest.sample.replace("id: \'my-quick-note\'", "id: \'other-plugin\'"))'));
            assert.ok(await js('pluginTest.install(pluginTest.sample.replace("version: \'1.0.0\',", "version: \'3.0.0\', css: \'body { --bad-plugin: 1; }\', setup() { throw Error(\'setup failed\'); },"))'));
            assert.equal(await js('pluginTest.state()[0].version'), '2.0.0', 'failed update retains previous record');
            assert.equal(await js('pluginTest.registered()'), true, 'failed setup restores previous node');
            assert.equal(await js('!!document.getElementById("canvas-plugin-style-my-quick-note")'), false);
            await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("节点开发文档")).click()');
            await wait('document.querySelector("[data-plugin-guide]")?.textContent.includes("ctx.updateMetadata")');
            await wait('document.querySelector("[data-plugin-guide]")?.checkVisibility({checkOpacity:true})');
            assert.ok(await js('Array.from(document.querySelectorAll("button")).some(b=>b.textContent.includes("下载示例"))'));
            const downloaded = new Promise((resolve, reject) => win.webContents.session.once('will-download', (_event, item) => {
                const path = join(profile, item.getFilename()); item.setSavePath(path);
                item.once('done', (_event, state) => state === 'completed' ? resolve(path) : reject(Error('sample download failed: ' + state)));
            }));
            await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("下载示例")).click()');
            assert.equal(readFileSync(await downloaded, 'utf8'), await js('pluginTest.sample'));
            if (process.env.CANVAS_PLUGIN_SCREENSHOT) {
                await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
                await js('Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations !== Infinity).map(a=>a.finished.catch(()=>{})))');
                writeFileSync(process.env.CANVAS_PLUGIN_SCREENSHOT.replace('.png', '-guide.png'), (await win.webContents.capturePage()).toPNG());
            }
            await js('Array.from(document.querySelectorAll(".ant-modal-close")).at(-1).click()');
            await wait('document.querySelector("[data-plugin-guide]")?.closest(".ant-modal-wrap")?.style.display === "none"');
            if (process.env.CANVAS_PLUGIN_SCREENSHOT) {
                await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
                writeFileSync(process.env.CANVAS_PLUGIN_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
                await js('pluginTest.theme(true)'); win.setSize(680, 800);
                await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
                writeFileSync(process.env.CANVAS_PLUGIN_SCREENSHOT.replace('.png', '-dark.png'), (await win.webContents.capturePage()).toPNG());
            }
            await js('document.querySelector(".ant-modal-close").click()');
            await drop('document.querySelector("[data-canvas-surface]")', 'canvas-drop.mjs', 'pluginTest.sample.replaceAll("my-quick-note", "canvas-drop")');
            await wait('pluginTest.state().some(p=>p.id === "canvas-drop")');
            // Leave only the tested cached plugin for the process-restart assertion.
            await js('pluginTest.uninstall("canvas-drop")');
            await js('pluginTest.seedNode()');
            await wait('pluginTest.saved().then(p=>p?.find(r=>r.id==="my-quick-note")?.version === "2.0.0")');
            console.log('PLUGIN_INSTALL_OK: modal/canvas drop, picker, replacement, validation, rollback, bundled guide');
        }
        await win.webContents.session.flushStorageData();
        app.exit(0);
    } catch (error) { console.error(error); console.error(await js('document.body.innerText.slice(-2500)')); app.exit(1); }
}).catch(error => { console.error(error); app.exit(1); });
