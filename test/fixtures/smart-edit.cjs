const { app, BrowserWindow, protocol, net, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, writeFile, rm } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createMediaTools } = require('../../desktop/media-tools.cjs');
const { route } = require('../../desktop/protocol.cjs');
protocol.registerSchemesAsPrivileged([{ scheme: 'oneyes-canvas', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
app.setPath('userData', process.env.CANVAS_EDIT_TEST_PROFILE);
app.whenReady().then(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'canvas-edit-ui-')), binaries = resolve('desktop/media-bin'), run = promisify(execFile);
    const ffmpeg = join(binaries, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    for (const color of ['red', 'blue']) await run(ffmpeg, ['-nostdin', '-y', '-f', 'lavfi', '-i', `color=${color}:s=192x128:r=12:d=2`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '2', join(directory, color + '.mp4')]);
    const win = new BrowserWindow({ show: false, width: 720, height: 1000, webPreferences: { preload: join(__dirname, 'smart-edit-preload.cjs'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const engine = createMediaTools({ directory, binaries, changed: state => { if (!win.isDestroyed()) win.webContents.send('edit:state', state); } });
    ipcMain.handle('edit:create', (_, ...args) => engine.create(...args));
    ipcMain.handle('edit:start', async (_, id) => { try { return { data: await engine.start(id) }; } catch (error) { return { error: error.message }; } });
    ipcMain.handle('edit:release', (_, id) => engine.release(id));
    protocol.handle('oneyes-canvas', async request => {
        const url = new URL(request.url);
        if (url.pathname.startsWith('/media-tools/')) return engine.request(request);
        if (/^\/fixture-media\/(red|blue)$/.test(url.pathname)) return new Response(await readFile(join(directory, url.pathname.split('/').at(-1) + '.mp4')), { headers: { 'Content-Type': 'video/mp4' } });
        const target = route(request.url, process.env.CANVAS_EDIT_TEST_ROOT); assert.ok(target.file); return net.fetch(target.file);
    });
    const js = code => win.webContents.executeJavaScript(code);
    const wait = async code => { const until = Date.now() + 30000; while (!await js(code)) { if (Date.now() > until) throw Error('Smart-edit fixture timed out: ' + code); await new Promise(resolve => setTimeout(resolve, 25)); } };
    const click = async text => {
        if (['生成 AI 剪辑清单', '识别缺失字幕'].includes(text)) await wait('!document.querySelector(".ant-modal-confirm")');
        await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}&&b.getClientRects().length).click()`);
        if (['生成清单', '开始识别'].includes(text)) await wait('!document.querySelector(".ant-modal-confirm")');
    };
    const status = value => wait(`editTest.state().nodes.find(n=>n.id==='tool')?.metadata.status===${JSON.stringify(value)}`);
    const screenshot = async suffix => { if (!process.env.CANVAS_EDIT_TEST_SCREENSHOT) return; win.showInactive(); await wait('!Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="输出成片")?.disabled'); await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await js('Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))'); await writeFile(process.env.CANVAS_EDIT_TEST_SCREENSHOT.replace('.png', suffix + '.png'), (await win.webContents.capturePage()).toPNG()); win.hide(); };
    try {
        await win.loadURL(process.argv[2]); await wait('Boolean(window.editTest)');
        if (process.env.CANVAS_EDIT_TEST_PHASE === 'restore') {
            await status('error'); assert.match(await js('document.body.innerText'), /上次剪辑已中断/);
            assert.equal(await js('editTest.state().nodes.find(n=>n.id==="tool").metadata.smartEdit.clips.length'), 2);
            assert.equal(await js('editTest.calls()'), 0); assert.equal(await js('editTest.transcriptions()'), 0);
            await click('输出成片'); await status('success'); assert.ok(await js('editTest.output()') > 0);
            console.log('SMART_EDIT_RESTART_OK: persisted analysis, clips and original media render after process restart; no paid replay');
        } else {
            await click('分析素材'); await status('success');
            assert.equal(await js('editTest.state().nodes.find(n=>n.id==="tool").metadata.smartEdit.clips.length'), 2);
            await js('editTest.move()'); assert.equal(await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="输出成片").disabled'), false);
            await screenshot('-light'); await js('editTest.theme(true)'); await screenshot('-dark'); await js('editTest.theme(false)');
            await js('document.querySelector("[aria-label=保留片段1]").click()');
            assert.equal(await js('editTest.state().nodes.find(n=>n.id==="tool").metadata.smartEdit.clips[0].enabled'), false);
            await click('输出成片'); await status('success'); assert.ok(await js('editTest.output()') > 0); assert.equal(await js('editTest.state().connections.length'), 1);
            await js('editTest.patch({mode:"text"})'); await click('识别缺失字幕'); await wait('document.querySelector(".ant-modal-confirm")'); await click('开始识别'); await status('success');
            assert.equal(await js('editTest.transcriptions()'), 2); await click('识别缺失字幕'); assert.equal(await js('editTest.transcriptions()'), 2, 'existing subtitles are reused');
            await js('editTest.patch({mode:"ai",instruction:"产品短片"})'); await click('生成 AI 剪辑清单'); await wait('document.querySelector(".ant-modal-confirm")'); await click('生成清单'); await status('success'); assert.equal(await js('editTest.calls()'), 1);
            await js('editTest.fail()'); await click('生成 AI 剪辑清单'); await wait('document.querySelector(".ant-modal-confirm")'); await click('生成清单'); await status('error'); assert.equal(await js('editTest.calls()'), 2); assert.match(await js('document.body.innerText'), /模型连接失败/);
            await js('editTest.save()');
            await js('editTest.reset()'); await click('分析素材'); await status('success'); await js('editTest.patch({mode:"ai",instruction:"取消测试"});editTest.hold()');
            await click('生成 AI 剪辑清单'); await wait('document.querySelector(".ant-modal-confirm")'); await click('生成清单'); await status('loading'); await click('停止'); await status('error'); assert.equal(await js('editTest.calls()'), 3);
            await js('editTest.reset()'); await click('分析素材'); await status('success'); await js('editTest.patch({mode:"ai",instruction:"素材改变测试"});editTest.hold()');
            await click('生成 AI 剪辑清单'); await wait('document.querySelector(".ant-modal-confirm")'); await click('生成清单'); await status('loading'); await js('editTest.patch({title:"外部修改"})'); await status('error'); assert.match(await js('document.body.innerText'), /素材或设置已改变/);
            await js('editTest.reset()'); await click('分析素材'); await js('editTest.switch()'); await wait('!document.querySelector("[data-smart-edit-panel]")'); assert.equal(await js('editTest.state().nodes.length'), 2);
            await js('editTest.reset()'); await click('分析素材'); await js('editTest.remove()'); await wait('!document.querySelector("[data-smart-edit-panel]")'); assert.equal(await js('editTest.state().nodes.length'), 2);
            console.log('SMART_EDIT_UI_OK: production/native media protocol, editable selection, render/save, transcription reuse, model errors without replay, cancellation, project isolation, themes');
        }
        await engine.close(); await rm(directory, { recursive: true, force: true }); app.exit(0);
    } catch (error) { console.error(error); console.error(await js('document.body.innerText').catch(() => 'no page')); await engine.close(); app.exit(1); }
}).catch(error => { console.error(error); app.exit(1); });
