const { app, BrowserWindow, protocol, net } = require('electron');
const { mkdtempSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'canvas-video-protocol-')));
protocol.registerSchemesAsPrivileged([{ scheme: 'oneyes-canvas', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
app.whenReady().then(async () => {
    const posts = [], gets = []; let polls = 0;
    protocol.handle('oneyes-canvas', async request => {
        const url = new URL(request.url);
        if (url.pathname === '/proxy') {
            const target = new URL(url.searchParams.get('url'));
            assert.equal(target.origin, 'https://oneyes.ai');
            assert.equal(request.headers.get('Authorization'), 'Bearer fixture-key');
            if (request.method === 'POST') {
                assert.equal(request.headers.get('content-type'), 'application/json');
                const body = await request.json(); posts.push({ path: target.pathname, body });
                return Response.json({ request_id: `task-${posts.length}` });
            }
            gets.push(target.pathname);
            if (target.pathname.endsWith('/content')) return new Response('video', { headers: { 'Content-Type': 'video/mp4' } });
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
        assert.equal((await win.webContents.executeJavaScript('videoTest()')).length, 9);
        assert.equal(posts.length, 9, 'invalid references and unsupported resolutions never submit a paid request');
        assert.deepEqual(posts[0], { path: '/v1/videos/generations', body: { model: 'grok-imagine-video', prompt: '服装模特', duration: 5, aspect_ratio: '1:1', resolution: '480p' } });
        assert.ok(posts[1].body.image); assert.equal(posts[1].body.reference_images, undefined);
        assert.ok(posts[2].body.image && posts[2].body.last_frame);
        assert.equal(posts[3].body.reference_images.length, 3); assert.equal(posts[3].body.image, undefined);
        assert.equal(posts[4].body.reference_audios[0].url, 'data:audio/mpeg;base64,YXVkaW8=');
        assert.equal(posts[5].path, '/v1/videos/edits');
        assert.deepEqual(posts[5].body, { model: 'grok-imagine-video', prompt: 'edit', video: { url: 'data:video/mp4;base64,dmlkZW8=' } });
        assert.equal(posts[6].body.resolution, '1080p', 'text-to-video keeps 1080p');
        assert.equal(posts[7].body.resolution, '1080p', 'first/last frames keep 1080p');
        assert.equal(posts[8].body.resolution, '720p', 'reference resolution changes only when explicitly selected');
        const { fileTypeFromBuffer } = await import('../../web/node_modules/file-type/core.js');
        for (const image of [posts[1].body.image, posts[2].body.last_frame, ...posts[3].body.reference_images]) {
            const bytes = Buffer.from(image.url.split(',')[1], 'base64');
            assert.equal((await fileTypeFromBuffer(bytes)).mime, 'image/webp');
            assert.ok(image.url.startsWith('data:image/webp;base64,'), 'video references must use the normalized actual MIME, not asset labels');
        }
        assert.deepEqual(gets, ['/v1/videos/task-1', '/v1/videos/task-1', '/v1/videos/task-1/content']);
        assert.equal(await win.webContents.executeJavaScript('videoSettingsTest()'), 'GROK_VIDEO_SETTINGS_OK');
        assert.equal(posts.length, 9, 'settings changes never submit requests');
        console.log('GROK_VIDEO_NATIVE_OK: JSON, request_id, frames, references, audio, edit, Worker MIME, 202/done, authenticated content, no duplicate POST');
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
}).catch(error => { console.error(error); app.exit(1); });
