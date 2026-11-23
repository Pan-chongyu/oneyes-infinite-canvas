const { app, BrowserWindow, protocol, net, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { createServer } = require('node:http');
const { route } = require('../../desktop/protocol.cjs');
const { downloadImage } = require('../../desktop/image-download.cjs');
const { createVault } = require('../../desktop/vault.cjs');
const profile = process.env.CANVAS_IMAGE_DELIVERY_PROFILE;
app.setPath('userData', profile);
protocol.registerSchemesAsPrivileged([{ scheme: 'oneyes-canvas', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
app.whenReady().then(async () => {
    let posts = 0, polls = 0, downloads = 0, releaseDownload = () => {};
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    const imageServer = createServer((req, res) => {
        assert.equal(req.headers.authorization, undefined); assert.equal(req.headers.cookie, undefined);
        res.setHeader('Content-Type', 'image/png'); res.setHeader('Content-Length', png.length);
        if (req.url === '/stream.png') {
            res.write(png.subarray(0, 24));
            releaseDownload = () => res.end(png.subarray(24));
        } else res.end(png);
    });
    for (;;) {
        await new Promise(resolve => imageServer.listen(0, '127.0.0.1', resolve));
        try { await (await fetch(`http://127.0.0.1:${imageServer.address().port}/image.png`)).arrayBuffer(); break; }
        catch (error) { await new Promise(resolve => imageServer.close(resolve)); if (error.cause?.message !== 'bad port') throw error; }
    }
    const imageOrigin = `http://127.0.0.1:${imageServer.address().port}/image.png`;
    const vault = createVault(profile);
    ipcMain.handle('diagnostics:report', () => {});
    ipcMain.handle('config:read', () => vault.read());
    ipcMain.handle('config:write', (_event, value) => vault.write(value));
    ipcMain.handle('config:remove', () => vault.remove());
    protocol.handle('oneyes-canvas', async request => {
        const url = new URL(request.url);
        if (url.pathname.startsWith('/oneyes-api/')) {
            assert.equal(request.headers.get('Authorization'), 'Bearer fixture-private-key');
            if (request.method === 'POST') {
                posts++;
                return Response.json({ task_id: 'imgtask_fast', status: 'completed', result: { data: [{ url: 'https://images.example.test/fast.png?signed=a%2Fb' }] } }, { headers: { 'Retry-After': '3600' } });
            }
            polls++; throw Error('A ready result must not wait for a GET or Retry-After');
        }
        if (url.pathname === '/image-download') {
            const target = route(request.url, resolve('web/dist'));
            assert.equal(target.image, 'https://images.example.test/fast.png?signed=a%2Fb'); downloads++;
            return downloadImage(request, target.image, (_url, options) => net.fetch(imageOrigin.replace('/image.png', '/stream.png'), options));
        }
        return net.fetch(`${process.argv[2]}${url.pathname === '/' ? '/__image-delivery' : url.pathname}${url.search}`);
    });
    const win = new BrowserWindow({ show: false, width: 1300, height: 850, webPreferences: { preload: resolve('desktop/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const js = code => win.webContents.executeJavaScript(code);
    const wait = async code => { const end = Date.now() + 20000; while (!await js(code)) { if (Date.now() > end) throw Error('Fast image wait failed: ' + code); await new Promise(resolve => setTimeout(resolve, 25)); } };
    try {
        await win.loadURL('oneyes-canvas://app/'); await wait('Boolean(window.deliveryTest) && deliveryTest.slowReads()>0 && Boolean(document.querySelector("[data-node-id=fast]"))');
        await js('deliveryTest.start()');
        await wait('deliveryTest.progress()?.receivedBytes===24 && Boolean(document.querySelector("[data-node-id=fast] [role=progressbar]"))');
        assert.equal(await js('deliveryTest.progress().totalBytes'), png.length);
        assert.equal(await js('Number(document.querySelector("[data-node-id=fast] [role=progressbar]").getAttribute("aria-valuenow"))'), Math.floor(24 / png.length * 100));
        assert.equal(await js('Boolean(document.querySelector("[data-node-id=fast] img"))'), false, 'partial bytes must not be passed off as an original');
        releaseDownload();
        await wait('deliveryTest.blocked().metadataBlocked && deliveryTest.blocked().writeSettled');
        assert.deepEqual(Buffer.from(await js('deliveryTest.pendingOriginal()')), png, 'original persistence runs while metadata decoding is blocked');
        assert.equal(await js('deliveryTest.state().find(task=>task.id==="fast").images.length'), 0);
        await js('deliveryTest.releaseMetadata()');
        await wait('Boolean(document.querySelector("[data-node-id=fast] img")) && document.querySelector("[data-node-id=fast]").textContent.includes("正在保存到本机")');
        assert.equal(await js('deliveryTest.state().find(task=>task.id==="fast").status'), 'saving', 'early display must not claim a durable task checkpoint');
        for (const theme of ['dark', 'light']) {
            await js(`deliveryTest.theme('${theme}')`);
            await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
            const image = await js('(()=>{const image=document.querySelector("[data-node-id=fast] img");return {loaded:image.complete,width:image.naturalWidth,height:image.naturalHeight}})()');
            assert.deepEqual(image, { loaded: true, width: 1, height: 1 });
        }
        await js('deliveryTest.releaseWrite()');
        await wait('deliveryTest.state().find(task=>task.id==="fast")?.status==="completed" && Boolean(document.querySelector("[data-node-id=fast] img"))');
        await wait('!deliveryTest.progress()');
        assert.deepEqual(await js('deliveryTest.invalidOriginal()'), { failed: true, displayed: false, stored: false }, 'decode failure must clean the parallel write and never display a corrupt original');
        assert.equal(posts, 1); assert.equal(polls, 0); assert.equal(downloads, 1);
        assert.ok(await js('deliveryTest.slowReads()>0'));
        assert.equal(await js('Boolean(document.querySelector("[data-node-id=unreadable] img"))'), false);
        assert.equal(await js('Boolean(document.querySelector("[data-node-id=slow] img"))'), false, 'the deliberately blocked original still has not resolved');
        assert.deepEqual(Buffer.from(await js('deliveryTest.bytes()')), png, 'visible original is already saved with identical bytes');
        assert.deepEqual(await js('deliveryTest.warmCache()'), { reads: 0, dimensions: Array.from({ length: 20 }, () => [1, 1]) });
        assert.equal(downloads, 1, 'warm original reuse must not issue another image download');
        assert.equal(await js(`fetch(${JSON.stringify(imageOrigin)}).then(()=>false,()=>true)`), true, 'the native download must work without object-store CORS');
        await js('deliveryTest.releaseSlow()');
        console.log('IMAGE_FAST_DELIVERY_OK: real streamed byte progress, parallel decode/persistence, original visible before write acknowledgment without premature checkpoint, both themes, no repeated POST/GET/download/IDB read');
    } catch (error) { console.error(error.stack); console.error(await js('({body:document.body.innerText.slice(0,1800),tasks:window.deliveryTest?.state(),slowReads:window.deliveryTest?.slowReads(),errors:window.fixtureErrors})')); process.exitCode = 1; }
    finally { win.destroy(); imageServer.closeAllConnections(); await new Promise(resolve => imageServer.close(resolve)); app.exit(process.exitCode || 0); }
}).catch(error => { console.error(error); app.exit(1); });
