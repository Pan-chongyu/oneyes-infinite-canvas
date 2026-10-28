const { app, BrowserWindow, protocol, net, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { createVault } = require('../../desktop/vault.cjs');
const { route } = require('../../desktop/protocol.cjs');
const { downloadImage } = require('../../desktop/image-download.cjs');
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { createServer } = require('node:http');
const { createHash } = require('node:crypto');
const base = process.argv[2], profile = process.env.CANVAS_IMAGE_TEST_PROFILE, phase = process.env.CANVAS_IMAGE_TEST_PHASE;
console.log('ASYNC_IMAGE_RESTART_START', phase);
app.setPath('userData', profile);
protocol.registerSchemesAsPrivileged([{ scheme: 'oneyes-canvas', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
app.whenReady().then(async () => {
    const vault = createVault(profile);
    ipcMain.handle('config:read', () => vault.read());
    ipcMain.handle('config:write', (_event, value) => vault.write(value));
    ipcMain.handle('config:remove', () => vault.remove());
    const counter = resolve(profile, 'posts.json');
    const posts = () => existsSync(counter) ? Number(readFileSync(counter, 'utf8')) : 0;
    let downloads = 0;
    const uploads = [];
    let attemptedPosts = 0;
    const signedImage = 'https://images.example.test/restarted.png?signature=a%2Fb%3D&x=1&x=2';
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    const imageServer = createServer((req, res) => {
        assert.equal(req.headers.authorization, undefined); assert.equal(req.headers.cookie, undefined);
        res.setHeader('Content-Type', 'image/png'); res.end(png); // Deliberately no Access-Control-Allow-Origin.
    });
    await new Promise(resolve => imageServer.listen(0, '127.0.0.1', resolve));
    const imageOrigin = `http://127.0.0.1:${imageServer.address().port}/image.png`;
    protocol.handle('oneyes-canvas', async request => {
        const url = new URL(request.url);
        if (url.pathname.startsWith('/oneyes-api/')) {
            if (request.method === 'POST') {
                attemptedPosts++;
                const form = await request.formData();
                const files = form.getAll('image[]');
                assert.equal(files.length, 4, 'all reference images must survive native multipart transport');
                assert.equal(form.get('image'), null);
                assert.equal(form.get('stream'), null);
                assert.equal(new Set(files.map(file => file.name)).size, 4, 'reference filenames must be unique');
                const { fileTypeFromBuffer } = await import('../../web/node_modules/file-type/core.js');
                for (const [index, file] of files.entries()) {
                    const bytes = Buffer.from(await file.arrayBuffer());
                    const type = await fileTypeFromBuffer(bytes);
                    assert.equal(file.type, ['image/png', 'image/jpeg', 'image/webp', 'image/png'][index]);
                    assert.equal(file.type, type.mime, 'MIME must match real image bytes, not the old storage label');
                    assert.ok(file.name.endsWith('.' + type.ext));
                    uploads.push(createHash('sha256').update(bytes).digest('hex'));
                }
                writeFileSync(counter, String(posts() + 1));
                return Response.json({ task_id: 'imgtask_restart', status: 'processing', expires_at: Math.floor(Date.now() / 1000) + 86400 }, { status: 202 });
            }
            if (phase === 'submit') return new Response(null, { status: 502 });
            return Response.json({ task_id: 'imgtask_restart', status: 'completed', result: { data: [{ url: signedImage }] } });
        }
        if (url.pathname === '/image-download') {
            const target = route(request.url, resolve('web/dist'));
            return downloadImage(request, target.image, async (url, options) => {
                assert.equal(url, signedImage, 'signed object URL must survive the native route'); downloads++;
                return net.fetch(imageOrigin, options);
            });
        }
        return net.fetch(`${base}${url.pathname === '/' ? '/__image-restart' : url.pathname}${url.search}`);
    });
    const win = new BrowserWindow({ show: false, width: 1300, height: 850, webPreferences: { preload: resolve('desktop/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const js = code => win.webContents.executeJavaScript(code);
    const wait = async condition => { const end = Date.now() + 20000; while (!await js(condition)) { if (Date.now() > end) throw Error('Timed out: ' + condition); await new Promise(resolve => setTimeout(resolve, 25)); } };
    try {
        await win.loadURL(`oneyes-canvas://app/${phase === 'submit' ? '?submit' : ''}`);
        await wait('!!window.restartTest');
        if (phase === 'submit') {
            await wait('restartTest.state().tasks[0]?.remoteId === "imgtask_restart"');
            assert.equal(posts(), 1);
            assert.equal(attemptedPosts, 1, 'invalid references must fail before submitting a paid request');
            const errors = await js('restartTest.invalidReferenceErrors()');
            assert.equal(errors.length, 2);
            assert.match(errors[0], /第 2 张参考图「损坏的图.png」/);
            assert.match(errors[1], /第 2 张参考图「缓存丢失.png」/);
            assert.deepEqual(uploads.slice(0, 3), await js('restartTest.expectedReferenceHashes()'), 'valid PNG/JPEG/WebP bytes must not be recompressed or reordered');
            assert.ok(await js('restartTest.node().metadata.images[0].imageTaskId'));
            await js('restartTest.refresh()');
            await wait('restartTest.state().tasks[0].status === "waiting"');
        } else {
            assert.equal(await js('restartTest.keyRestored()'), true, 'encrypted Key must restore before recovery');
            await wait('restartTest.state().tasks[0]?.status === "completed"');
            await wait('restartTest.node().metadata.status === "success" && !!document.querySelector("[data-node-id=restart-node] img")');
            assert.ok(await js('restartTest.blob()'), 'downloaded Blob survives process restart');
            assert.equal(posts(), 1, 'restart must never repeat a paid POST');
            assert.equal(downloads, phase === 'restore' ? 1 : 0, 'restored Blob must be reused on the next restart');
            assert.equal(await js(`fetch(${JSON.stringify(imageOrigin)}).then(() => false, () => true)`), true, 'fixture must reproduce the object-store CORS rejection');
            await js('restartTest.flush()');
        }
        await win.webContents.session.flushStorageData();
        console.log(`ASYNC_IMAGE_RESTART_OK: ${phase}`);
        app.exit(0);
    } catch (error) {
        console.error(error);
        console.error(await js('({tasks: window.restartTest?.state(), node: window.restartTest?.node(), errors: window.fixtureErrors, body:document.body.innerText.slice(0,1000)})'));
        app.exit(1);
    }
}).catch(error => { console.error(error); app.exit(1); });
