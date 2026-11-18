const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { mkdir, writeFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { createModelCatalog } = require('../../desktop/models.cjs');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'canvas-models-')));
let stored = null, calls = 0, status = 200;
let names = ['gpt-image-2', 'gpt-5.5', 'gpt-4o-mini-tts', 'grok-imagine-video'];
const catalog = createModelCatalog(async (url, init) => {
    assert.equal(url, 'https://api.oneyes.ai/v1/models');
    assert.equal(init.method, 'GET'); assert.equal(init.headers.Authorization, 'Bearer fixture-model-key');
    calls++;
    return Response.json({ data: names.map(id => ({ id })) }, { status });
});
ipcMain.handle('config:read', () => stored);
ipcMain.handle('config:write', (_event, value) => { stored = value; });
ipcMain.handle('diagnostics:report', () => null);
ipcMain.handle('collaboration:call', () => ({ status: 'offline' }));
let recoveryRetries = 0;
const recoveryJobs = [{ key: '00000000-0000-0000-0000-000000000001', taskId: 'original-task', model: 'default::gemini-omni-flash-1.2', provider: 'openai', site: 'https://oneyes.ai', channelId: 'default', state: 'credentials', reason: '请恢复原 API Key 后继续查询', createdAt: Date.now(), parameters: { vquality: '1080p', videoSeconds: '5', size: '16:9' } },
    { key: '00000000-0000-0000-0000-000000000002', model: 'default::wan3.0-video', provider: 'openai', site: 'https://oneyes.ai', channelId: 'default', state: 'unknown', reason: '未取得可靠回执，请先核对官网任务和用量', createdAt: Date.now(), parameters: { vquality: '720p', videoSeconds: '5', size: '16:9' } }];
ipcMain.handle('video-tasks:call', (_event, operation, args) => {
    if (operation === 'list') return recoveryJobs;
    assert.equal(operation, 'retry'); assert.equal(args, recoveryJobs[0].key); recoveryRetries++;
    return recoveryJobs.map(job => job.taskId ? { ...job, state: 'download_error', reason: '下载未完成，已保留原任务' } : job);
});
ipcMain.handle('models:list', async (_event, key) => { try { return { data: await catalog(key) }; } catch (error) { return { error: error.message }; } });
app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1000, height: 780, webPreferences: { preload: resolve('desktop/preload.cjs'), backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } });
    const js = code => win.webContents.executeJavaScript(code).catch(error => { throw new Error(`${error.message}: ${code}`, { cause: error }); });
    const wait = async condition => {
        const end = Date.now() + 20000;
        while (!await js(condition)) { if (Date.now() > end) throw Error(`Timed out: ${condition}`); await new Promise(resolve => setTimeout(resolve, 25)); }
    };
    try {
        await win.loadURL(process.argv[2]);
        await wait('window.modelTest && modelTest.state().updatedAt && !modelTest.state().syncing');
        assert.equal(calls, 1, 'StrictMode startup must share one native discovery');
        const initial = await js('modelTest.state().config');
        assert.equal(initial.models.length, 4);
        for (const key of ['imageModel', 'videoModel', 'textModel', 'audioModel']) assert.ok(initial[key]);
        await js('window.dispatchEvent(new Event("focus"));window.dispatchEvent(new Event("online"));document.dispatchEvent(new Event("visibilitychange"));modelTest.sync()');
        assert.equal(calls, 1, 'rapid lifecycle events must use the shared cache');
        names = ['new-image', 'gpt-5.5', 'grok-imagine-video', 'gpt-4o-mini-tts', 'seedance-2.5'];
        await js('modelTest.expire();window.dispatchEvent(new Event("online"))');
        await wait('!modelTest.state().syncing && modelTest.state().config.models.includes("default::seedance-2.5")');
        assert.equal(calls, 2);
        assert.equal(await js('modelTest.state().config.imageModel'), 'default::new-image');
        assert.equal(await js('modelTest.state().config.channels[0].models.find(model=>model.name==="gpt-image-2").unavailable'), true);
        const before = await js('modelTest.state().config');
        status = 503;
        await js('modelTest.expire();window.dispatchEvent(new Event("focus"))');
        await wait('!modelTest.state().syncing && Boolean(modelTest.state().errors.default)');
        assert.deepEqual(await js('modelTest.state().config'), before);
        assert.equal(calls, 3, 'failed discovery must not retry automatically');
        status = 200; names.push('recovered-image');
        await js('window.dispatchEvent(new Event("online"))');
        await wait('!modelTest.state().syncing && modelTest.state().config.models.includes("default::recovered-image")');
        assert.deepEqual(await js('modelTest.state().errors'), {});
        await js('document.querySelector("[data-testid=open-models]").click()');
        await wait('modelTest.checked("gpt-5.5") === true && !document.querySelector(".ant-drawer-footer .ant-btn-primary").disabled');
        await js('modelTest.toggle("gpt-5.5")');
        await wait('modelTest.checked("gpt-5.5") === false');
        names.push('background-image');
        await js('modelTest.expire();window.dispatchEvent(new Event("focus"))');
        await wait('!modelTest.state().syncing && modelTest.state().config.models.includes("default::background-image")');
        assert.equal(await js('modelTest.checked("gpt-5.5")'), false, 'background sync must preserve unsaved drawer edits');
        await js('document.querySelector(".ant-drawer-footer .ant-btn-primary").click()');
        await wait('modelTest.state().config.channels[0].excludedModels.includes("gpt-5.5")');
        await js('modelTest.expire();window.dispatchEvent(new Event("focus"))');
        await wait('!modelTest.state().syncing');
        assert.ok(!(await js('modelTest.state().config.models')).includes('default::gpt-5.5'));
        assert.ok(JSON.parse(stored).state.config.channels[0].excludedModels.includes('gpt-5.5'));
        await js('document.querySelector("[data-testid=open-models]").click()');
        await wait('modelTest.checked("gpt-5.5") === false && !document.querySelector(".ant-drawer-footer .ant-btn-primary").disabled');
        await js('modelTest.toggle("gpt-5.5");');
        await wait('modelTest.checked("gpt-5.5") === true');
        await js('document.querySelector(".ant-drawer-footer .ant-btn-primary").click()');
        await wait('modelTest.state().config.models.includes("default::gpt-5.5") && !modelTest.state().config.channels[0].excludedModels.includes("gpt-5.5")');
        const availableBeforeCleanup = await js('modelTest.state().config.models');
        status = 503;
        await js('document.querySelector("[data-testid=open-models]").click()');
        await wait('Boolean(document.querySelector(".ant-drawer .ant-alert-error")) && !document.querySelector(".ant-drawer-footer .ant-btn-primary").disabled');
        await js('Array.from(document.querySelectorAll(".ant-drawer button")).find(button=>button.textContent.includes("一键清理")).click()');
        await js('document.querySelector(".ant-drawer-footer .ant-btn-primary").click()');
        await wait('!document.querySelector(".ant-drawer-content-wrapper:not(.ant-drawer-content-wrapper-hidden)")');
        assert.deepEqual(await js('modelTest.state().config.models'), availableBeforeCleanup, 'cleanup after failed refresh must keep all available local models');
        const variants = ['sd-2.5-fullblood', 'sd-2.5-fullblood-line2', 'sd-2.5-fullblood [720p 5-30s ¥6.028/条]', 'sd-2.5-fullblood-line2 [720p 5-30s ¥4.378/条]'];
        status = 200; names = [...variants, 'grok-imagine-video', 'sdxl-1.0', 'gpt-5.5'];
        await js('modelTest.expire();modelTest.video();modelTest.sync()');
        await wait('!modelTest.state().syncing && modelTest.state().config.channels.find(channel=>channel.id==="oneyes-minimax").models.length === 5');
        assert.equal(await js('modelTest.state().config.videoModel'), 'oneyes-minimax::grok-imagine-video');
        win.show(); win.focus();
        await wait('document.hasFocus()');
        for (const name of variants) {
            await js(`modelTest.selectVideo(${JSON.stringify('oneyes-minimax::' + name)})`);
            await js('document.querySelector("[data-testid=video-picker] [role=combobox]").focus()');
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
            win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
            await wait('document.querySelectorAll("[role=option]").length === 5');
            const labels = await js('Array.from(document.querySelectorAll("[role=option]")).map(option=>({name:option.querySelector("[data-model-name]").textContent,information:option.querySelector("[data-model-information]")?.textContent,label:option.textContent}))');
            for (const variant of variants.slice(0, 2)) assert.ok(labels.some(label => label.name === variant && /720p.*¥/.test(label.information)), variant);
            assert.ok(labels.every(label => !/sdxl|gpt-5|OneYes Grok/.test(label.label)));
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
            win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
            await wait(`modelTest.state().config.videoModel === ${JSON.stringify(`oneyes-minimax::${name}`)} && !document.querySelector("[role=listbox]")`);
            const request = await js('modelTest.request()');
            assert.equal(request.model, name);
            assert.equal(request.apiKey, 'fixture-model-key');
        }
        await wait(`modelTest.state().config.videoModel === ${JSON.stringify(`oneyes-minimax::${variants[3]}`)}`);
        await js('modelTest.restore()');
        assert.equal(await js('modelTest.state().config.videoModel'), `oneyes-minimax::${variants[3]}`);
        assert.equal(JSON.parse(stored).state.config.videoModel, `oneyes-minimax::${variants[3]}`);
        console.log('NATIVE_VIDEO_MODEL_VARIANTS_PICKER_EXACT_IDS_AND_GROUP_RESTORE_OK');
        const beforeDisplay = await js('modelTest.state().config'), variantsNames = names;
        const displayModels = require('../../web/src/lib/video-model-display-catalog.json').data;
        names = [...displayModels.flatMap(model => [model.id, model.request_id]), 'veo-3.1-fast [720p 8s ¥0.165/秒]', 'gpt-5.5', 'gpt-image-2'];
        await js('modelTest.expire();modelTest.sync()');
        await wait('!modelTest.state().syncing && modelTest.state().config.models.includes("oneyes-minimax::SD-特价")');
        const oldId = 'oneyes-minimax::veo-3.1-fast [720p 8s ¥0.165/秒]';
        for (const model of displayModels) {
            for (const id of [model.id, model.request_id]) {
                await js(`modelTest.selectVideo(${JSON.stringify('oneyes-minimax::' + id)})`);
                assert.equal((await js('modelTest.request()')).model, id, 'request IDs must retain every character');
            }
        }
        await js(`modelTest.selectVideo(${JSON.stringify(oldId)});modelTest.restore()`);
        assert.equal((await js('modelTest.request()')).model, oldId.split('::')[1]);
        for (const theme of ['light', 'dark']) {
            if (theme === 'dark') {
                await new Promise(resolve => { win.once('resize', resolve); win.setSize(420, 780); });
                await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
                win.focus(); await wait('document.hasFocus()');
            }
            await js(`setRecoveryTheme(${JSON.stringify(theme)});document.querySelector('[data-testid=video-picker] [role=combobox]').focus()`);
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
            await wait('document.querySelectorAll("[role=option]").length === 52');
            const rows = await js('Array.from(document.querySelectorAll("[role=option]")).map(option=>{const name=option.querySelector("[data-model-name]"),info=option.querySelector("[data-model-information]");return {id:option.getAttribute("data-model-id"),name:name.textContent,info:info?.textContent,separate:info&&info.getBoundingClientRect().top>=name.getBoundingClientRect().bottom}})');
            assert.ok(rows.every(row => row.separate && /¥/.test(row.info)), 'every video model must have its information on a second line');
            const bounds = await js('(()=>{const r=document.querySelector("[role=listbox]").getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth}})()');
            assert.ok(bounds.left >= 0 && bounds.right <= bounds.width, 'two-line model list must fit narrow windows');
            assert.equal(new Set(rows.filter(row => row.id.startsWith('oneyes-minimax::')).map(row => row.name)).size, 26);
            const recommended = 'oneyes-minimax::veo-3.1-fast [720p-4k 4/6/8s ¥0.165/秒起]';
            assert.equal(rows.find(row => row.id === recommended).info, '720p-4k 4/6/8s ¥0.165/秒起');
            assert.ok(!rows.some(row => row.id === oldId), 'compatibility aliases are not new choices');
            assert.equal(await js('document.querySelector("[data-state=checked][role=option]").getAttribute("data-model-id")'), recommended);
            assert.equal((await js('modelTest.request()')).model, oldId.split('::')[1], 'opening the menu cannot rewrite a saved request ID');
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'S' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'S' });
            await wait('document.activeElement?.querySelector("[data-model-name]")?.textContent.toLowerCase().startsWith("s")');
            if (!process.env.CI) {
                await mkdir('.secrets', { recursive: true });
                await writeFile(`.secrets/qa-model-information-${theme}.png`, (await win.webContents.capturePage()).toPNG());
            }
            await js(`document.querySelector('[aria-label="搜索视频模型"]').focus()`);
            await win.webContents.insertText('4/6/8s');
            await wait('document.querySelectorAll("[role=option]").length === 4');
            assert.ok((await js('Array.from(document.querySelectorAll("[role=option]")).map(option=>option.textContent)')).every(label => label.includes('4/6/8s')));
            for (const query of ['SD-特价', '¥0.165']) {
                await js('document.querySelector("input[type=search]").focus();document.querySelector("input[type=search]").select()');
                await win.webContents.insertText(query);
                await wait(`document.querySelectorAll("[role=option]").length === ${query === 'SD-特价' ? 2 : 4}`);
                assert.ok((await js('Array.from(document.querySelectorAll("[role=option]")).map(option=>option.textContent)')).every(label => label.includes(query)));
            }
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
            await wait('!document.querySelector("[role=listbox]")');
        }
        await new Promise(resolve => { win.once('resize', resolve); win.setSize(1000, 780); });
        await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        win.focus(); await wait('document.hasFocus()');
        await js('document.querySelector("[data-testid=video-picker] [role=combobox]").focus()');
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
        await wait('Boolean(document.querySelector("[role=listbox]"))');
        await js('document.querySelector("[role=option][data-state=checked]").focus()');
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
        await wait('!document.querySelector("[role=listbox]") && modelTest.state().config.videoModel === "oneyes-minimax::veo-3.1-fast [720p-4k 4/6/8s ¥0.165/秒起]"');
        assert.equal((await js('modelTest.request()')).model, 'veo-3.1-fast [720p-4k 4/6/8s ¥0.165/秒起]', 'only explicit selection adopts a recommended request ID');
        for (const kind of ['text', 'image']) {
            await js(`document.querySelector('[data-testid=${kind}-picker] [role=combobox]').focus()`);
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
            await wait('Boolean(document.querySelector("[role=listbox]"))');
            const ids = await js('Array.from(document.querySelectorAll("[role=option]")).map(option=>option.getAttribute("data-model-id"))');
            assert.ok(ids.includes(kind === 'text' ? 'default::gpt-5.5' : 'default::gpt-image-2'), 'price filtering cannot hide text/image models');
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
            await wait('!document.querySelector("[role=listbox]")');
        }
        assert.equal(recoveryRetries, 0);
        await js(`modelTest.replace(${JSON.stringify(beforeDisplay)})`); names = variantsNames;
        await js('modelTest.expire();modelTest.sync()'); await wait('!modelTest.state().syncing');
        console.log('NATIVE_MODEL_INFORMATION_26_CANONICAL_TWO_LINES_THEMES_TYPEAHEAD_EXACT_OLD_IDS_AND_TEXT_IMAGE_VISIBILITY_OK');
        const beforeRetirement = await js('modelTest.state().config'), originalNames = names;
        const legacyVideos = ['seedance-2.0', 'doubao-seedance-2.0-fast', 'seedance-2.0-mini', 'seedance-2.0 [720p ¥1/秒]'];
        const activeVideos = displayModels.filter(model => ['doubao-seedance-2.0', 'doubao-seedance-2.5'].includes(model.id)).map(model => model.request_id);
        names = [...legacyVideos, ...activeVideos];
        await js('modelTest.expire();modelTest.sync()');
        await wait('!modelTest.state().syncing && modelTest.state().config.models.includes("oneyes-minimax::seedance-2.0")');
        await js('modelTest.selectVideo("oneyes-minimax::seedance-2.0")');
        const oldVideo = await js('modelTest.state().config');
        names = activeVideos;
        await js('modelTest.expire();modelTest.sync()');
        await wait('!modelTest.state().syncing && document.querySelector("[data-testid=video-picker] [aria-invalid=true]")');
        const retired = await js('modelTest.state().config');
        assert.equal(retired.videoModel, oldVideo.videoModel);
        for (const key of ['vquality', 'videoSeconds', 'size', 'videoGenerateAudio', 'videoWatermark', 'videoModelDefaults']) assert.deepEqual(retired[key], oldVideo[key]);
        assert.match(await js('document.querySelector("[data-testid=video-picker] [role=combobox]").title'), /seedance-2.0.*暂不可用，请重新选择/);
        await js('document.querySelector("[data-testid=video-picker] [role=combobox]").focus()');
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
        await wait('Boolean(document.querySelector("[role=listbox]"))');
        const offered = await js('Array.from(document.querySelectorAll("[role=option]")).map(option=>option.getAttribute("data-model-id"))');
        assert.ok(offered.every(id => !legacyVideos.some(name => id === 'default::' + name || id === 'oneyes-minimax::' + name)));
        assert.ok(offered.includes('oneyes-minimax::' + activeVideos[0]));
        await js(`Array.from(document.querySelectorAll("[role=option]")).find(option=>option.getAttribute("data-model-id")===${JSON.stringify('oneyes-minimax::' + activeVideos[0])}).focus()`);
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
        await wait(`!document.querySelector("[role=listbox]") && modelTest.state().config.videoModel === ${JSON.stringify('oneyes-minimax::' + activeVideos[0])}`);
        assert.equal((await js('modelTest.request()')).model, activeVideos[0]);
        assert.equal(recoveryRetries, 0, 'model refresh cannot retry or resubmit any previous task');
        await js(`modelTest.replace(${JSON.stringify(beforeRetirement)})`); names = originalNames;
        await js('modelTest.expire();modelTest.sync()');
        await wait('!modelTest.state().syncing');
        console.log('NATIVE_RETIRED_VIDEO_IDS_HIDDEN_EXPLICIT_SELECTION_NO_PRICING_REMAP_OR_TASK_REPLAY_OK');
        await js('showModelCanvas()');
        await wait('window.modelNodeTest && document.querySelector("[data-node-id=config] [role=combobox]")');
        for (const [scale, x, y, dark] of [[1, 40, 40, false], [0.5, 650, 580, true], [1.8, 10, 20, false], [1, 650, 40, true]]) {
            await js(`modelNodeTest.configure(${scale},${x},${y},${dark});document.querySelector("[data-node-id=config] [role=combobox]").focus()`);
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
            win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
            await wait('Boolean(document.querySelector("[role=listbox]"))');
            await wait('document.querySelector("[role=listbox]").getAnimations().every(animation=>animation.playState==="finished")');
            const bounds = await js(`(()=>{const popup=document.querySelector('[role=listbox]'),viewport=popup.querySelector('[data-radix-select-viewport]'),rect=popup.getBoundingClientRect(),inside=viewport.getBoundingClientRect();return {popup:rect.toJSON(),viewport:inside.toJSON(),width:innerWidth,height:innerHeight,z:getComputedStyle(popup).zIndex};})()`);
            assert.ok(bounds.popup.left >= 0 && bounds.popup.right <= bounds.width && bounds.popup.top >= 0 && bounds.popup.bottom <= bounds.height, 'model list must stay inside the window');
            assert.ok(bounds.viewport.right <= bounds.popup.right && bounds.viewport.left >= bounds.popup.left, 'scaled model trigger must not force the list viewport outside its popup');
            const textBounds = await js('Array.from(document.querySelectorAll("[role=option]")).map(option=>{const text=option.lastElementChild.lastElementChild.lastElementChild;return {text:text.textContent,right:text.getBoundingClientRect().left+text.scrollWidth,height:text.clientHeight,scrollHeight:text.scrollHeight};})');
            assert.ok(textBounds.every(text=>text.right<=bounds.viewport.right && text.scrollHeight<=text.height), 'full model versions must wrap without hidden text: '+JSON.stringify(textBounds));
            const wheel = { x: Math.round(bounds.viewport.x + bounds.viewport.width / 2), y: Math.round(bounds.viewport.y + bounds.viewport.height / 2) };
            const beforeScroll = await js('document.querySelector("[data-radix-select-viewport]").scrollTop');
            if (await js('(()=>{const viewport=document.querySelector("[data-radix-select-viewport]");return viewport.scrollHeight>viewport.clientHeight+viewport.scrollTop})()')) {
                win.webContents.sendInputEvent({ type: 'mouseMove', ...wheel });
                win.webContents.sendInputEvent({ type: 'mouseWheel', deltaX: 0, deltaY: -120, ...wheel });
                await wait(`document.querySelector("[data-radix-select-viewport]").scrollTop > ${beforeScroll}`);
            }
            if (process.env.ONEYES_MODEL_SCREENSHOTS) {
                await mkdir(process.env.ONEYES_MODEL_SCREENSHOTS, { recursive: true });
                await writeFile(join(process.env.ONEYES_MODEL_SCREENSHOTS, `config-model-${scale}-${dark ? 'dark' : 'light'}.png`), (await win.capturePage()).toPNG());
            }
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'End' });
            win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'End' });
            await wait('document.activeElement === Array.from(document.querySelectorAll("[role=option]")).at(-1)');
            const target = await js(`(()=>{const item=document.activeElement,r=item.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),visible:item.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)),model:item.getAttribute('data-model-id'),text:item.textContent.trim()};})()`);
            assert.equal(target.visible, true, 'last model must be clickable above neighboring nodes');
            assert.notEqual((await js('modelNodeTest.state()')).metadata.model, target.model);
            win.webContents.sendInputEvent({ type: 'mouseMove', x: target.x, y: target.y });
            win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: target.x, y: target.y });
            win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: target.x, y: target.y });
            await wait('!document.querySelector("[role=listbox]")');
            assert.equal((await js('modelNodeTest.state()')).metadata.model, target.model);
            const selectedMetadata = (await js('modelNodeTest.state()')).metadata;
            assert.ok(['480', '720'].includes(selectedMetadata.vquality));
            assert.ok(Number(selectedMetadata.seconds) >= 1 && Number(selectedMetadata.seconds) <= 5, 'explicit model selection must apply its minimum duration atomically');
            assert.ok(['frames', 'reference'].includes(selectedMetadata.videoMode));
            assert.deepEqual(await js('modelNodeTest.events()'), { drag: 0, background: 0, viewport: 0 }, 'model list interaction must not drag or zoom the canvas');
        }
        console.log('NATIVE_CONFIG_MODEL_LIST_ZOOM_EDGES_OVERLAP_AND_POINTER_SELECTION_OK');
        const toolbarLayout = `(()=>{const toolbar=document.querySelector('[data-node-toolbar]'),node=document.querySelector('[data-node-id="'+modelNodeTest.state().id+'"]');if(!toolbar||!node)return null;const t=toolbar.getBoundingClientRect(),n=node.getBoundingClientRect(),b=toolbar.offsetParent.getBoundingClientRect(),s=getComputedStyle(toolbar);return {visible:s.visibility==='visible',separate:t.bottom<=n.top-1||t.top>=n.bottom+1||t.right<=n.left-1||t.left>=n.right+1,inside:t.left>=b.left+11&&t.right<=b.right-11&&t.top>=b.top+75&&t.bottom<=b.bottom-11,background:s.backgroundColor,color:s.color,toolbar:t.toJSON(),node:n.toJSON()}})()`;
        for (const [scale, x, y, dark, copy] of [[1,60,180,true,false],[1,60,50,true,true],[0.65,-20,70,false,false],[1,-280,440,false,true],[0.55,620,540,true,false]]) {
            await js(`modelNodeTest.toolbar(${scale},${x},${y},${dark},true,${copy})`);
            await wait(`(()=>{const r=${toolbarLayout};return r?.visible&&r.separate&&r.inside})()`);
            const layout = await js(toolbarLayout);
            assert.equal(layout.background, dark ? 'rgba(31, 29, 26, 0.96)' : 'rgba(251, 250, 247, 0.96)');
            assert.equal(layout.color, dark ? 'rgb(245, 245, 244)' : 'rgb(41, 37, 36)');
            await wait(`getComputedStyle(document.querySelector('[data-node-id="'+modelNodeTest.state().id+'"] .ant-btn-dangerous')).color==='rgb(255, 255, 255)'`);
            const target = await js(`(()=>{const b=[...document.querySelectorAll('[data-node-toolbar] button')].find(b=>b.textContent.includes('生成配置')),r=b.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),visible:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);
            assert.equal(target.visible, true);
            const before = (await js('modelNodeTest.actions()')).length;
            win.webContents.sendInputEvent({ type: 'mouseMove', x: target.x, y: target.y });
            win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: target.x, y: target.y });
            win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: target.x, y: target.y });
            await wait(`modelNodeTest.actions().length===${before+1}`);
            assert.equal((await js('modelNodeTest.actions()')).at(-1), 'config');
        }
        // Follow real transformed geometry rather than stale model coordinates.
        await js(`modelNodeTest.toolbar(0.65,60,180,true,true,true);document.querySelector('main').style.marginLeft='160px';document.querySelector('main').style.width='calc(100% - 160px)'`);
        await wait(`(()=>{const r=${toolbarLayout};return r?.visible&&r.separate&&r.inside})()`);
        const previousToolbar = await js(toolbarLayout);
        await js(`document.querySelector('[data-node-id=config-copy]').style.transform='translate(180px,220px)'`);
        await wait(`(()=>{const r=${toolbarLayout};return r?.visible&&r.separate&&r.inside&&Math.abs(r.toolbar.top-${previousToolbar.toolbar.top})>30})()`);
        const stopPoint = await js(`(()=>{const b=document.querySelector('[data-node-id=config-copy] .ant-btn-dangerous'),r=b.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),visible:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);
        assert.equal(stopPoint.visible, true);
        win.webContents.sendInputEvent({ type: 'mouseMove', x: stopPoint.x, y: stopPoint.y });
        win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: stopPoint.x, y: stopPoint.y });
        win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: stopPoint.x, y: stopPoint.y });
        await wait('modelNodeTest.actions().at(-1)==="stop" && modelNodeTest.state().metadata.status==="idle"');
        if (process.env.ONEYES_MODEL_SCREENSHOTS) await writeFile(join(process.env.ONEYES_MODEL_SCREENSHOTS, 'config-toolbar-dark.png'), (await win.capturePage()).toPNG());
        await js(`modelNodeTest.toolbar(1,0,-1500,true)`);
        await wait('getComputedStyle(document.querySelector("[data-node-toolbar]")).visibility==="hidden"');
        await js('modelNodeTest.mount(false)');
        assert.equal(await js('Boolean(document.querySelector("[data-node-toolbar]"))'), false);
        await js('modelNodeTest.toolbar(1,0,180,true);modelNodeTest.mount(true)');
        await wait(`(()=>{const r=${toolbarLayout};return r?.visible&&r.separate&&r.inside})()`);
        console.log('NATIVE_CONFIG_TOOLBAR_ACTUAL_GEOMETRY_ZOOM_COPY_EDGES_SIDEBAR_THEME_STOP_AND_CLICK_OK');
        console.log('NATIVE_MODEL_CATALOG_AUTO_SYNC_CACHE_DEFAULTS_ERRORS_AND_DRAFTS_OK');
        await js('showMentionPreferences()');
        await wait('window.mentionTest && document.getElementById("auto-refresh-mention-images")');
        assert.equal(await js('modelTest.state().config.autoRefreshMentionImages'), false, 'existing behavior remains the default');
        const toggle = async checked => {
            await js('document.getElementById("auto-refresh-mention-images").focus()');
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
            win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
            await wait(`document.getElementById("auto-refresh-mention-images").getAttribute("aria-checked") === "${checked}"`);
            assert.equal(JSON.parse(stored).state.config.autoRefreshMentionImages, checked);
            await js('modelTest.restore()');
            assert.equal(await js('modelTest.state().config.autoRefreshMentionImages'), checked, 'preference must survive hydration');
        };
        const focusEditor = async selector => js(`(()=>{const editor=document.querySelector(${JSON.stringify(selector)}+' [contenteditable=true]');editor.focus();const text=editor.lastChild,range=document.createRange();range.setStart(text,text.textContent.length);range.collapse(true);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);window.mentionCaret={node:selection.anchorNode,offset:selection.anchorOffset,editor};})()`);
        const assertCaret = async () => assert.equal(await js('document.activeElement===mentionCaret.editor && getSelection().anchorNode===mentionCaret.node && getSelection().anchorOffset===mentionCaret.offset'), true, 'image refresh must preserve the live caret and draft');
        for (const selector of ['[data-testid=mention-composer]', '[data-testid=mention-prompt]']) {
            await focusEditor(selector);
            const old = await js(`document.querySelector(${JSON.stringify(selector)}+' [contenteditable=true] img').src`);
            await js(`mentionTest.replace(${JSON.stringify(selector.includes('composer') ? 'blue' : 'green')})`);
            await assertCaret();
            assert.equal(await js(`document.querySelector(${JSON.stringify(selector)}+' [contenteditable=true] img').src`), old, 'disabled must retain the existing focused editor behavior');
            assert.equal((await js('mentionTest.state()')).context.referenceImages[0].dataUrl, (await js('mentionTest.state()')).image, 'generation continues to use the current source');
        }
        await toggle(true);
        for (const [index, selector] of ['[data-testid=mention-composer]', '[data-testid=mention-prompt]'].entries()) {
            await focusEditor(selector);
            const before = await js('mentionTest.state()');
            await js(`document.activeElement.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));mentionTest.replace(${JSON.stringify(index ? 'orange' : 'purple')})`);
            await wait(`Array.from(document.querySelectorAll(${JSON.stringify(selector)}+' [contenteditable=true] img')).every(image=>image.src===mentionTest.state().image)`);
            await assertCaret();
            const after = await js('mentionTest.state()');
            assert.equal(after.edits, before.edits, 'refresh cannot emit edits or submit generation');
            assert.equal(after.composer, before.composer); assert.equal(after.prompt, before.prompt);
            await js("document.activeElement.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))");
            await js(`document.querySelector(${JSON.stringify(selector)}+' [contenteditable=true] img').parentElement.click()`);
            await wait('Array.from(document.querySelectorAll("[role=dialog] img")).some(image=>image.src===mentionTest.state().image)');
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
            win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
            await wait('!document.querySelector("[role=dialog]")');
        }
        await toggle(false);
        await focusEditor('[data-testid=mention-composer]');
        const old = await js('document.querySelector("[data-testid=mention-composer] [contenteditable=true] img").src');
        await js('mentionTest.replace("pink")');
        assert.equal(await js('document.querySelector("[data-testid=mention-composer] [contenteditable=true] img").src'), old);
        await toggle(true);
        await wait('Array.from(document.querySelectorAll("[contenteditable=true] img")).every(image=>image.src===mentionTest.state().image)');
        console.log('NATIVE_MENTION_IMAGE_PREFERENCE_RESTORE_REFRESH_PREVIEW_CARET_AND_EXISTING_BEHAVIOR_OK');
        const preferredModel = await js('modelTest.state().config.videoModel');
        const preferenceKey = 'oneyes-minimax::sd-2.5-fullblood-line2';
        await wait('Boolean(document.querySelector("[data-testid=video-model-defaults] input[type=number]"))');
        const selectionBeforePreference = await js('({model:modelTest.state().config.videoModel,seconds:modelTest.state().config.videoSeconds})');
        await js('(()=>{const input=document.querySelector("[data-testid=video-model-defaults] input[type=number]");input.focus();input.select()})()');
        await win.webContents.insertText('11');
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
        await wait(`modelTest.state().config.videoModelDefaults[${JSON.stringify(preferenceKey)}]?.videoSeconds === '11'`);
        assert.deepEqual(await js('({model:modelTest.state().config.videoModel,seconds:modelTest.state().config.videoSeconds})'), selectionBeforePreference, 'editing preferences must not alter the current video selection');
        await js('modelTest.restore()');
        assert.equal(JSON.parse(stored).state.config.videoModelDefaults[preferenceKey].videoSeconds, '11');
        assert.equal((await js(`modelTest.state().config.videoModelDefaults[${JSON.stringify(preferenceKey)}]`)).videoSeconds, '11');
        await js(`modelTest.selectVideo('oneyes-minimax::grok-imagine-video');modelTest.selectVideo(${JSON.stringify(preferredModel)})`);
        assert.equal(await js('modelTest.state().config.videoSeconds'), '11', 'selection must apply the saved model preference');
        await js('Array.from(document.querySelectorAll("[data-testid=video-model-defaults] button")).find(button=>button.textContent.includes("恢复最低配置")).click()');
        await wait(`!modelTest.state().config.videoModelDefaults[${JSON.stringify(preferenceKey)}]`);
        assert.equal(await js('modelTest.state().config.videoSeconds'), '11', 'reset preference must not modify an existing selection');
        await js(`modelTest.selectVideo('oneyes-minimax::grok-imagine-video');modelTest.selectVideo(${JSON.stringify(preferredModel)})`);
        assert.equal(await js('modelTest.state().config.videoSeconds'), '5', 'reset preference takes effect on the next explicit selection');
        console.log('NATIVE_VIDEO_MODEL_PREFERENCES_AUTOSAVE_REHYDRATE_SWITCH_AND_RESET_OK');
        await js('showClipboardCanvas()');
        await wait('window.clipboardTest && document.querySelector("[data-node-id=first]")');
        const original = await js('clipboardTest.state()');
        const shortcut = async key => {
            await js('document.activeElement?.blur();window.getSelection()?.removeAllRanges()');
            const modifiers = [process.platform === 'darwin' ? 'meta' : 'control'];
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers });
            win.webContents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers });
        };
        await shortcut('a'); await shortcut('c');
        const batches = [], contexts = new Map();
        for (let index = 0; index < 2; index++) {
            await shortcut('v');
            await wait(`clipboardTest.state().nodes.length === ${original.nodes.length * (index + 2)}`);
            const project = await js('clipboardTest.state()'), batch = project.nodes.slice(-original.nodes.length);
            batches.push(batch);
            for (const config of batch.filter(node => node.type === 'config')) {
                const context = await js(`clipboardTest.context(${JSON.stringify(config.id)})`);
                contexts.set(config.id, context.referenceImages);
                assert.equal(context.imageCount, 2, 'pasted @ tokens must resolve both images after removing original nodes');
                const expectedImages = ['blue', 'red'].map(color => batch.find(node => node.id.startsWith(color+'-') || node.metadata?.storageKey === original.nodes.find(node=>node.id===color).metadata.storageKey));
                assert.deepEqual(context.referenceImages.map(image => image.id), expectedImages.map(image => image.id));
                assert.deepEqual(context.referenceImages.map(image => image.storageKey), expectedImages.map(image => image.metadata.storageKey));
                assert.ok(context.referenceImages.every(image => image.dataUrl.startsWith('data:image/')), 'local originals must still hydrate');
                assert.equal(config.metadata.quality, 'high'); assert.equal(config.metadata.size, '16:9');
                assert.ok(!/@\[node:(red|blue)\]/.test(config.metadata.composerContent));
            }
            const group = batch.find(node => node.type === 'group');
            assert.ok(batch.filter(node => node.type === 'image').every(node => node.metadata.groupId === group.id));
            await wait(`document.querySelectorAll('[contenteditable=true] [data-reference-node-id]').length === 3`);
        }
        assert.notEqual(batches[0][0].metadata.composerContent, batches[1][0].metadata.composerContent, 'repeated paste must create independent references');
        assert.deepEqual((await js('clipboardTest.state()')).nodes.slice(0, original.nodes.length), original.nodes, 'original graph must not change');
        await js('clipboardTest.flush()');
        const saved = await js('clipboardTest.state()');
        await win.loadURL(process.argv[2]);
        await wait('Boolean(window.showClipboardCanvas)');
        await js('showClipboardCanvas()');
        await wait(`document.querySelectorAll('[data-node-id]').length === ${saved.nodes.length}`);
        const restored = await js('clipboardTest.state()');
        const stableNodes = nodes => JSON.parse(JSON.stringify(nodes.map(node => node.metadata?.storageKey ? { ...node, metadata: { ...node.metadata, content: undefined } } : node)));
        assert.deepEqual(stableNodes(restored.nodes), stableNodes(saved.nodes)); assert.deepEqual(restored.connections, saved.connections);
        for (const [id, images] of contexts) assert.deepEqual((await js(`clipboardTest.context(${JSON.stringify(id)})`)).referenceImages, images, 'reopened references must load the same original bytes via new blob URLs');
        console.log('NATIVE_CANVAS_BULK_COPY_MENTIONS_MULTI_IMAGE_ORDER_GROUP_SHARED_INPUTS_REPEAT_PASTE_AND_RESTORE_OK');
        await js('showVideoRecovery()');
        await wait('document.querySelector(".ant-modal-body")?.textContent.includes("等待恢复凭据")');
        const recovery = await js('document.querySelector(".ant-modal-body").textContent');
        assert.match(recovery, /提交待核实/); assert.match(recovery, /不会重新生成、重复付费/); assert.match(recovery, /记录编号：00000000-0000-0000-0000-000000000001/);
        assert.doesNotMatch(recovery, /original-task|https:\/\//, 'ordinary recovery details expose local records, never service task IDs or sites');
        assert.equal(await js('[...document.querySelectorAll(".ant-modal-body button")].filter(button=>button.textContent.includes("重试查询")).length'), 1, 'an unknown submission cannot offer paid automatic regeneration');
        await js('[...document.querySelectorAll(".ant-modal-body button")].find(button=>button.textContent.includes("重试查询")).click()');
        await wait('document.querySelector(".ant-modal-body")?.textContent.includes("视频结果取回未完成")');
        assert.equal(recoveryRetries, 1);
        if (!process.env.CI) {
            await mkdir('.secrets', { recursive: true });
            for (const theme of ['light', 'dark']) {
                await js(`setRecoveryTheme(${JSON.stringify(theme)})`);
                await new Promise(resolve => setTimeout(resolve, 100));
                await writeFile(`.secrets/qa-video-recovery-${theme}.png`, (await win.webContents.capturePage()).toPNG());
            }
        }
        console.log('VIDEO_RECOVERY_UI_OK: real native IPC, original receipt, credentials and uncertain state, retry query, no new generation action');
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});
