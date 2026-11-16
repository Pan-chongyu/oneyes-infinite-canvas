const { app, BrowserWindow, protocol, net } = require('electron');
const { mkdtempSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
const { createVideoTasks } = require('../../desktop/video-tasks.cjs');
const { createVault } = require('../../desktop/vault.cjs');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'canvas-video-protocol-')));
protocol.registerSchemesAsPrivileged([{ scheme: 'oneyes-canvas', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
app.whenReady().then(async () => {
    const posts = [], gets = []; let polls = 0, longPolls = 0;
    const busyRequests = [];
    const manager = createVideoTasks({ directory: app.getPath('userData'), vault: createVault(app.getPath('userData'), 'video-tasks'), credentials: async () => [], probe: async () => ({}),
        fetcher: async (_url, init) => { assert.equal(init.method, 'GET'); return Response.json({ status: 'pending' }); } });
    protocol.handle('oneyes-canvas', async request => {
        const url = new URL(request.url);
        if (url.pathname === '/test-video-tasks') {
            const { operation, args } = await request.json();
            assert.ok(['prepare', 'list', 'submissionError'].includes(operation));
            return Response.json({ data: operation === 'submissionError' ? await manager.submissionError(args.key, args.reason) : await manager[operation](args) });
        }
        if (url.pathname === '/proxy') {
            const target = new URL(url.searchParams.get('url'));
            assert.equal(target.origin, 'https://oneyes.ai');
            assert.equal(request.headers.get('Authorization'), 'Bearer fixture-key');
            if (request.method === 'GET' && target.pathname === '/v1/models') {
                const catalog = await win.webContents.executeJavaScript('videoAvailableModels');
                return Response.json({ data: catalog.map(id => ({ id })) });
            }
            if (request.method === 'POST') {
                const type = request.headers.get('content-type');
                const job = request.headers.get('x-oneyes-video-job');
                if (job) {
                    const bytes = await request.arrayBuffer(), headers = Object.fromEntries(request.headers);
                    await manager.beforeSubmit(job, target.href, headers, bytes);
                    busyRequests.push({ bytes: Buffer.from(bytes), key: request.headers.get('idempotency-key'), type });
                    const response = busyRequests.length === 1 ? Response.json({ error: { code: 'large_material_busy' } }, { status: 429, headers: { 'Retry-After': '0.1' } }) : Response.json({ request_id: 'busy-one-task' });
                    await manager.receipt(job, response); return response;
                }
                const raw = process.env.ONEYES_BRIDGE_TEST_DIRECTORY && posts.length >= 12 ? Buffer.from(await request.clone().arrayBuffer()) : undefined;
                const body = /multipart\/form-data/.test(type) ? Object.fromEntries(await request.formData()) : await request.json();
                if (raw) {
                    const { pathToFileURL } = require('node:url');
                    const adapter = (await import(pathToFileURL(join(process.env.ONEYES_BRIDGE_TEST_DIRECTORY, /^(sd-|seedance-.*official|seedance-2.5-dedicated|SD-特价|wan3\.0$)/.test(body.model) ? 'zhiying-request.mjs' : '88api-request.mjs')).href)).default;
                    assert.doesNotThrow(() => adapter.normalizeCreateBody({ requestBuffer: raw }, type), body.model);
                }
                posts.push({ path: target.pathname, body, type });
                return Response.json(body.model === 'seedance-2.5' ? { id: `task-${posts.length}` } : { request_id: `task-${posts.length}` });
            }
            gets.push(target.pathname);
            if (target.pathname.endsWith('/content')) return new Response('video', { headers: { 'Content-Type': 'video/mp4' } });
            if (target.pathname.endsWith('/long-running')) {
                longPolls++;
                if (longPolls === 3) return new Response(null, { status: 503 });
                return Response.json(longPolls <= 130 ? { status: 'pending' } : { status: 'completed' });
            }
            if (target.pathname.endsWith('/cancel-wait')) return Response.json({ status: 'pending' });
            if (++polls === 1) return new Response(null, { status: 202 });
            return Response.json({ status: 'done', video: { url: '/v1/videos/task-1/content', respect_moderation: true } });
        }
        return net.fetch(process.argv[2].replace('/__agent-chat', '') + (url.pathname === '/' ? '/__agent-chat' : url.pathname));
    });
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    try {
        await win.loadURL('oneyes-canvas://app/');
        const end = Date.now() + 20000;
        while (!await win.webContents.executeJavaScript('!!window.videoTest')) { if (Date.now() > end) throw Error('Video fixture did not load'); await new Promise(resolve => setTimeout(resolve, 25)); }
        assert.equal((await win.webContents.executeJavaScript('videoTest()')).length, 12);
        assert.equal(posts.length, 12, 'invalid references and unsupported resolutions never submit a paid request');
        assert.deepEqual(posts[0].body, { model: 'grok-imagine-video', prompt: '服装模特', duration: 5, aspect_ratio: '1:1', resolution: '480p' });
        assert.equal(posts[0].path, '/v1/videos/generations');
        assert.ok(posts[1].body.image); assert.equal(posts[1].body.reference_images, undefined);
        assert.ok(posts[2].body.image && posts[2].body.last_frame);
        assert.equal(posts[3].body.reference_images.length, 3); assert.equal(posts[3].body.image, undefined);
        assert.equal(posts[4].body.reference_audios[0].url, 'data:audio/mpeg;base64,YXVkaW8=');
        assert.equal(posts[5].path, '/v1/videos/edits');
        assert.deepEqual(posts[5].body, { model: 'grok-imagine-video', prompt: 'edit', video: { url: 'data:video/mp4;base64,dmlkZW8=' } });
        assert.equal(posts[6].body.resolution, '1080p', 'text-to-video keeps 1080p');
        assert.equal(posts[7].body.resolution, '1080p', 'first/last frames keep 1080p');
        assert.equal(posts[8].body.resolution, '720p', 'reference resolution changes only when explicitly selected');
        assert.equal(posts[9].path, '/v1/videos/generations');
        assert.deepEqual(posts[9].body, { model: 'seedance-2.5', prompt: 'seedance-frame', duration: 5, aspect_ratio: '16:9', resolution: '720p', watermark: false, generate_audio: true, image: posts[9].body.image });
        assert.ok(posts[9].body.image);
        assert.ok(posts[10].body.image && posts[10].body.last_frame);
        assert.equal(posts[10].body.watermark, true);
        assert.equal(posts[10].body.generate_audio, false);
        assert.equal(posts[11].body.reference_images.length, 3);
        assert.equal(posts[11].body.resolution, '1080p', 'Seedance must not inherit xAI-only resolution restrictions');
        assert.equal(posts[11].body.reference_audios[0].url, 'data:audio/mpeg;base64,YXVkaW8=');
        const { fileTypeFromBuffer } = await import('../../web/node_modules/file-type/core.js');
        for (const image of [posts[1].body.image, posts[2].body.last_frame, ...posts[3].body.reference_images, posts[9].body.image, posts[10].body.last_frame, ...posts[11].body.reference_images]) {
            const bytes = Buffer.from(image.url.split(',')[1], 'base64');
            assert.equal((await fileTypeFromBuffer(bytes)).mime, 'image/webp');
            assert.ok(image.url.startsWith('data:image/webp;base64,'), 'video references must use the normalized actual MIME, not asset labels');
        }
        assert.deepEqual(gets, ['/v1/videos/task-1', '/v1/videos/task-1', '/v1/videos/task-1/content']);
        assert.equal(await win.webContents.executeJavaScript('videoSettingsTest()'), 'GROK_VIDEO_SETTINGS_OK');
        assert.equal(await win.webContents.executeJavaScript('videoWaitTest()'), 'VIDEO_LONG_WAIT_OK');
        assert.equal(longPolls, 131, 'native waiting must survive the previous poll limit and transient gateway failure');
        assert.equal(posts.length, 12, 'settings changes never submit requests');
        assert.equal(await win.webContents.executeJavaScript('videoBridgeTest()'), 'VIDEO_BRIDGE_NATIVE_OK');
        const bridge = posts.slice(12);
        assert.equal(bridge.length, 24);
        assert.ok(bridge.every(item => item.path === '/v1/videos'));
        const omni = bridge.find(item => item.body.model === 'gemini-omni-flash-1.1').body;
        assert.equal(omni.duration, 3); assert.equal(omni.seconds, undefined); assert.equal(omni.resolution, '720p');
        const zhiying = bridge.find(item => item.body.model === 'sd-2.5-fullblood');
        assert.match(zhiying.type, /multipart\/form-data; boundary=/);
        assert.deepEqual(Object.keys(zhiying.body), ['model', 'prompt', 'resolution', 'duration', 'aspect_ratio']);
        assert.ok(bridge.at(-1).body.reference_images instanceof File);
        assert.ok(!JSON.stringify(bridge.at(-1).body).includes('data:image/'));
        const key = await win.webContents.executeJavaScript('videoBusyTest()');
        assert.equal(busyRequests.length, 2); assert.equal(busyRequests[0].key, key); assert.equal(busyRequests[1].key, key);
        assert.equal(busyRequests[0].type, busyRequests[1].type); assert.deepEqual(busyRequests[0].bytes, busyRequests[1].bytes);
        assert.match(busyRequests[0].type, /multipart\/form-data; boundary=/); assert.ok(!busyRequests[0].bytes.includes(Buffer.from('data:image/')));
        assert.equal((await manager.list())[0].taskId, 'busy-one-task'); await manager.close();
        console.log('GROK_VIDEO_NATIVE_OK: JSON, Seedance booleans, id/request_id, frames, references, audio, edit, Worker MIME, 202/done, authenticated content, no duplicate POST');
        console.log('VIDEO_BUSY_NATIVE_OK: Fetch binary multipart, unchanged boundary/bytes, durable idempotency, one accepted task');
        app.exit(0);
    } catch (error) { await manager.close(); console.error(error); app.exit(1); }
}).catch(error => { console.error(error); app.exit(1); });
