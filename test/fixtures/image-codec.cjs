const { app, BrowserWindow, protocol, net } = require('electron');
const assert = require('node:assert/strict');
const { readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { route } = require('../../desktop/protocol.cjs');
protocol.registerSchemesAsPrivileged([{ scheme: 'oneyes-canvas', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
app.whenReady().then(async () => {
    const root = resolve('web/dist');
    const worker = readdirSync(resolve(root, 'assets')).find(name => /^image-reference\.worker-.+\.js$/.test(name));
    assert.ok(worker, 'production worker must be bundled');
    let wasmRequests = 0;
    protocol.handle('oneyes-canvas', request => {
        if (new URL(request.url).pathname === '/') return new Response('<main>Local image codec test</main>', { headers: { 'Content-Type': 'text/html' } });
        const { file } = route(request.url, root);
        assert.ok(file, 'codec must use local packaged files only');
        if (file.endsWith('.wasm')) wasmRequests++;
        return net.fetch(file);
    });
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    try {
        await win.loadURL('oneyes-canvas://app/');
        const result = await win.webContents.executeJavaScript(`(async () => {
            const canvas = new OffscreenCanvas(2, 2);
            const context = canvas.getContext('2d'); context.fillStyle = '#123456'; context.fillRect(0, 0, 2, 2);
            const input = await canvas.convertToBlob({ type: 'image/png' });
            const worker = new Worker('/assets/${worker}', { type: 'module' });
            try {
                const output = await new Promise((resolve, reject) => {
                    worker.onmessage = event => event.data.blob ? resolve(event.data.blob) : reject(Error('Codec failed'));
                    worker.onerror = reject; worker.postMessage(new Blob([input], { type: 'application/octet-stream' }));
                });
                const bitmap = await createImageBitmap(output);
                context.clearRect(0, 0, 2, 2); context.drawImage(bitmap, 0, 0);
                const result = { bytes: Array.from(new Uint8Array(await output.arrayBuffer())), width: bitmap.width, height: bitmap.height, pixel: Array.from(context.getImageData(0, 0, 1, 1).data) };
                bitmap.close(); return result;
            } finally { worker.terminate(); }
        })()`);
        const buffer = Buffer.from(result.bytes);
        assert.equal(buffer.toString('ascii', 12, 16), 'VP8L', 'production WASM must encode losslessly, not fall back to PNG');
        assert.ok(wasmRequests, 'WASM must load from packaged assets');
        assert.equal(result.width, 2); assert.equal(result.height, 2);
        assert.deepEqual(result.pixel, [0x12, 0x34, 0x56, 255]);
        console.log('PRODUCTION_IMAGE_CODEC_OK: native scheme, bundled worker/WASM, lossless pixels, no external dependency');
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
}).catch(error => { console.error(error); app.exit(1); });
