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
    const wait = async condition => { const end = Date.now() + 20000; while (!await js(`(window.asyncImageTest || window.generationTest || window.resolutionTest) && (${condition})`)) { if (Date.now() > end) throw Error('Timed out: ' + condition); await new Promise(resolve => setTimeout(resolve, 25)); } };
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
            await js('asyncImageTest.asyncPreference(false)');
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
        for (const edit of [false, true]) for (const mode of ['success', 'json', 'truncated', '524', 'disconnect']) {
            const posts = await js('asyncImageTest.posts()');
            const result = await js(`asyncImageTest.stream(${edit},${JSON.stringify(mode)})`);
            assert.equal(await js('asyncImageTest.posts()'), posts + 1, 'streaming never retries a paid POST or falls back to async');
            assert.equal(result.addedTasks, 0, 'streaming never invents a durable receipt');
            assert.equal(result.request.path, edit ? '/v1/images/edits' : '/v1/images/generations');
            assert.equal(result.request.accept, 'text/event-stream');
            assert.equal(result.request.stream, edit ? 'true' : true);
            assert.equal(result.request.size, '2048x1536');
            assert.equal(Number(result.request.n), 1);
            assert.equal(result.request.images, edit ? 1 : 0);
            if (mode === 'success' || mode === 'json') { assert.equal(result.count, 1); assert.equal(result.size, '2048x1536'); assert.ok(result.dataUrl.startsWith('data:image/png;base64,')); }
            else assert.ok(result.error, 'partial-only, server failure and disconnection cannot become completed images');
        }
        await js('asyncImageTest.asyncPreference(true)');
        console.log('IMAGE_MODE_PREFERENCE_OK: default async recovery survives opt-out/reload; streaming JSON and edits retain parameters, no receipt, no replay or fallback');
        await js('asyncImageTest.startPreviewProbe()');
        await wait('asyncImageTest.previewProbe().stored && asyncImageTest.previewProbe().blocked && asyncImageTest.previewProbe().cached');
        assert.equal(await js('asyncImageTest.previewProbe().ready'), false, 'slow thumbnails must not block original persistence or cache recovery');
        await js('asyncImageTest.finishPreviewProbe()');
        await wait('asyncImageTest.previewProbe().ready');
        await js('asyncImageTest.checkMetadataCache()');
        assert.equal(await js('asyncImageTest.previewProbe().decodes'), 1, 'twelve cache reads avoid decoding; replacing the original invalidates metadata');
        assert.equal(await js('asyncImageTest.previewProbe().replaced'), true);
        await js('asyncImageTest.cleanupPreviewProbe()');
        console.log('IMAGE_ORIGINAL_FAST_PATH_OK: original dimensions and bytes intact, durable cache reused, preview runs independently');
        await win.webContents.session.clearStorageData();
        await win.loadURL(new URL('/__image-resolution', process.argv[2]).href);
        await wait('window.resolutionTest && document.querySelector("[data-image-size-hint]")');
        const choose = async label => {
            assert.equal(await js(`Boolean([...document.querySelectorAll('main button')].find(button => button.textContent.trim() === ${JSON.stringify(label)}))`), true);
            await js(`[...document.querySelectorAll('main button')].find(button => button.textContent.trim() === ${JSON.stringify(label)}).click()`);
        };
        for (const dark of [false, true]) {
            await js(`resolutionTest.reset(); resolutionTest.theme(${dark})`);
            await wait('resolutionTest.size() === "1k@16:9"');
            await choose('4k');
            await wait('resolutionTest.size() === "4k@16:9" && document.querySelector("[data-image-size-hint]").textContent.includes("3840")');
            await js('document.querySelector("input[type=number]").focus(); document.querySelector("input[type=number]").blur()');
            assert.equal(await js('resolutionTest.size()'), '4k@16:9', 'unedited width/height do not erase the selected tier');
            for (const edit of [false, true]) {
                const original = await js(`resolutionTest.generate(${edit})`);
                assert.equal(original.width, 1, 'the small upstream image must never be enlarged to fake the requested size');
                assert.match(original.warning, /3840×2160.*1×1/);
                assert.equal(await js('resolutionTest.requests().at(-1).size'), '3840x2160', 'JSON and multipart must carry the selected dimensions');
            }
            await choose('9:16');
            await wait('resolutionTest.size() === "4k@9:16"');
            await js('resolutionTest.gemini()');
            await wait('document.querySelector("[data-image-size-hint]").textContent === "4K · 9:16"');
            for (const edit of [false, true]) {
                await js(`resolutionTest.generate(${edit})`);
                assert.deepEqual(await js('resolutionTest.requests().at(-1).gemini'), { imageSize: '4K', aspectRatio: '9:16' });
            }
            await choose('9:21');
            await wait('document.querySelector("[data-image-size-hint]").textContent.includes("不支持")');
            const count = await js('resolutionTest.requests().length');
            assert.match(await js('resolutionTest.reject()'), /不支持/);
            assert.equal(await js('resolutionTest.requests().length'), count, 'unsupported combinations must stop before the paid POST');
        }
        await js('resolutionTest.custom()');
        await wait('resolutionTest.size() === "1600x1008"');
        assert.equal(await js('document.querySelector("[data-image-size-hint]").textContent.trim()'), '1600 × 1008');
        await js('document.querySelector("input[type=number]").focus(); document.querySelector("input[type=number]").blur()');
        assert.equal(await js('resolutionTest.size()'), '1600x1008', 'focus/blur must not rewrite unedited dimensions');
        await js('resolutionTest.generate(false)');
        assert.equal(await js('resolutionTest.requests().at(-1).size'), '1600x1008');
        await js('resolutionTest.showNode()');
        await wait('document.querySelector("[data-config-node-settings]")');
        const changeMode = async mode => {
            await js(`[...document.querySelectorAll('.ant-segmented-item')].find(item=>item.textContent.trim()===${JSON.stringify({ image: '生图', video: '视频', text: '文本', audio: '音频' }[mode])}).click()`);
            await wait(`resolutionTest.node().metadata.generationMode === "${mode}"`);
        };
        await changeMode('video');
        await js('resolutionTest.videoSize(); resolutionTest.copyNode()');
        await wait('resolutionTest.size() === "9:16"');
        await changeMode('image');
        await wait('resolutionTest.size() === "4k@16:9"');
        for (const edit of [false, true]) {
            await js(`resolutionTest.generate(${edit})`);
            assert.equal(await js('resolutionTest.requests().at(-1).size'), '3840x2160', 'a copied config node retains image resolution after video switching');
        }
        await changeMode('text'); await changeMode('video');
        assert.equal(await js('resolutionTest.size()'), '9:16', 'video size remains separate');
        assert.equal(await js('resolutionTest.node().metadata.vquality'), '720');
        await changeMode('image');
        assert.equal(await js('resolutionTest.size()'), '4k@16:9');
        console.log('IMAGE_RESOLUTION_OK: real light/dark panel clicks, exact JSON/multipart sizes, native Gemini tiers, preflight rejection and preserved original pixels');
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
        await js('void generationTest.complete()');
        await wait('generationTest.state().every(t => t.status === "saving" && t.images.length) && document.querySelector("[data-node-id] img")');
        assert.equal(await js('document.querySelectorAll("[data-node-id] [role=status]").length'), 0, 'durable originals display while the history writer is blocked');
        await js('generationTest.releaseHistory()');
        await wait('generationTest.state().every(t => t.status === "completed") && document.querySelector("[data-node-id] img")');
        assert.equal(await js('generationTest.posts()'), 2, 'each requested image is submitted exactly once');
        assert.equal(await js('generationTest.orphanWarning()'), false);
        console.log('CANVAS_GENERATION_UI_OK: real generate click, delayed/partial batch receipt binding, light/dark compact animation, reduced motion, completed images, no false errors');
        console.log('IMAGE_EARLY_DISPLAY_OK: original pixels displayed before delayed history writes finish, original task association retained until completion');
        console.log('ASYNC_IMAGE_OK: real IndexedDB receipt and Blob storage, generation/edit, offline reload, download interruption, original canvas target, no duplicate POST');
        app.exit(0);
    } catch (error) { console.error(error); console.error(await js('({body:document.body.innerText.slice(0,1000),api:!!window.asyncImageTest,errors:window.fixtureErrors,submitError:sessionStorage.getItem("submitError"),tasks:window.asyncImageTest?.state(),posts:window.asyncImageTest?.posts()})')); app.exit(1); }
});
