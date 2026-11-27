const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const { readClipboard } = require('../../desktop/clipboard.cjs');
let clipboardValue = 'text', clipboardReads = 0, resolveClipboard;
const clipboardText = '  中文提示词\n第二行  ';
ipcMain.handle('clipboard:read', () => {
    clipboardReads++;
    if (clipboardValue === 'denied') throw Error('fixture clipboard failure');
    if (clipboardValue === 'pending') return new Promise(resolve => { resolveClipboard = resolve; });
    if (clipboardValue === 'files') return readClipboard({ read: async () => [{
        types: ['text/uri-list'],
        getType: async () => new Blob([['本地 原图#1.PNG', '第二张.png'].map(name => require('node:url').pathToFileURL(join(app.getPath('userData'), name)).href).join('\r\n')]),
    }] });
    return readClipboard({ read: async () => clipboardValue === 'empty' ? [] : [{ types: clipboardValue === 'image' ? ['image/png', 'text/plain'] : ['text/plain'], getType: async type => type === 'image/png' ? new Blob([nativeImage.createFromBitmap(Buffer.alloc(16 * 8 * 4, 255), { width: 16, height: 8 }).toPNG()], { type }) : new Blob([clipboardText], { type }) }] });
});
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { mkdir, readFile, writeFile, unlink } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { createModelCatalog } = require('../../desktop/models.cjs');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'canvas-models-')));
let stored = null, calls = 0, status = 200;
let names = ['gpt-image-2', 'gpt-5.5', 'gpt-4o-mini-tts', 'grok-imagine-video'];
let feedStatus = 200, feedOverride, feedCalls = 0;
const { createVideoCatalog } = require('../../desktop/video-catalog.mjs');
const videoCatalog = createVideoCatalog(async (url, init) => {
    feedCalls++; assert.equal(url, 'https://oneyes.ai/video-models/catalog.json');
    assert.deepEqual(init.headers, { Accept: 'application/json' }); assert.equal(init.credentials, 'omit');
    return Response.json(feedOverride || { schema_version: 1, generated_at: new Date().toISOString(), refresh_after_seconds: 300, check: { stale: false }, data: [{ id: 'grok-imagine-video', model_name: 'grok-imagine-video', model_info: '480p 5s ¥0.385/秒', request_ids: ['grok-imagine-video'], status: 'active', new_tasks_enabled: true, stale: false, price_stale: false, parameters_stale: false }] }, { status: feedStatus });
});
ipcMain.handle('models:videoCatalog', async () => { try { return { data: await videoCatalog() }; } catch { return { error: '模型状态信息更新延迟' }; } });
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
const recoveryRetries = [];
const videoBytes = Buffer.from('recovered video bytes');
let recoveryJobs = [
    { taskId: 'original-task', model: 'gemini-omni-flash-1.2', state: 'credentials', reason: '请恢复原 API Key 后继续查询' },
    { model: 'seedance-2.5-discount [720p 4-30s ¥5.478/条]', state: 'unknown', reason: '未取得可靠回执' },
    { taskId: 'legacy-task', model: 'wan3.0-video', state: 'confirmation', reason: '需确认原账号' },
    { taskId: 'completed-task', model: 'grok-imagine-video-1.5', state: 'saved', target: { projectId: 'removed', nodeId: 'removed' },
        result: { url: 'data:video/mp4;base64,' + videoBytes.toString('base64'), mimeType: 'video/mp4' } },
    { model: 'doubao-seedance-2.5', state: 'submitting' },
    { model: 'seedance-2.5-discount2 【720p 4-30s ¥3.938/条】', state: 'failed', reason: '视频生成未完成，请检查素材或联系管理员核对原任务。' },
].map((job, index) => ({
    ...job,
    key: '00000000-0000-0000-0000-00000000000' + (index + 1),
    diagnosticId: [8, 4, 4, 4, 12].map(length => String(index + 1).repeat(length)).join('-'),
    model: 'default::' + job.model,
    provider: 'openai', site: 'https://oneyes.ai', channelId: 'default',
    createdAt: Date.now() - (6 - index) * 1000000,
    parameters: { vquality: index % 2 ? '720' : '1080p', videoSeconds: '5', size: index % 2 ? 'auto' : '16:9' },
}));
ipcMain.handle('video-tasks:call', (_event, operation, args) => {
    if (operation === 'list') return recoveryJobs;
    assert.equal(operation, 'retry');
    const selected = recoveryJobs.find(job => job.key === args);
    assert.ok(selected?.taskId); recoveryRetries.push(selected.taskId);
    recoveryJobs = recoveryJobs.map(job => job === selected ? { ...job, state: 'download_error', reason: '下载未完成，已保留原任务' } : job);
    return recoveryJobs;
});
ipcMain.handle('models:list', async (_event, key) => { try { return { data: await catalog(key) }; } catch (error) { return { error: error.message }; } });
app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1000, height: 780, webPreferences: { preload: resolve('desktop/preload.cjs'), backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } });
    const js = code => win.webContents.executeJavaScript(code).catch(error => { throw new Error(`${error.message}: ${code}`, { cause: error }); });
    const wait = async condition => {
        const end = Date.now() + 20000;
        for (;;) {
            const result = await js(condition);
            if (result) return result;
            if (Date.now() > end) throw Error(`Timed out: ${condition}; model rows=${JSON.stringify(await js('Array.from(document.querySelectorAll("[role=option]")).map(option=>({id:option.getAttribute("data-model-id"),disabled:option.hasAttribute("data-disabled")}))'))}`);
            await new Promise(resolve => setTimeout(resolve, 25));
        }
    };
    const clickVisible = async target => {
        win.focus();
        await wait('document.hasFocus()');
        await wait(`Boolean(${target})`);
        await wait('[...document.getAnimations()].every(animation=>animation.playState!=="running" || animation.effect?.getComputedTiming().endTime===Infinity)');
        const buttonPoint = `(() => {
            const element = (${target});
            if (!element) return null;
            element.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
            const rect = element.getBoundingClientRect();
            const x = Math.round(rect.x + rect.width / 2);
            const y = Math.round(rect.y + rect.height / 2);
            return element.contains(document.elementFromPoint(x, y)) ? { x, y } : null;
        })()`;
        const { x, y } = await wait(buttonPoint);
        win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
        win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
        win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    };
    try {
        await win.loadURL(process.argv[2]);
        await wait('window.modelTest && modelTest.state().updatedAt && !modelTest.state().syncing');
        assert.equal(calls, 1, 'StrictMode startup must share one native discovery');
        await wait('modelTest.state().feed.catalog && !modelTest.state().feed.delayed');
        assert.equal(feedCalls, 1, 'public status reads share the same five-minute cache');
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
            await wait('document.querySelectorAll("[role=option]:not([data-disabled])").length === 6');
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
            await wait('document.querySelectorAll("[role=option]:not([data-disabled])").length === 52');
            const rows = await js('Array.from(document.querySelectorAll("[role=option]:not([data-disabled])")).map(option=>{const name=option.querySelector("[data-model-name]"),info=option.querySelector("[data-model-information]");return {id:option.getAttribute("data-model-id"),name:name.textContent,info:info?.textContent,separate:info&&info.getBoundingClientRect().top>=name.getBoundingClientRect().bottom}})');
            const rowLayout = await js(`Array.from(document.querySelectorAll('[role=option]')).map(option=>{const name=option.querySelector('[data-model-name]'),info=option.querySelector('[data-model-information]'),status=option.querySelector('[data-model-availability]'),details=option.querySelector('[data-model-info-delayed]'),n=name.getBoundingClientRect(),s=status?.getBoundingClientRect(),i=info?.getBoundingClientRect();return {nameFits:name.scrollWidth<=name.clientWidth,statusSeparate:!s||n.right<=s.left,detailsSeparate:!details||!i||details.getBoundingClientRect().top>=i.bottom,selected:getComputedStyle(option).backgroundColor,id:option.getAttribute('data-model-id')}})`);
            assert.ok(rowLayout.every(row => row.nameFits && row.statusSeparate && row.detailsSeparate), 'name, availability and delayed metadata must occupy separate aligned areas');
            assert.notEqual(await js('getComputedStyle(document.querySelector("[role=option][data-state=checked]")).backgroundColor'), 'rgba(0, 0, 0, 0)', 'the current selection has a persistent background');
            await js('document.querySelector("[data-radix-select-viewport]").scrollTop=100000');
            const searchBounds = await js('(()=>{const input=document.querySelector("input[type=search]"),r=input.getBoundingClientRect();return {visible:input===document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)}})()');
            assert.ok(searchBounds.visible, 'model search must stay visible after scrolling to the bottom');
            assert.equal(await js('document.querySelector("[data-model-search]").getBoundingClientRect().bottom<=document.querySelector("[data-radix-select-viewport]").getBoundingClientRect().top'), true, 'search must be outside the scrolling viewport');
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
            await js('document.querySelector("input[type=search]").select()');
            await win.webContents.insertText('Seedance');
            await wait('document.querySelectorAll("[role=group]").length === 1 && document.querySelector("[data-slot=select-label]")?.textContent === "Seedance"');
            assert.ok(await js('Array.from(document.querySelectorAll("[role=option] [data-model-name]")).some(name => name.textContent === "SD-特价")'));
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
        names.push('未来中文-v9', '未来中文-v9【1080p 5秒 ￥0/条】');
        await js('modelTest.expire();modelTest.sync()'); await wait('!modelTest.state().syncing');
        await js('document.querySelector("[data-testid=video-picker] [role=combobox]").focus()');
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
        await wait('Array.from(document.querySelectorAll("[role=option]:not([data-disabled])")).filter(row=>row.getAttribute("data-model-id")?.startsWith("oneyes-minimax::")).length === 27');
        assert.equal(await js('Array.from(document.querySelectorAll("[role=option]")).find(row=>row.getAttribute("data-model-id")==="oneyes-minimax::未来中文-v9【1080p 5秒 ￥0/条】")?.querySelector("[data-model-name]").textContent'), '未来中文-v9');
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
        await wait('!document.querySelector("[role=listbox]")');
        for (const kind of ['text', 'image']) {
            const trigger = `document.querySelector('[data-testid=${kind}-picker] [role=combobox]')`;
            await js(`${trigger}.focus()`);
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
            const expected = kind === 'text' ? 'default::gpt-5.5' : 'default::gpt-image-2';
            const option = `[role="option"][data-model-id="${expected}"]:not([data-disabled])`;
            // Radix can mount the listbox before positioning its selectable rows.
            await wait(`Boolean(document.getElementById(${trigger}.getAttribute('aria-controls'))?.querySelector(${JSON.stringify(option)}))`);
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
            await wait('!document.querySelector("[role=listbox]")');
        }
        assert.equal(recoveryRetries.length, 0);
        await js(`modelTest.replace(${JSON.stringify(beforeDisplay)})`); names = variantsNames;
        await js('modelTest.expire();modelTest.sync()'); await wait('!modelTest.state().syncing');
        console.log('NATIVE_MODEL_INFORMATION_26_CANONICAL_TWO_LINES_THEMES_TYPEAHEAD_EXACT_OLD_IDS_AND_TEXT_IMAGE_VISIBILITY_OK');
        const beforeStatus = await js('modelTest.state().config'), beforeStatusNames = names;
        const dynamic = require('./video-catalog-dynamic.json');
        feedOverride = { ...dynamic, generated_at: new Date().toISOString() };
        names = dynamic.data.flatMap(model => model.request_ids);
        await js('modelTest.expire();modelTest.sync();modelTest.feedSync()'); await wait('!modelTest.state().syncing');
        const sp = 'oneyes-minimax::SP-特价 [1080p 5-30s ¥2.178/条]';
        await js(`modelTest.selectVideo(${JSON.stringify(sp)})`);
        const dynamicConfig = await js('modelTest.state().config');
        assert.deepEqual([dynamicConfig.vquality, dynamicConfig.videoSeconds, dynamicConfig.videoMode], ['1080', '30', 'reference']);
        await js('document.querySelector("[data-testid=video-picker] [role=combobox]").focus()');
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
        await wait('Boolean(document.querySelector("[role=listbox]"))');
        const dynamicRows = await js('Array.from(document.querySelectorAll("[role=option]")).map(option=>option.getAttribute("data-model-id"))');
        assert.ok(dynamicRows.includes(sp));
        assert.ok(dynamicRows.some(id => id?.includes('future-fixture-v3')));
        assert.ok(dynamicRows.every(id => !/SD-特价|fullblood-line[23]|dedicated-line1/.test(id)));
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
        await wait('!document.querySelector("[role=listbox]")');
        await js(`modelTest.replace(${JSON.stringify(beforeStatus)})`);
        console.log('NATIVE_DYNAMIC_SP_REVIEWED_DEFAULTS_FUTURE_AUTHORIZED_MODEL_AND_HIDDEN_RETIRED_PAUSED_OK');
        const live = require('./video-catalog-public.json');
        feedOverride = { ...live, generated_at: new Date().toISOString() };
        names = live.data.flatMap(model => model.request_ids);
        await js('modelTest.expire();modelTest.sync();modelTest.feedSync()'); await wait('!modelTest.state().syncing');
        await js('modelTest.selectVideo("oneyes-minimax::sd-2.5-fullblood-line2")');
        await wait('document.querySelector("[data-testid=video-picker] [data-video-model-status=retired]")');
        for (const theme of ['light', 'dark']) {
            await js(`setRecoveryTheme(${JSON.stringify(theme)});document.querySelector('[data-testid=video-picker] [role=combobox]').focus()`);
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
            await wait('Boolean(document.querySelector("[role=listbox]"))');
            assert.equal(await js('document.querySelectorAll("[role=option] [data-video-model-status=retired]").length'), 0);
            if (!process.env.CI) await writeFile(`.secrets/qa-model-live-${theme}.png`, (await win.webContents.capturePage()).toPNG());
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
            await wait('!document.querySelector("[role=listbox]")');
        }
        console.log('NATIVE_REAL_PUBLIC_28_MODEL_SAMPLE_26_ACTIVE_TWO_RETIRED_EXACT_IDS_AND_THEME_BADGES_OK');
        const stateNames = ['grok-imagine-video', 'wan3.0-video', 'veo-3.1-fast', 'doubao-seedance-2.5'];
        const stateData = stateNames.map((id, index) => ({ id, model_name: id, request_ids: [id], model_info: '720p 5s ¥1/条', status: ['active', 'retired', 'unavailable', 'active'][index], new_tasks_enabled: index === 0, stale: false, price_stale: index === 0, parameters_stale: index === 0 }));
        names = stateNames;
        feedOverride = { schema_version: 1, generated_at: new Date().toISOString(), refresh_after_seconds: 300, check: { stale: false }, data: stateData };
        await js(`modelTest.replace({...modelTest.state().config,channels:[{...modelTest.state().config.channels[0],models:${JSON.stringify(stateNames.map(name => ({ name, capability: 'video' })))}}],videoModel:'default::wan3.0-video'})`);
        await js('modelTest.expire();modelTest.sync();modelTest.feedSync()');
        await wait('!modelTest.state().syncing');
        await wait('document.querySelector("[data-testid=video-picker] [data-video-model-status=retired]")');
        const statusConfig = await js('modelTest.state().config');
        for (const theme of ['light', 'dark']) {
            await js(`setRecoveryTheme(${JSON.stringify(theme)});document.querySelector('[data-testid=video-picker] [role=combobox]').focus()`);
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
            await wait('document.querySelectorAll("[role=option]").length >= 1');
            const states = (await js('Array.from(document.querySelectorAll("[role=option]")).map(option=>({id:option.getAttribute("data-model-id"),disabled:option.hasAttribute("data-disabled"),text:option.textContent}))')).filter(item => stateNames.some(id => item.id === 'default::' + id));
            assert.equal(states.length, 1, 'retired and admin-paused entries are absent from new choices');
            assert.equal(states.filter(item => item.disabled).length, 0);
            assert.match(states.find(item => !item.disabled).text, /可用.*价格待核实.*参数待更新/);
            assert.doesNotMatch(states.map(item => item.text).join(''), /88api|智赢|https?:\/\//i);
            if (!process.env.CI) await writeFile(`.secrets/qa-model-status-${theme}.png`, (await win.webContents.capturePage()).toPNG());
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
            await wait('!document.querySelector("[role=listbox]")');
        }
        feedStatus = 401; await js('modelTest.feedSync()');
        await wait('document.querySelector("[data-testid=video-picker] [data-model-info-delayed]")');
        assert.equal(await js('modelTest.state().feed.catalog.data[1].status'), 'retired');
        if (!process.env.CI) {
            await js('document.querySelector("[data-testid=video-picker] [role=combobox]").focus()');
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
            await wait('document.querySelector("[role=listbox]")');
            await writeFile('.secrets/qa-model-status-delayed.png', (await win.webContents.capturePage()).toPNG());
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
            await wait('!document.querySelector("[role=listbox]")');
        }
        feedStatus = 200; feedOverride = { ...feedOverride, generated_at: new Date(Date.now() - 661_000).toISOString(), data: stateData.map(item => ({ ...item, status: 'active', new_tasks_enabled: true })) };
        await js('modelTest.feedSync()');
        assert.equal(await js('modelTest.state().feed.catalog.data[1].status'), 'retired', 'an expired false-stale JSON must not revive a confirmed retired model');
        assert.deepEqual(await js('modelTest.state().config'), statusConfig, 'feed failure and refresh must preserve selection and generation parameters');
        feedOverride = undefined;
        names = beforeStatusNames;
        await js(`modelTest.replace(${JSON.stringify(beforeStatus)});modelTest.expire();modelTest.sync();modelTest.feedSync()`);
        await wait('!modelTest.state().syncing');
        assert.equal(recoveryRetries.length, 0);
        console.log('NATIVE_DYNAMIC_VIDEO_STATUS_BADGES_PRIORITY_FAILURE_CACHE_EXPIRY_AND_NO_TASK_REPLAY_OK');
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
        const offered = await js('Array.from(document.querySelectorAll("[role=option]:not([data-disabled])")).map(option=>option.getAttribute("data-model-id"))');
        assert.ok(offered.every(id => !legacyVideos.some(name => id === 'default::' + name || id === 'oneyes-minimax::' + name)));
        assert.equal(await js('Array.from(document.querySelectorAll("[role=option]")).some(option=>option.getAttribute("data-model-id")==="oneyes-minimax::seedance-2.0 [720p ¥1/秒]")'), false, 'missing key rights remain in saved config, not in new choices');
        assert.ok(offered.includes('oneyes-minimax::' + activeVideos[0]));
        await js(`Array.from(document.querySelectorAll("[role=option]")).find(option=>option.getAttribute("data-model-id")===${JSON.stringify('oneyes-minimax::' + activeVideos[0])}).focus()`);
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
        await wait(`!document.querySelector("[role=listbox]") && modelTest.state().config.videoModel === ${JSON.stringify('oneyes-minimax::' + activeVideos[0])}`);
        assert.equal((await js('modelTest.request()')).model, activeVideos[0]);
        assert.equal(recoveryRetries.length, 0, 'model refresh cannot retry or resubmit any previous task');
        await js(`modelTest.replace(${JSON.stringify(beforeRetirement)})`); names = originalNames;
        await js('modelTest.expire();modelTest.sync()');
        await wait('!modelTest.state().syncing');
        console.log('NATIVE_MISSING_VIDEO_IDS_RETAINED_DISABLED_NO_FALSE_RETIREMENT_OR_TASK_REPLAY_OK');
        assert.equal(await js(`(()=>{const picker=document.querySelector('[data-testid=bare-video-picker] [role=combobox]'),name=picker.querySelector('[data-model-name]').getBoundingClientRect(),status=picker.querySelector('[data-video-model-status]').getBoundingClientRect(),bounds=picker.getBoundingClientRect();return name.bottom<=status.top&&status.bottom<=bounds.bottom&&!picker.querySelector('[data-model-information]')})()`), true, 'a video model without specifications must still fit its status below the name');
        // Missing rights are now hidden, so explicitly authorize a long list
        // for the following real scrolling/keyboard layout checks.
        names = displayModels.map(model => model.request_id);
        await js('modelTest.expire();modelTest.sync()'); await wait('!modelTest.state().syncing');
        await js('showModelCanvas()');
        const compactConfig = await js('modelTest.state().config');
        for (const [scale, dark, mode, model] of [[1, true, 'video', 'oneyes-minimax::grok-imagine-video'], [0.65, false, 'video', 'oneyes-minimax::doubao-seedance-2.0-fast-discount [720p 4-15s ¥1.078/条]'], [1.5, true, 'image', compactConfig.imageModel], [1, false, 'text', compactConfig.textModel], [1, true, 'audio', compactConfig.audioModel]]) {
            await js(`modelNodeTest.compact(${scale},${dark},${JSON.stringify(mode)},${JSON.stringify(model)})`);
            await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
            await js('Promise.all(document.getAnimations().filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))');
            const layout = await js(`(()=>{const node=document.querySelector('[data-node-id=config]'),picker=node.querySelector('[role=combobox]'),name=picker.querySelector('[data-model-name]'),info=picker.querySelector('[data-model-information]'),status=picker.querySelector('[data-video-model-status]'),settings=node.querySelector('[data-config-node-settings] button'),controls=node.querySelector('[data-config-node-controls]'),button=node.querySelector('.ant-btn-primary'),rect=element=>element.getBoundingClientRect().toJSON();return {node:rect(node),picker:rect(picker),name:rect(name),info:info&&rect(info),status:status&&rect(status),settings:rect(settings),button:rect(button),controls:rect(controls),textFits:name.scrollWidth<=name.clientWidth&&(!info||info.scrollWidth<=info.clientWidth),label:picker.title}})()`);
            assert.ok(layout.picker.width >= layout.controls.width - 16 * scale && layout.picker.right < layout.node.right, 'model selection must use the node width instead of sharing a narrow row: ' + JSON.stringify(layout));
            assert.equal(layout.textFits, true, 'full name, version and specifications must wrap without ellipsis');
            assert.ok(!layout.info || layout.info.top >= layout.name.bottom - 1, 'specifications belong below the model name');
            assert.ok(!layout.status || layout.status.top >= layout.name.bottom - 1, 'availability must not crowd the model name');
            assert.ok(layout.settings.top >= layout.picker.bottom && layout.controls.bottom <= layout.button.top && layout.button.bottom < layout.node.bottom, 'settings and generation action must remain separate and inside the node');
            assert.ok(layout.label.includes(model.split('::').at(-1).split(' [')[0]));
            if (process.env.ONEYES_MODEL_SCREENSHOTS) {
                await mkdir(process.env.ONEYES_MODEL_SCREENSHOTS, { recursive: true });
                await writeFile(join(process.env.ONEYES_MODEL_SCREENSHOTS, `config-model-compact-${mode}-${scale}-${dark ? 'dark' : 'light'}.png`), (await win.capturePage()).toPNG());
            }
            if (model.endsWith('::grok-imagine-video')) {
                // Font metrics differ by OS; content may scroll, but the parameter action must remain reachable.
                await js('document.querySelector("[data-config-node-controls]").scrollTop=10000;new Promise(resolve=>requestAnimationFrame(resolve))');
                const target = await js(`(()=>{const button=document.querySelector('[data-config-node-settings] button'),r=button.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),visible:button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);
                assert.equal(target.visible, true, 'node scrolling must expose the real parameter action');
                win.webContents.sendInputEvent({ type: 'mouseMove', x: target.x, y: target.y });
                win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: target.x, y: target.y });
                win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: target.x, y: target.y });
                await wait('Boolean(document.querySelector(".canvas-image-settings-popover"))');
                win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: 900, y: 650 });
                win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: 900, y: 650 });
                await wait('!document.querySelector(".canvas-image-settings-popover")');
                await js('document.querySelector("[data-config-node-controls]").scrollTop=0');
            }
        }
        assert.deepEqual(await js('modelTest.state().config'), compactConfig, 'layout changes must preserve model and generation defaults');
        console.log('NATIVE_COMPACT_CONFIG_MODEL_FULL_WIDTH_NAME_VERSION_STATUS_SETTINGS_AND_MODES_OK');
        const videoOnlyNames = names;
        const imageNames = ['gpt-image-2', 'gpt-image-2.6-sunburst', 'custom-image'];
        const geminiNames = ['gemini-3-pro-image', 'gemini-3.1-flash-image', 'nano-banana-2'];
        names = [...names, ...imageNames];
        const imageOptions = models => models.map(name => ({ name, capability: 'image' }));
        const grouped = { ...compactConfig, channels: [
            { ...compactConfig.channels[0], models: [...compactConfig.channels[0].models, ...imageOptions(imageNames)] },
            ...compactConfig.channels.slice(1),
            { id: 'oneyes-gemini', name: 'OneYes Gemini', baseUrl: 'https://oneyes.ai', apiKey: 'fixture-gemini-key', apiFormat: 'gemini',
                models: imageOptions(geminiNames), oneYes: { platform: 'gemini', groupId: 5, keyId: 1, accountId: 7, groupName: 'Gemini' } },
        ] };
        await js('modelTest.replace(' + JSON.stringify(grouped) + ');modelTest.expire();modelTest.sync()');
        await wait('!modelTest.state().syncing');
        const imageTrigger = 'document.querySelector("[data-node-id=config] [role=combobox]")';
        const fromImage = 'default::gpt-image-2.6-sunburst';
        const toImage = 'oneyes-gemini::gemini-3-pro-image';
        const readGroups = () => Array.from(document.querySelectorAll('[role=listbox] [role=group]'), group => {
            const label = document.getElementById(group.getAttribute('aria-labelledby'));
            const options = Array.from(group.querySelectorAll('[role=option]'));
            return { title: label?.textContent, ids: options.map(option => option.getAttribute('data-model-id')),
                positioned: label?.getBoundingClientRect().bottom <= options[0].getBoundingClientRect().top };
        });
        for (const [scale, dark] of [[1, true], [0.65, false]]) {
            await js('modelNodeTest.compact(' + scale + ',' + dark + ',"image",' + JSON.stringify(fromImage) + ');' + imageTrigger + '.focus()');
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
            win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
            await wait('document.activeElement?.getAttribute("data-model-id")===' + JSON.stringify(fromImage));
            assert.deepEqual(await js('(' + readGroups.toString() + ')()'), [
                { title: 'OpenAI', ids: imageNames.slice(0, 2).map(name => 'default::' + name), positioned: true },
                { title: 'Gemini', ids: geminiNames.map(name => 'oneyes-gemini::' + name), positioned: true },
                { title: '其他模型', ids: ['default::custom-image'], positioned: true },
            ]);
            if (process.env.ONEYES_MODEL_SCREENSHOTS) {
                await wait('document.querySelector("[role=listbox]").getAnimations().every(animation=>animation.playState!=="running")');
                await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
                await mkdir(process.env.ONEYES_MODEL_SCREENSHOTS, { recursive: true });
                await writeFile(join(process.env.ONEYES_MODEL_SCREENSHOTS, 'model-families-' + (dark ? 'dark' : 'light') + '.png'), (await win.capturePage()).toPNG());
            }
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' });
            win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' });
            await wait('document.activeElement?.getAttribute("data-model-id")===' + JSON.stringify(toImage));
            assert.equal(await js('modelNodeTest.state().metadata.model'), fromImage);
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
            win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
            await wait('!document.querySelector("[role=listbox]") && modelNodeTest.state().metadata.model===' + JSON.stringify(toImage));
        }
        names = videoOnlyNames;
        await js('modelTest.replace(' + JSON.stringify(compactConfig) + ');modelTest.expire();modelTest.sync()');
        await wait('!modelTest.state().syncing');
        console.log('NATIVE_MODEL_FAMILIES_GROUP_LABELS_AND_EXACT_SELECTION_OK');
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
            const textBounds = await js('Array.from(document.querySelectorAll("[role=option] [data-model-name], [role=option] [data-model-information]")).map(text=>({text:text.textContent,right:text.getBoundingClientRect().left+text.scrollWidth,height:text.clientHeight,scrollHeight:text.scrollHeight}))');
            assert.ok(textBounds.every(text=>text.right<=bounds.viewport.right && text.scrollHeight<=text.height), 'full model versions must wrap without hidden text: '+JSON.stringify(textBounds));
            const wheel = { x: Math.round(bounds.viewport.x + bounds.viewport.width / 2), y: Math.round(bounds.viewport.y + bounds.viewport.height / 2) };
            for (const selector of ['[role=option]:not([data-disabled])', 'input[type=search]', '[data-slot=select-scroll-down-button]']) {
                const point = await js(`(()=>{const popup=document.querySelector('[role=listbox]'),viewport=popup.querySelector('[data-radix-select-viewport]');viewport.scrollTop=0;const element=popup.querySelector(${JSON.stringify(selector)}),r=element?.getBoundingClientRect();return r&&{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
                if (!point) continue;
                await js('window.modelScrollDone=false;document.querySelector("[data-radix-select-viewport]").addEventListener("scrollend",()=>window.modelScrollDone=true,{once:true})');
                win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
                win.webContents.sendInputEvent({ type: 'mouseWheel', deltaX: 0, deltaY: -80, ...point });
                await wait('window.modelScrollDone && document.querySelector("[data-radix-select-viewport]").scrollTop > 0');
            }
            const headerPoint = await js(`(()=>{const r=document.querySelector('[data-model-search]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
            win.webContents.sendInputEvent({ type: 'mouseMove', ...headerPoint });
            const beforeScroll = await js('document.querySelector("[data-radix-select-viewport]").scrollTop');
            if (await js('(()=>{const viewport=document.querySelector("[data-radix-select-viewport]");return viewport.scrollHeight>viewport.clientHeight+viewport.scrollTop})()')) {
                await js('window.modelScrollDone=false;document.querySelector("[data-radix-select-viewport]").addEventListener("scrollend",()=>window.modelScrollDone=true,{once:true})');
                win.webContents.sendInputEvent({ type: 'mouseMove', ...wheel });
                win.webContents.sendInputEvent({ type: 'mouseWheel', deltaX: 0, deltaY: -120, ...wheel });
                await wait(`window.modelScrollDone && document.querySelector("[data-radix-select-viewport]").scrollTop > ${beforeScroll}`);
            }
            if (process.env.ONEYES_MODEL_SCREENSHOTS) {
                await mkdir(process.env.ONEYES_MODEL_SCREENSHOTS, { recursive: true });
                await writeFile(join(process.env.ONEYES_MODEL_SCREENSHOTS, `config-model-${scale}-${dark ? 'dark' : 'light'}.png`), (await win.capturePage()).toPNG());
            }
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'End' });
            win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'End' });
            await wait('document.activeElement === Array.from(document.querySelectorAll("[role=option]:not([data-disabled])")).at(-1)');
            await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
            const target = await js(`(()=>{const item=Array.from(document.querySelectorAll('[role=option]:not([data-disabled])')).at(-1),r=item.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),visible:item.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)),model:item.getAttribute('data-model-id'),text:item.textContent.trim()};})()`);
            assert.equal(target.visible, true, 'last model must be clickable above neighboring nodes');
            assert.notEqual((await js('modelNodeTest.state()')).metadata.model, target.model);
            win.webContents.sendInputEvent({ type: 'mouseMove', x: target.x, y: target.y });
            await wait(`document.elementFromPoint(${target.x},${target.y})?.closest('[role=option]')?.getAttribute('data-model-id')===${JSON.stringify(target.model)} && document.activeElement?.getAttribute('data-model-id')===${JSON.stringify(target.model)}`);
            win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: target.x, y: target.y });
            await js('new Promise(resolve=>requestAnimationFrame(resolve))');
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
        await js("modelNodeTest.video('default::wan3.0-video',true)");
        await wait('document.querySelector("[data-node-id=status-video] [data-video-model-status=retired]")');
        assert.equal(await js('document.querySelector("[data-node-id=status-video] [role=alert]").nextElementSibling.disabled'), false, 'a retired model receipt remains recoverable');
        await js('document.querySelector("[data-node-id=status-video] [role=alert]").nextElementSibling.click()');
        assert.equal(await js('modelNodeTest.actions().at(-1)'), 'retry');
        if (!process.env.CI) await writeFile('.secrets/qa-model-retired-canvas.png', (await win.webContents.capturePage()).toPNG());
        await js("modelNodeTest.video('default::wan3.0-video',false)");
        await wait('document.querySelector("[data-node-id=status-video] [role=alert]").nextElementSibling.disabled');
        assert.equal(await js('document.querySelector("[data-node-toolbar] button[aria-label=\\"重试生成\\"]")?.disabled ?? true'), true);
        console.log('NATIVE_RETIRED_CANVAS_BADGE_RECEIPT_RETRY_ALLOWED_NEW_GENERATION_DISABLED_OK');
        await js('modelTest.feedReset();modelTest.feedSync()');
        await js(`modelTest.selectVideo(${JSON.stringify('oneyes-minimax::' + displayModels.find(model => model.id === 'sd-2.5-fullblood').request_id)})`);
        await js('showPreferenceLayout()');
        await wait('Boolean(document.querySelector("[data-testid=config-preferences]"))');
        const beforeLayout = await js('modelTest.state().config');
        for (const width of [1000, 420]) for (const dark of [false, true]) {
            if (win.getContentSize()[0] !== width) await new Promise(resolve => { win.once('resize', resolve); win.setContentSize(width, 900); });
            await js(`setPreferenceTheme(${dark});scrollTo(0,0)`);
            await wait(`innerWidth === ${width}`);
            await wait(`document.documentElement.classList.contains('dark') === ${dark}`);
            await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
            const layout = await js('(()=>{const form=document.querySelector("[data-testid=config-preferences]"),buttons=[...form.querySelectorAll("[data-default-models] [role=combobox]")],panel=form.querySelector("[data-video-settings]");return {overflow:document.documentElement.scrollWidth>innerWidth,heights:buttons.map(button=>button.getBoundingClientRect().height),headings:[...form.querySelectorAll("h2")].map(h=>h.textContent),panel:panel.getBoundingClientRect().toJSON(),ratioButtons:[...panel.querySelectorAll("button")].filter(button=>button.textContent.includes(":" )).map(button=>button.getBoundingClientRect().height)}})()');
            assert.equal(layout.overflow, false, 'preferences must fit wide and narrow windows');
            assert.equal(new Set(layout.heights).size, 1, 'all default model triggers must align to the same height: ' + JSON.stringify(layout));
            assert.equal(layout.headings.length, 6, 'all preference sections must remain accessible');
            assert.ok(layout.ratioButtons.length && layout.ratioButtons.every(height => height <= 40), 'preference ratio choices must use the compact layout');
            if (!process.env.CI) {
                await js('Promise.all(document.getAnimations().filter(animation=>animation.effect?.getComputedTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})))');
                await writeFile(`.secrets/qa-preferences-${width}-${dark ? 'dark' : 'light'}.png`, (await win.webContents.capturePage()).toPNG());
            }
        }
        assert.deepEqual(await js('modelTest.state().config'), beforeLayout, 'resizing or changing theme must never change saved preferences');
        console.log('NATIVE_PREFERENCES_LAYOUT_EQUAL_MODEL_HEIGHTS_COMPACT_RATIOS_NO_OVERFLOW_OR_SETTING_CHANGES_OK');
        await new Promise(resolve => { win.once('resize', resolve); win.setSize(1000, 780); });
        await js('showMentionPreferences()');
        await wait('window.mentionTest && document.getElementById("auto-refresh-mention-images")');
        const asyncSwitch = 'document.getElementById("async-image-generation")';
        assert.equal(await js('modelTest.state().config.asyncImageGeneration'), true);
        await js('modelTest.importStreamPreference()');
        assert.equal(await js('modelTest.state().config.asyncImageGeneration'), true, 'imported config cannot silently accept streaming risk');
        for (const dark of [false, true]) {
            await js(`setPreferenceTheme(${dark})`);
            await js(`${asyncSwitch}.focus()`);
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
            win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
            await wait('document.querySelector("[role=dialog]")?.textContent.includes("关闭异步生图")');
            assert.equal(await js('modelTest.state().config.asyncImageGeneration'), true, 'risk must be accepted before opting out');
            assert.equal(await js(`${asyncSwitch}.getAttribute("aria-checked")`), 'true');
            assert.match(await js('document.querySelector("[role=dialog]").textContent'), /无法取回.*费用/);
            if (!process.env.CI) {
                await js('Promise.all(document.getAnimations().filter(animation=>animation.effect?.getComputedTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})))');
                await writeFile(`.secrets/qa-async-images-${dark ? 'dark' : 'light'}.png`, (await win.webContents.capturePage()).toPNG());
            }
            await js('[...document.querySelectorAll("[role=dialog] button")].find(button=>button.textContent.replace(/\\s/g,"")==="保持异步生图").click()');
            await wait('!document.querySelector("[role=dialog]") || document.querySelector("[role=dialog]").getBoundingClientRect().width===0');
            assert.equal(await js('modelTest.state().config.asyncImageGeneration'), true);
            await js(`${asyncSwitch}.click()`);
            await wait('document.querySelector("[role=dialog]")?.getBoundingClientRect().width>0');
            await js('[...document.querySelectorAll("[role=dialog] button")].find(button=>button.textContent.replace(/\\s/g,"")==="我已了解风险，改用流式").click()');
            await wait('modelTest.state().config.asyncImageGeneration===false');
            await js('modelTest.restore()');
            assert.equal(await js('modelTest.state().config.asyncImageGeneration'), false);
            await wait('!document.querySelector("[role=dialog]") || document.querySelector("[role=dialog]").getBoundingClientRect().width===0');
            await js(`${asyncSwitch}.click()`);
            await wait('modelTest.state().config.asyncImageGeneration===true');
            await js('modelTest.restore()');
            assert.equal(await js('modelTest.state().config.asyncImageGeneration'), true);
        }
        console.log('NATIVE_ASYNC_IMAGE_PREFERENCE_OK: default on, keyboard confirmation, cancel stays on, explicit consent only, persistence and re-enable in both themes');
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
        const preferenceKey = 'oneyes-minimax::sd-2.5-fullblood';
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
        await js('Array.from(document.querySelectorAll("[data-testid=video-model-defaults] button")).find(button=>button.textContent.includes("恢复默认配置")).click()');
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
        const closeCanvasMenu = () => js('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
        const openPasteMenu = async () => {
            await closeCanvasMenu();
            win.focus();
            await wait('document.hasFocus()');
            await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
            const point = await js(`(() => {
                const surface=document.querySelector('[data-canvas-surface]'), rect=surface.getBoundingClientRect();
                window.pasteContextEvent=null;
                surface.addEventListener('contextmenu',event=>{const bounds=surface.getBoundingClientRect();window.pasteContextEvent={x:event.clientX,y:event.clientY,left:bounds.left,top:bounds.top,tag:event.target.tagName,connection:event.target.closest('[data-connection-id]')?.getAttribute('data-connection-id'),node:event.target.closest('[data-node-id]')?.getAttribute('data-node-id')}}, {once:true,capture:true});
                for(let y=Math.floor(rect.bottom)-6;y>rect.top+80;y-=30) for(let x=Math.floor(rect.right)-6;x>rect.left+80;x-=30){
                    const target=document.elementFromPoint(x,y);
                    if(!target || !surface.contains(target) || target.closest('[data-node-id],[data-connection-id],button,input,textarea,select,[contenteditable=true],[data-canvas-no-zoom]'))continue;
                    return {x,y,left:rect.left,top:rect.top};
                }
                throw Error('No blank canvas point');
            })()`);
            win.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'right', clickCount: 1 });
            win.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'right', clickCount: 1 });
            try { await wait('document.querySelector("[aria-label=画布粘贴菜单] button")'); }
            catch (error) { throw Error(`Paste menu did not open: ${JSON.stringify({ point, event: await js('pasteContextEvent') })}`, { cause: error }); }
            assert.equal(await js('document.activeElement?.textContent'), '粘贴图片或文字');
            assert.equal(await js(`(() => {const r=document.querySelector('[aria-label=画布粘贴菜单]').getBoundingClientRect();return r.left>=0 && r.top>=0 && r.right<=innerWidth && r.bottom<=innerHeight})()`), true, 'edge menu stays inside the window');
            return await js('pasteContextEvent');
        };
        let count = restored.nodes.length;
        for (const [theme, kind] of [['light', 'text'], ['dark', 'image']]) {
            await js(`setRecoveryTheme(${JSON.stringify(theme)})`);
            clipboardValue = kind;
            const reads = clipboardReads, point = await openPasteMenu();
            assert.equal(clipboardReads, reads, 'opening a menu must not inspect the clipboard');
            await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
            if (!process.env.CI) await writeFile(`.secrets/qa-canvas-paste-${theme}.png`, (await win.webContents.capturePage()).toPNG());
            const viewport = (await js('clipboardTest.state()')).viewport;
            await js('document.querySelector("[aria-label=画布粘贴菜单] button").click()');
            await wait(`clipboardTest.state().nodes.length === ${++count}`);
            assert.equal(clipboardReads, reads + 1, 'one explicit click reads once');
            const node = (await js('clipboardTest.state()')).nodes.at(-1);
            assert.equal(node.type, kind);
            assert.ok(Math.abs(node.position.x + node.width / 2 - (point.x - point.left - viewport.x) / viewport.k) < 0.01, JSON.stringify({ point, viewport, position: node.position, width: node.width }));
            assert.ok(Math.abs(node.position.y + node.height / 2 - (point.y - point.top - viewport.y) / viewport.k) < 0.01, JSON.stringify({ point, viewport, position: node.position, height: node.height }));
            if (kind === 'text') assert.equal(node.metadata.content, clipboardText);
            else {
                assert.equal(node.metadata.naturalWidth, 16); assert.equal(node.metadata.naturalHeight, 8);
                assert.ok(node.metadata.storageKey, 'pasted original must be persisted');
                assert.equal(node.width / node.height, 2, 'original aspect ratio is preserved');
            }
        }
        for (const [kind, notice] of [['empty', '剪贴板中没有可粘贴'], ['denied', '粘贴失败']]) {
            clipboardValue = kind;
            await openPasteMenu();
            await js('document.querySelector("[aria-label=画布粘贴菜单] button").click()');
            await wait(`document.querySelector('.ant-message')?.textContent.includes(${JSON.stringify(notice)})`);
            assert.equal((await js('clipboardTest.state()')).nodes.length, count, 'failed or empty reads must not create empty nodes');
        }
        const beforeDismiss = clipboardReads;
        await openPasteMenu(); await closeCanvasMenu();
        assert.equal(await js('!!document.querySelector("[aria-label=画布粘贴菜单]")'), false);
        assert.equal(clipboardReads, beforeDismiss);
        await js(`document.querySelector('[data-node-id=first]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:100,clientY:200,button:2}))`);
        await wait('document.querySelector("[aria-label=节点操作]")');
        assert.equal(await js('document.querySelector("[aria-label=节点操作]").textContent.includes("粘贴图片或文字")'), false, 'node menu retains node actions');
        await closeCanvasMenu();
        await js('clipboardTest.flush()');
        await win.loadURL(process.argv[2]); await wait('Boolean(window.showClipboardCanvas)'); await js('showClipboardCanvas()');
        await wait(`document.querySelectorAll('[data-node-id]').length === ${count}`);
        const reopened = (await js('clipboardTest.state()')).nodes.slice(-2);
        assert.equal(reopened[0].metadata.content, clipboardText);
        assert.ok(reopened[1].metadata.content.startsWith('blob:'), 'pasted image reloads from persisted original');
        const originalFile = nativeImage.createFromBitmap(Buffer.alloc(32 * 16 * 4, 255), { width: 32, height: 16 }).toPNG();
        const fileNames = ['本地 原图#1.PNG', '第二张.png'];
        for (const name of fileNames) await writeFile(join(app.getPath('userData'), name), originalFile);
        clipboardValue = 'files';
        await openPasteMenu();
        await js('document.querySelector("[aria-label=画布粘贴菜单] button").click()');
        count += 2;
        await wait(`clipboardTest.state().nodes.length === ${count}`);
        const fileNodes = (await js('clipboardTest.state()')).nodes.slice(-2);
        assert.deepEqual(fileNodes.map(node => node.title), fileNames);
        for (const node of fileNodes) {
            assert.equal(node.type, 'image');
            assert.equal(node.metadata.naturalWidth, 32); assert.equal(node.metadata.naturalHeight, 16);
            assert.ok(node.metadata.storageKey);
            assert.notDeepEqual(node.position, fileNodes.find(other => other.id !== node.id).position);
        }
        await js('clipboardTest.flush()');
        for (const name of fileNames) await unlink(join(app.getPath('userData'), name));
        await win.loadURL(process.argv[2]); await wait('Boolean(window.showClipboardCanvas)'); await js('showClipboardCanvas()');
        await wait(`document.querySelectorAll('[data-node-id]').length === ${count}`);
        const restoredFiles = (await js('clipboardTest.state()')).nodes.slice(-2);
        assert.deepEqual(restoredFiles.map(node => node.title), fileNames);
        for (const node of restoredFiles) assert.ok(node.metadata.content.startsWith('blob:'), 'copied file persists independently of its source path');
        console.log('CANVAS_RIGHT_CLICK_PASTE_MULTIPLE_LOCAL_IMAGE_FILES_PERSISTED_OK');
        const beforeArrangement = await js('clipboardTest.state()');
        const clickTool = async label => {
            await wait(`document.querySelector('[aria-label="${label}"]') && !document.querySelector('[aria-label="${label}"]').disabled`);
            await clickVisible(`document.querySelector('[aria-label="${label}"]')`);
        };
        await wait('!document.querySelector("[aria-label=一键整理]").disabled');
        await clickTool('一键整理');
        await wait(`JSON.stringify(clipboardTest.state().nodes.map(n=>n.position)) !== ${JSON.stringify(JSON.stringify(beforeArrangement.nodes.map(n => n.position)))}`);
        const arrangedProject = await js('clipboardTest.state()');
        const withoutPosition = ({ position, ...node }) => node;
        assert.deepEqual(arrangedProject.nodes.map(withoutPosition), beforeArrangement.nodes.map(withoutPosition));
        assert.deepEqual(arrangedProject.connections, beforeArrangement.connections);
        for (const node of beforeArrangement.nodes) {
            const parent = beforeArrangement.nodes.find(group => group.id === node.metadata?.groupId);
            if (!parent) continue;
            const moved = arrangedProject.nodes.find(other => other.id === node.id), movedParent = arrangedProject.nodes.find(other => other.id === parent.id);
            assert.equal(moved.position.x - movedParent.position.x, node.position.x - parent.position.x);
            assert.equal(moved.position.y - movedParent.position.y, node.position.y - parent.position.y);
        }
        // History is debounced by the existing canvas hook; wait for its committed snapshot.
        await new Promise(resolve => setTimeout(resolve, 250));
        await clickTool('一键整理');
        await new Promise(resolve => setTimeout(resolve, 250));
        assert.deepEqual((await js('clipboardTest.state()')).nodes, arrangedProject.nodes, 'arranging twice is stable');
        await clickTool('撤销');
        await wait(`JSON.stringify(clipboardTest.state().nodes.map(n=>n.position)) === ${JSON.stringify(JSON.stringify(beforeArrangement.nodes.map(n => n.position)))}`);
        await clickTool('重做');
        await wait(`JSON.stringify(clipboardTest.state().nodes.map(n=>n.position)) === ${JSON.stringify(JSON.stringify(arrangedProject.nodes.map(n => n.position)))}`);
        if (!process.env.CI) {
            await mkdir('.secrets', { recursive: true });
            for (const theme of ['light', 'dark']) {
                await js(`setRecoveryTheme('${theme}')`);
                await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
                await writeFile(`.secrets/qa-arrange-${theme}.png`, (await win.webContents.capturePage()).toPNG());
            }
        }
        await js('clipboardTest.flush()');
        await win.loadURL(process.argv[2]); await wait('Boolean(window.showClipboardCanvas)'); await js('showClipboardCanvas()');
        // Reopened canvases cull nodes outside the visible area. Assert persisted data,
        // rather than requiring every saved node to be mounted at this window size.
        await wait('document.querySelector("[aria-label=一键整理]") && !document.querySelector("[aria-label=一键整理]").disabled');
        assert.equal((await js('clipboardTest.state()')).nodes.length, count);
        assert.deepEqual((await js('clipboardTest.state()')).nodes.map(node => node.position), arrangedProject.nodes.map(node => node.position));
        console.log('CANVAS_AUTO_ARRANGE_NATIVE_CLICK_GROUP_OFFSETS_LINKS_UNDO_REDO_IDEMPOTENCE_AND_REOPEN_OK');
        clipboardValue = 'pending';
        await openPasteMenu();
        await js('document.querySelector("[aria-label=画布粘贴菜单] button").click()');
        assert.ok(resolveClipboard);
        await js('showVideoRecovery()');
        resolveClipboard({ text: 'must not append after leaving canvas' });
        await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        assert.equal((await js('clipboardTest.state()')).nodes.length, count, 'late clipboard result must not modify a closed canvas');
        console.log('NATIVE_CANVAS_RIGHT_CLICK_PASTE_IMAGE_TEXT_POSITION_THEMES_EMPTY_FAILURE_DISMISS_REOPEN_AND_UNMOUNT_OK');
        const list = '[aria-label="视频任务列表"]', rows = list + ' > ul > li';
        await wait(`document.querySelectorAll('${rows}').length === 6`);
        const header = '[aria-label="按状态筛选视频任务"]';
        const choose = label => clickVisible(`[...document.querySelectorAll('${header} button')].find(item=>item.innerText.startsWith(${JSON.stringify(label)}))`);
        const button = text => `[...document.querySelectorAll('${list} button')].find(button=>button.textContent.trim()===${JSON.stringify(text)})`;
        const recovery = await js('document.querySelector(".ant-modal-body").innerText');
        assert.match(recovery, /提交待核实/);
        assert.match(recovery, /重试仅查询或下载原任务/);
        assert.match(recovery, /720p.*5 秒/s);
        assert.doesNotMatch(recovery, /11111111-1111|¥|【720p/);
        for (const job of recoveryJobs) assert.ok(!recovery.includes(job.key), 'ordinary recovery must never display the full idempotency key');
        await choose('进行中');
        await wait(`document.querySelectorAll('${rows}').length === 1 && document.querySelector('${rows}').innerText.includes('正在提交')`);
        await choose('待处理');
        await wait(`document.querySelectorAll('${rows}').length === 4`);
        const uncertainActions = await js(`[...document.querySelectorAll('${rows}')].find(row=>row.innerText.includes('提交待核实')).innerText`);
        assert.doesNotMatch(uncertainActions, /重试查询|确认原账号并恢复|重新生成/, 'uncertain submission offers no retry or regeneration');
        await clickVisible(`document.querySelectorAll('${rows} summary').item(3)`);
        await wait(`document.querySelector('${rows} details[open]')?.innerText.includes('11111111-1111-1111-1111-111111111111')`);
        const expanded = await js(`document.querySelector('${rows} details[open]').innerText`);
        assert.doesNotMatch(expanded, /00000000-0000|original-task|https:\/\//);
        await clickVisible(button('重试查询／下载'));
        await wait(`document.querySelector('${list}')?.innerText.includes('视频结果取回未完成')`);
        assert.deepEqual(recoveryRetries, ['original-task']);
        await clickVisible(button('确认原账号并恢复'));
        await wait('document.querySelector(".ant-modal-confirm")?.innerText.includes("确认原提交账号")');
        assert.deepEqual(recoveryRetries, ['original-task'], 'legacy receipt waits for account confirmation');
        const confirm = 'document.querySelector(".ant-modal-confirm .ant-btn-primary")';
        await wait(`Boolean(${confirm} && !${confirm}.disabled)`);
        await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        await wait('document.querySelector(".ant-modal-confirm").getAnimations({subtree:true}).every(animation=>animation.playState!=="running")');
        await js(`${confirm}.focus()`);
        await wait(`document.activeElement === ${confirm}`);
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
        await wait(`!document.querySelector('${list}')?.innerText.includes('待确认原账号')`);
        assert.deepEqual(recoveryRetries, ['original-task', 'legacy-task']);
        await choose('已保存');
        await wait(`document.querySelectorAll('${rows}').length === 1 && Boolean(${button('保存视频')})`);
        const download = new Promise((resolve, reject) => win.webContents.session.once('will-download', (_event, item) => {
            const path = join(app.getPath('userData'), item.getFilename());
            item.setSavePath(path);
            item.once('done', (_event, state) => state === 'completed' ? resolve(path) : reject(Error(state)));
        }));
        await clickVisible(button('保存视频'));
        const savedPath = await Promise.race([download, new Promise((_, reject) => setTimeout(() => reject(Error('No saved video download')), 20000).unref())]);
        assert.match(savedPath, /OneYes-Video-44444444-4444-4444-4444-444444444444\.mp4$/);
        assert.deepEqual(await readFile(savedPath), videoBytes);
        await choose('全部');
        await wait(`document.querySelectorAll('${rows}').length === 6`);
        for (const [width, height, viewport] of [[1000, 640, 'innerWidth >= 800 && innerHeight >= 540'], [420, 480, 'innerWidth < 500 && innerHeight < 540']]) {
            win.setContentSize(width, height);
            await wait(viewport);
            for (const theme of ['light', 'dark']) {
                await js(`setRecoveryTheme('${theme}')`);
                await wait(`document.documentElement.classList.contains('dark') === ${theme === 'dark'}`);
                await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
                const layout = await js(`(()=>{ const list = document.querySelector('${list}'), r=list.closest('.ant-modal-container').getBoundingClientRect(); return { x: innerWidth, y: innerHeight, fits: r.top>=0 && r.bottom<=innerHeight && r.left>=0 && r.right<=innerWidth && list.scrollHeight>list.clientHeight && list.scrollWidth<=list.clientWidth+1 }; })()`);
                assert.ok(layout.fits, `${theme} recovery fits the actual ${layout.x}×${layout.y} viewport with internal vertical scrolling`);
                if (!process.env.CI) await writeFile(`.secrets/qa-video-recovery-${width}-${theme}.png`, (await win.webContents.capturePage()).toPNG());
            }
        }
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
        await wait(`!document.querySelector('${list}')`);
        recoveryJobs = [];
        win.webContents.send('video-tasks:state', recoveryJobs);
        await clickVisible('document.querySelector("button[aria-label=视频任务与恢复]")');
        await wait(`document.querySelector('${list}')?.innerText.includes('暂无视频任务')`);
        console.log('VIDEO_RECOVERY_UI_OK: native filtering, disclosure, retry original receipt, account confirmation, export, themes and short windows');

        const grok = displayModels.find(model => model.id === 'grok-imagine-video').request_id;
        const longName = 'grok-imagine-video-long-version-with-preview-generation-fixture';
        const longModel = longName + ' [480p/720p/1080p 1-15s ¥0.088/秒起]';
        const originalId = 'oneyes-minimax::' + grok;
        const nextId = 'oneyes-minimax::' + longModel;
        names = [grok, longModel];
        await js('modelTest.video();modelTest.expire();modelTest.sync()');
        await wait(`!modelTest.state().syncing && modelTest.state().config.models.includes(${JSON.stringify(nextId)})`);
        await js(`modelTest.selectVideo(${JSON.stringify(originalId)});showVideoWorkbench()`);
        const section = '[data-workbench-video-model]';
        const trigger = `${section} [role=combobox]`;
        win.setContentSize(950, 650);
        await wait(`innerWidth >= 700 && innerWidth < 1024 && document.querySelector('${trigger}')`);
        const originalConfig = await js('modelTest.state().config');
        for (const dark of [true, false]) {
            await js(`setRecoveryTheme('${dark ? 'dark' : 'light'}')`);
            await wait(`document.documentElement.classList.contains('dark') === ${dark}`);
            const layout = await js(`(() => {
                const panel = document.querySelector('${section}'), picker = panel.querySelector('[role=combobox]');
                const name = picker.querySelector('[data-model-name]'), info = picker.querySelector('[data-model-information]');
                const status = picker.querySelector('[data-model-availability]');
                return { fullWidth: Math.abs(picker.offsetWidth - panel.clientWidth) <= 2,
                    name: name.innerText, info: info.innerText,
                    separate: name.getBoundingClientRect().bottom <= info.getBoundingClientRect().top + 1,
                    statusFits: status.getBoundingClientRect().right <= picker.getBoundingClientRect().right,
                    duplicate: Boolean(panel.querySelector('[aria-label=当前视频模型]')), pricing: panel.innerText.includes('价格与计费') };
            })()`);
            assert.ok(layout.fullWidth && layout.separate && layout.statusFits && !layout.duplicate && layout.pricing, JSON.stringify(layout));
            assert.equal(layout.name, 'grok-imagine-video');
            assert.match(layout.info, /480.*720.*¥/);
            if (!process.env.CI) {
                await js(`document.querySelector('${trigger}').scrollIntoView({block:'center'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
                await wait('[...document.getAnimations()].every(animation=>animation.playState!=="running" || animation.effect?.getComputedTiming().endTime===Infinity)');
                await writeFile(`.secrets/qa-workbench-video-model-${dark ? 'dark' : 'light'}.png`, (await win.webContents.capturePage()).toPNG());
            }
        }
        win.setContentSize(420, 630);
        await wait('innerWidth < 600');
        await clickVisible(`document.querySelector('${trigger}')`);
        const nextOption = `[...document.querySelectorAll('[role=option]:not([data-disabled])')].find(row=>row.getAttribute('data-model-id')===${JSON.stringify(nextId)})`;
        await wait(`Boolean(${nextOption})`);
        assert.deepEqual(await js('modelTest.state().config'), originalConfig, 'theme, resizing and opening the list preserve configuration');
        await js('document.querySelector("[data-model-search] input").focus()');
        await win.webContents.insertText('preview-generation-fixture');
        await wait(`(${nextOption}) && [...document.querySelectorAll('[role=option]:not([data-disabled])')].every(row=>row.innerText.includes('preview-generation-fixture'))`);
        await wait('document.querySelector("[role=listbox]").getAnimations().every(animation=>animation.playState!=="running")');
        const menu = await js(`(() => {
            const listbox = document.querySelector('[role=listbox]'), r = listbox.getBoundingClientRect();
            const view = listbox.querySelector('[data-radix-select-viewport]'), name = (${nextOption}).querySelector('[data-model-name]');
            return { inside: r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1,
                listFits: view.scrollWidth <= view.clientWidth + 1, nameFits: name.scrollWidth <= name.clientWidth + 1,
                searchVisible: listbox.querySelector('[data-model-search]').getBoundingClientRect().bottom <= view.getBoundingClientRect().top + 1 };
        })()`);
        assert.ok(menu.inside && menu.listFits && menu.nameFits && menu.searchVisible, JSON.stringify(menu));
        await js(`(${nextOption}).focus()`);
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
        await wait(`!document.querySelector('[role=listbox]') && modelTest.state().config.videoModel === ${JSON.stringify(nextId)}`);
        assert.equal((await js('modelTest.request()')).model, longModel);
        const chosen = await js(`(() => {
            const name = document.querySelector('${trigger} [data-model-name]');
            return { text: name.innerText, fits: name.scrollWidth <= name.clientWidth + 1, wrap: getComputedStyle(name).whiteSpace === 'normal' };
        })()`);
        assert.deepEqual(chosen, { text: longName, fits: true, wrap: true });
        const adjust = `[...document.querySelectorAll('${section} button')].find(button=>button.textContent.trim()==='调整')`;
        await clickVisible(adjust);
        const drawerModel = `document.querySelector('.ant-drawer-open ${trigger} [data-model-name]')`;
        await wait(`(${drawerModel})?.getBoundingClientRect().width > 0`);
        assert.equal(await js(`${drawerModel}.innerText`), longName);
        await clickVisible(`document.querySelector('.ant-drawer-open ${trigger}')`);
        const originalOption = `[...document.querySelectorAll('[role=option]:not([data-disabled])')].find(row=>row.getAttribute('data-model-id')===${JSON.stringify(originalId)})`;
        await wait(`Boolean(${originalOption})`);
        await js(`(${originalOption}).focus()`);
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
        await wait(`!document.querySelector('[role=listbox]') && modelTest.state().config.videoModel === ${JSON.stringify(originalId)}`);
        console.log('VIDEO_WORKBENCH_MODEL_LAYOUT_OK: full width, concise summary, narrow menu, search, exact ID and parameter drawer');
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});
