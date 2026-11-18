const { app, BrowserWindow, protocol, net, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const { writeFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { route } = require('../../desktop/protocol.cjs');
const { createMediaTools } = require('../../desktop/media-tools.cjs');
const { videoErrorText, videoErrorMessages } = require('../../desktop/video-errors.mjs');
protocol.registerSchemesAsPrivileged([{ scheme: 'oneyes-canvas', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
app.on('window-all-closed', () => {});
const profile = process.env.CANVAS_VIDEO_WORKFLOW_TEST_PROFILE;
app.setPath('userData', profile);
app.whenReady().then(async () => {
    const root = process.env.CANVAS_VIDEO_WORKFLOW_TEST_ROOT;
    const binary = join(resolve('desktop/media-bin'), process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    await promisify(execFile)(binary, ['-v', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=192x128:r=12:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(root, 'sample.mp4')]);
    const win = new BrowserWindow({ show: false, width: 1540, height: 1000, webPreferences: { preload: resolve('desktop/preload.cjs'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const media = createMediaTools({ directory: profile, binaries: resolve('desktop/media-bin'), changed: state => { if (!win.isDestroyed()) win.webContents.send('media:state', state); } });
    ipcMain.handle('media:create', (_event, operation, count, options) => media.create(operation, count, options));
    ipcMain.handle('media:start', async (_event, id) => { try { return { data: await media.start(id) }; } catch (error) { return { error: error.message }; } });
    ipcMain.handle('media:release', (_event, id) => media.release(id));
    for (const name of ['config:read', 'config:write', 'config:remove', 'diagnostics:report', 'diagnostics:recover', 'window:theme']) ipcMain.handle(name, () => null);
    ipcMain.handle('collaboration:call', () => ({ status: 'offline' }));
    const recoveries = [], videoOperations = [], modelReads = []; let recoveryResult, recoveryJob;
    ipcMain.handle('models:list', (_event, key) => { modelReads.push(key); return { data: ['grok-imagine-video'] }; });
    ipcMain.handle('video-tasks:call', (_event, operation, input) => {
        videoOperations.push(operation);
        if (operation === 'list') return recoveryJob ? [recoveryJob] : [];
        assert.equal(operation, 'adopt', 'recovery cannot prepare or submit a paid task');
        assert.equal(input.model, 'old-channel::seedance-2.0'); assert.equal(input.taskId, 'original-task');
        assert.equal(input.apiKey, 'original-recovery-key'); assert.equal(input.channelId, 'old-channel');
        assert.equal(input.parameters.vquality, '720'); assert.equal(input.parameters.videoSeconds, '5');
        assert.ok(recoveryResult); recoveries.push(input);
        recoveryJob = { ...input, apiKey: undefined, key: 'retired-job', state: 'saved', result: recoveryResult };
        return recoveryJob.key;
    });
    protocol.handle('oneyes-canvas', request => { const path = new URL(request.url).pathname; if (path.startsWith('/media-tools/')) return media.request(request); if (path === '/plugins/index.json') return Response.json([]); const { file } = route(request.url, root); assert.ok(file); return net.fetch(file); });
    const external = [];
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => { const blocked = /^https?:/.test(details.url); if (blocked) external.push(details.url); callback({ cancel: blocked }); });
    const js = code => win.webContents.executeJavaScript(code);
    const wait = async code => { const until = Date.now() + 30000; while (!await js(code)) { if (Date.now() > until) throw Error(`Timed out: ${code}\n${await js('document.body.innerText')}`); await new Promise(resolve => setTimeout(resolve, 25)); } };
    const click = async text => { await js(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.split(' ').join('').trim()===${JSON.stringify(text)}||b.getAttribute('aria-label')===${JSON.stringify(text)});if(!button||button.disabled)throw Error('Missing enabled button: '+${JSON.stringify(text)});button.click()})()`); };
    const context = async () => { await js(`document.querySelector('[data-node-id="source-video"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:300,clientY:300}))`); await wait(`document.body.innerText.includes('创建反推提示词')`); };
    const panel = id => `[data-node-id="${id}"]`;
    const start = async id => { await js(`(()=>{const root=document.querySelector(${JSON.stringify(panel(id))});if(!root)throw Error('Config panel missing');const button=[...root.querySelectorAll('button')].find(b=>b.textContent.trim()==='开始生成');if(!button||button.disabled)throw Error('Generate disabled');button.click();})()`); };
    try {
        await win.loadURL('oneyes-canvas://app/');
        await wait('Boolean(window.videoWorkflowTest && document.querySelector("[data-node-id=source-video]"))');
        const original = await js('videoWorkflowTest.original()');
        await context(); await click('创建反推提示词');
        await wait('videoWorkflowTest.state().nodes.length===3');
        let state = await js('videoWorkflowTest.state()');
        const config = state.nodes.find(node => node.metadata?.videoPromptSourceId), task = state.nodes.find(node => node.type === 'text');
        assert.equal(config.metadata.model, 'default::gpt-5.4'); assert.equal(config.metadata.videoFrameCount, 6); assert.equal(config.metadata.generationMode, 'text');
        assert.equal(state.connections.length, 2); assert.match(task.metadata.content, /镜头运动/); assert.deepEqual(await js('videoWorkflowTest.calls()'), []);
        await wait(`Boolean(document.querySelector(${JSON.stringify(panel(config.id))}))`);
        await js(`document.querySelector(${JSON.stringify(panel(config.id))}).querySelectorAll('.canvas-compact-control')[1].click()`);
        await wait('Boolean(document.querySelector("input[aria-label=每段视频抽帧]"))');
        await js(`(()=>{const input=document.querySelector('input[aria-label=每段视频抽帧]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'3');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));input.blur()})()`);
        await wait(`videoWorkflowTest.state().nodes.find(n=>n.id===${JSON.stringify(config.id)}).metadata.videoFrameCount===3`);
        await js('document.body.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}))');
        await start(config.id);
        await wait('videoWorkflowTest.state().nodes.some(n=>n.type==="text"&&n.metadata.content?.includes("冷色电影光影")&&n.metadata.status==="success")');
        const calls = await js('videoWorkflowTest.calls()'); assert.equal(calls.length, 1);
        assert.equal(calls[0].model, 'gpt-5.4');
        const content = calls[0].input.find(item => item.role === 'user').content;
        const images = content.filter(item => item.type === 'input_image'); assert.equal(images.length, 3);
        for (const frame of images) { const bytes = Buffer.from(frame.image_url.split(',')[1], 'base64'); assert.equal(bytes.readUInt32BE(16), 192); assert.equal(bytes.readUInt32BE(20), 128); }
        assert.notEqual(images[0].image_url, images[2].image_url); assert.match(JSON.stringify(content), /0\.000s/); assert.match(JSON.stringify(content), /1\.333s/); assert.match(JSON.stringify(content), /不包含音轨/);
        assert.match(JSON.stringify(content), /逐镜头检查/);assert.match(JSON.stringify(content), /主体运动和相机运动/);assert.match(JSON.stringify(content), /采样间隔不等于镜头时长/);
        const existing=await js("videoWorkflowTest.service('existing')"),ordinary=await js("videoWorkflowTest.service('ordinary')");
        assert.ok(existing.prepared.prompt.startsWith('自定义重点：'));assert.match(existing.prepared.prompt,/逐镜头检查/);assert.match(existing.prepared.prompt,/不擅自降低分辨率/);
        assert.ok(!ordinary.prepared.prompt.includes('逐镜头检查'),'ordinary video-to-text requests must retain their own task');
        assert.deepEqual(await js('videoWorkflowTest.original()'), original);
        for (const kind of ['cancel', 'invalid', 'missing']) await assert.rejects(js(`videoWorkflowTest.service('${kind}')`));
        const mixed = await js("videoWorkflowTest.service('mixed')"); assert.equal(mixed.prepared.referenceImages.length, 7); assert.equal(mixed.prepared.referenceImages[0].id, 'cover'); assert.match(mixed.prepared.prompt, /参考视频 2/);
        assert.equal((await js('videoWorkflowTest.calls()')).length, 1);
        assert.match(await js('videoWorkflowTest.missingRecipe()'), /原参考素材/);
        const copiedInputs = await js('videoWorkflowTest.recipeWithRefs()'); assert.equal(copiedInputs.referenceImages.length, 1); assert.equal(copiedInputs.referenceVideos.length, 0);
        await js('videoWorkflowTest.theme(true)'); await context(); await click('创建生成配置');
        await wait('videoWorkflowTest.state().nodes.some(n=>n.type==="config"&&n.metadata.generationMode==="video")');
        state = await js('videoWorkflowTest.state()');
        const recipe = state.nodes.find(node => node.metadata?.generationMode === 'video');
        for (const field of ['model', 'size', 'seconds', 'vquality', 'generateAudio', 'watermark', 'videoMode']) assert.equal(recipe.metadata[field], original.node.metadata[field], field);
        assert.equal(recipe.metadata.videoTaskId, undefined); assert.equal(recipe.metadata.storageKey, undefined); assert.equal(recipe.metadata.content, '');
        assert.equal(state.connections.some(link => link.fromNodeId === 'source-video' && link.toNodeId === recipe.id), false, 'copying recipe never silently changes generation into video editing');
        assert.equal((await js('videoWorkflowTest.calls()')).length, 1);
        await js('videoWorkflowTest.flush()');
        const loaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve)); win.reload(); await loaded;
        await wait('Boolean(window.videoWorkflowTest && document.querySelector("[data-node-id=source-video]"))');
        state = await js('videoWorkflowTest.state()'); assert.ok(state.nodes.some(node => node.id === recipe.id)); assert.equal(state.nodes.find(node => node.id === config.id).metadata.videoFrameCount, 3); assert.equal((await js('videoWorkflowTest.calls()')).length, 0, 'restart never generates automatically');
        const result = await js('videoWorkflowTest.service("mixed")'); assert.equal(result.prepared.referenceImages.length, 7, 'stored original video survives reload and still samples');
        await js(`(()=>{const node=document.querySelector('[data-node-id="source-video"]'),r=node.getBoundingClientRect();node.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:r.x+r.width/2,clientY:r.y+r.height/2}))})()`);
        await js(`window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0}))`);
        await wait('Boolean(document.querySelector("[data-node-toolbar=source-video]"))');
        await wait('(()=>{const r=document.querySelector("[data-node-toolbar=source-video]").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})()');
        assert.equal(await js('Boolean(document.querySelector("[data-node-toolbar=source-video] button[aria-label=创建反推提示词]"))'), true);
        await js('videoWorkflowTest.mode("error")'); await start(config.id);
        await wait(`videoWorkflowTest.state().nodes.find(n=>n.id===${JSON.stringify(config.id)}).metadata.errorDetails?.includes('fixture vision unsupported')`);
        const failed = await js('videoWorkflowTest.state().nodes.find(n=>n.type==="text"&&n.metadata.status==="error")');
        await js('videoWorkflowTest.mode("success")');
        await js(`(()=>{const node=document.querySelector('[data-node-id="${failed.id}"]');node.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}))})()`);
        await js(`window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0}))`);
        await wait(`Boolean(document.querySelector('[data-node-toolbar="${failed.id}"]'))`);
        await js(`Array.from(document.querySelectorAll('[data-node-toolbar="${failed.id}"] button')).find(button=>button.textContent.includes('重试')).click()`);
        await wait(`videoWorkflowTest.state().nodes.find(n=>n.id===${JSON.stringify(failed.id)}).metadata.status==='success'`);
        const retried = await js('videoWorkflowTest.calls()'); assert.equal(retried.length, 2); assert.equal(retried[1].input.find(item=>item.role==='user').content.filter(item=>item.type==='input_image').length, 3, 'manual retry resamples video and retains composer references');
        await js('videoWorkflowTest.mode("hold")'); await start(config.id);
        await wait('videoWorkflowTest.calls().length===3');
        await js(`document.querySelector(${JSON.stringify(panel(config.id))}).querySelector('button.ant-btn-dangerous').click()`);
        await wait('Boolean(document.querySelector(".ant-modal-confirm"))'); await click('停止');
        await wait(`videoWorkflowTest.state().nodes.find(n=>n.id===${JSON.stringify(config.id)}).metadata.status==='idle'`);
        await wait(`!videoWorkflowTest.state().nodes.find(n=>n.id===${JSON.stringify(config.id)}).metadata.loadingMessage`);
        assert.equal((await js('videoWorkflowTest.calls()')).length, 3, 'cancellation does not retry a paid request');
        assert.deepEqual(await js('videoWorkflowTest.errors()'), []); assert.deepEqual(external, []);
        const saved = (await js('videoWorkflowTest.original()')).node.metadata;
        recoveryResult = { url: saved.content, storageKey: saved.storageKey, bytes: saved.bytes, mimeType: saved.mimeType, width: saved.naturalWidth, height: saved.naturalHeight, durationMs: saved.durationMs };
        await js('videoWorkflowTest.seedRetiredTask()');
        const restored = new Promise(resolve => win.webContents.once('did-finish-load', resolve)); win.reload(); await restored;
        await wait('Boolean(window.videoWorkflowTest && document.querySelector("[data-node-id=retired-video]"))');
        assert.equal(recoveries.length, 0);
        await js(`(()=>{const button=[...document.querySelectorAll('[data-node-id=retired-video] button')].find(button=>button.textContent.includes('重试'));if(!button)throw Error('Missing receipt recovery button');button.click()})()`);
        await wait('videoWorkflowTest.state().nodes.find(n=>n.id==="retired-video").metadata.status==="success"');
        const recovered = await js('videoWorkflowTest.state().nodes.find(n=>n.id==="retired-video").metadata');
        assert.equal(recovered.model, 'old-channel::seedance-2.0'); assert.equal(recovered.videoTaskId, 'original-task');
        assert.equal(recovered.vquality, '720'); assert.equal(recovered.seconds, '5'); assert.equal(recovered.storageKey, saved.storageKey);
        assert.equal(recoveries.length, 1); assert.deepEqual(await js('videoWorkflowTest.calls()'), []);
        assert.deepEqual(await js('videoWorkflowTest.errors()'), []); assert.deepEqual(external, []);
        console.log('NATIVE_RETIRED_MODEL_CANVAS_RECEIPT_RECOVERY_ORIGINAL_MODEL_KEY_AND_PARAMETERS_OK');
        const unconfirmedCases = [...['unknown', 'submitting', 'prepared', 'not_submitted'].map(status => ({ status, entry: 'overlay' })), ...['toolbar', 'panel'].map(entry => ({ status: 'unknown', entry }))];
        for (const { status, entry } of unconfirmedCases) {
            recoveryJob = { key: 'unconfirmed-job', model: 'default::grok-imagine-video', site: 'https://oneyes.ai', channelId: 'default', provider: 'openai', state: status, createdAt: Date.now(), parameters: { size: '16:9', vquality: '480', videoSeconds: '5' } };
            await js('videoWorkflowTest.seedUnconfirmedTask()');
            const loaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve)); win.reload(); await loaded;
            await wait('Boolean(window.videoWorkflowTest && document.querySelector("[data-node-id=unconfirmed-video]"))');
            const before = videoOperations.length;
            if (entry === 'overlay') await js(`(()=>{const button=[...document.querySelectorAll('[data-node-id=unconfirmed-video] button')].find(button=>button.textContent.includes('查看原任务'));if(!button)throw Error('Missing safe recovery action');button.click()})()`);
            else {
                await js(`(()=>{const node=document.querySelector('[data-node-id=unconfirmed-video]'),r=node.getBoundingClientRect();node.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:r.x+r.width/2,clientY:r.y+r.height/2}))})()`);
                await js(`window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0}))`);
                await wait('Boolean(document.querySelector("[data-node-toolbar=unconfirmed-video]"))');
                if (entry === 'toolbar') await js(`Array.from(document.querySelectorAll('[data-node-toolbar=unconfirmed-video] button')).find(button=>button.textContent.includes('查看原任务')).click()`);
                else {
                    await js(`Array.from(document.querySelectorAll('[data-node-toolbar=unconfirmed-video] button')).find(button=>button.textContent.trim()==='编辑').click()`);
                    await wait('Boolean(document.querySelector("button[aria-label=查看原任务]"))');
                    await js('document.querySelector("button[aria-label=查看原任务]").click()');
                }
            }
            await wait('Boolean(document.querySelector(".ant-modal-body")?.textContent.includes("unconfirmed-job"))');
            assert.equal(await js('[...document.querySelectorAll(".ant-modal-body button")].some(button=>/重试查询|生成/.test(button.textContent))'), false, status);
            assert.ok(videoOperations.slice(before).length > 0);
            assert.ok(videoOperations.slice(before).every(operation => operation === 'list'), status + ': ordinary retry cannot prepare, adopt or submit');
            assert.equal(modelReads.length, 0); assert.equal(recoveries.length, 1);
            assert.equal((await js('videoWorkflowTest.state().nodes.find(n=>n.id==="unconfirmed-video").metadata')).videoJobKey, 'unconfirmed-job');
            assert.deepEqual(await js('videoWorkflowTest.calls()'), []); assert.deepEqual(external, []);
        }
        assert.deepEqual(await js('videoWorkflowTest.errors()'), []);
        console.log('NATIVE_UNKNOWN_SUBMITTING_PREPARED_AND_NOT_SUBMITTED_OVERLAY_TOOLBAR_AND_GENERATE_PANEL_ZERO_PREPARE_OR_POST_OK');
        await win.loadURL('oneyes-canvas://app/');
        await wait('Boolean(window.videoWorkflowTest && document.querySelector("[data-node-id=source-video]"))');
        const requestId = '12345678-1234-1234-1234-123456789abc';
        const privateText = '上游 智赢 88API VendorOther https://private.invalid Bearer sk-private balance=987654';
        const person = '参考图片可能包含真人或可识别人物，未通过上游内容审核。请更换参考图片后重试。';
        for (const [state, error, expected] of [
            ['failed', { type: 'upstream_error', message: person + ' ' + privateText }, videoErrorMessages.reference_person_policy],
            ['unknown', { code: 'creation_outcome_unknown', message: person + ' 任务未提交，不扣费' }, videoErrorMessages.creation_outcome_unknown],
            ['failed', { type: 'upstream_error', message: 'Upstream gateway error', upstream_error_message: person }, videoErrorMessages.unknown],
            ['failed', { code: 'content_policy', message: 'Content policy violation ' + privateText }, videoErrorMessages.content_policy],
            ['cancelled', { message: privateText }, videoErrorMessages.task_cancelled],
            ['failed', { code: 'invalid_reference_format', message: privateText }, videoErrorMessages.invalid_reference_format],
            ['failed', { code: 'material_count', message: privateText }, videoErrorMessages.material_count],
            ['failed', { code: 'media_too_large', message: privateText }, videoErrorMessages.media_too_large],
            ['failed', { code: 'duration_invalid', message: privateText }, videoErrorMessages.duration_invalid],
            ['failed', { code: 'resolution_or_ratio_invalid', message: privateText }, videoErrorMessages.resolution_invalid],
            ['failed', { code: 'unsupported_field', message: privateText }, videoErrorMessages.parameters_invalid],
        ]) {
            const before = videoOperations.length;
            recoveryJob = { key: 'moderation-job', model: 'default::grok-imagine-video', site: 'https://oneyes.ai', channelId: 'default', provider: 'openai', state, reason: videoErrorText({ error }, { state, requestId }), createdAt: Date.now(), parameters: { size: '16:9', vquality: '1080', videoSeconds: '5' }, target: { projectId: await js('videoWorkflowTest.projectId'), nodeId: 'moderation-video' } };
            if (error.code === 'invalid_reference_format') recoveryJob.taskId = 'original-error-task';
            await js('videoWorkflowTest.seedErrorTask()');
            await win.loadURL('oneyes-canvas://app/');
            await wait('Boolean(window.videoWorkflowTest && document.querySelector("[data-node-id=moderation-video]"))');
            await js('videoWorkflowTest.refreshRecovery()');
            const text = expected + '\n本站请求编号：' + requestId;
            await wait(`document.querySelector('[data-node-id=moderation-video] [role=alert]')?.textContent===${JSON.stringify(text)}`);
            await js('videoWorkflowTest.flush()');
            await win.loadURL('oneyes-canvas://app/');
            await wait(`document.querySelector('[data-node-id=moderation-video] [role=alert]')?.textContent===${JSON.stringify(text)}`);
            for (const dark of [false, true]) {
                await js(`videoWorkflowTest.theme(${dark})`);
                const body = await js(`(()=>{const root=document.querySelector('[data-node-id=moderation-video]'),alert=root.querySelector('[role=alert]'),a=alert.getBoundingClientRect(),r=root.getBoundingClientRect();return {text:alert.textContent,color:getComputedStyle(alert).color,visible:a.width>0&&a.height>0&&a.top>=r.top&&a.bottom<=r.bottom}})()`);
                assert.equal(body.text, text); assert.equal(body.visible, true); assert.equal(body.color, dark ? 'rgb(245, 245, 244)' : 'rgb(41, 37, 36)');
                assert.doesNotMatch(body.text, /上游|智赢|88API|VendorOther|https?:|Bearer|sk-private|987654|不扣费|任务未提交/);
                if (!process.env.CI && error.code === 'invalid_reference_format') {
                    win.showInactive(); win.webContents.invalidate();
                    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
                    await new Promise(resolve => setTimeout(resolve, 500));
                    await writeFile(`.secrets/qa-video-reference-format-${dark ? 'dark' : 'light'}.png`, (await win.capturePage()).toPNG());
                }
            }
            const metadata = await js('videoWorkflowTest.state().nodes.find(n=>n.id==="moderation-video").metadata');
            assert.equal(metadata.errorDetails, text); assert.equal(metadata.vquality, '1080'); assert.equal(metadata.seconds, '5'); assert.equal(metadata.videoJobKey, 'moderation-job');
            if (error.code === 'invalid_reference_format') assert.equal(metadata.videoTaskId, 'original-error-task');
            assert.ok(videoOperations.slice(before).every(operation => operation === 'list')); assert.equal(recoveries.length, 1); assert.equal(modelReads.length, 0);
            assert.deepEqual(await js('videoWorkflowTest.calls()'), []); assert.deepEqual(external, []); assert.deepEqual(await js('videoWorkflowTest.errors()'), []);
        }
        console.log('NATIVE_VIDEO_NODE_SPECIFIC_MODERATION_UNKNOWN_GENERIC_AND_PRIVATE_ERRORS_IPC_PERSISTENCE_REOPEN_BOTH_THEMES_ZERO_POST_OK');
        if (process.env.CANVAS_VIDEO_WORKFLOW_SCREENSHOT) { win.showInactive(); win.webContents.invalidate(); await new Promise(resolve => setTimeout(resolve, 500)); await writeFile(join(tmpdir(), 'oneyes-video-workflow.png'), (await win.capturePage()).toPNG()); }
        console.log('VIDEO_WORKFLOW_OK', { frames: 3, originalSize: '192x128', mockedModelRequests: 4, nativeSampling: true, restart: true, manualRetry: true, cancel: true });
    } catch (error) { console.error('VIDEO_WORKFLOW_FAILED', error); console.error(await js('({body:document.body.innerText.slice(-1400),errors:window.videoWorkflowTest?.errors()})')); throw error; }
    finally { win.destroy(); await media.close(); }
}).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); });
