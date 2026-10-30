const { app, BrowserWindow, net } = require('electron');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'canvas-update-ui-')));
async function nativeResume() {
    const { createServer } = require('node:http');
    const { generateKeyPairSync, sign, createHash } = require('node:crypto');
    const { readFile, rm } = require('node:fs/promises');
    const { createUpdater } = require('../../desktop/updater.cjs');
    const { filename, RELEASE_ROOT } = require('../../desktop/update-policy.cjs');
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const payload = Buffer.from('native signed update fixture '.repeat(128)), prefix = payload.subarray(0, 256);
    const file = filename('0.21.0', 'win32', 'x64', 'nsis');
    const text = JSON.stringify({ schema: 1, version: '0.21.0', notes: 'fixture', platforms: { 'win32-x64-nsis': { file, size: payload.length, sha256: createHash('sha256').update(payload).digest('hex'), url: `${RELEASE_ROOT}/download/v0.21.0/${file}` } } });
    const signature = sign(null, Buffer.from(text), privateKey).toString('base64');
    let pending, first = true, installs = 0;
    const ranges = [];
    const server = createServer((request, response) => {
        if (request.url === '/probe') { response.end(); return; }
        if (request.url.endsWith('.sig')) { response.end(signature); return; }
        if (request.url.endsWith('.json')) { response.end(text); return; }
        ranges.push(request.headers.range);
        if (first) {
            first = false; pending = response;
            response.writeHead(200, { ETag: '"native"', 'Content-Length': payload.length, 'Content-Type': 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' }); response.write(prefix);
        } else {
            assert.equal(request.headers.range, `bytes=${prefix.length}-`);
            assert.equal(request.headers['if-range'], '"native"');
            response.writeHead(206, { ETag: '"native"', 'Content-Range': `bytes ${prefix.length}-${payload.length - 1}/${payload.length}`, 'Content-Length': payload.length - prefix.length });
            response.end(payload.subarray(prefix.length));
        }
    });
    for (;;) {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try { await (await fetch(`http://127.0.0.1:${server.address().port}/probe`)).arrayBuffer(); break; }
        catch (error) { await new Promise(resolve => server.close(resolve)); if (error.cause?.message !== 'bad port') throw error; }
    }
    const directory = join(app.getPath('userData'), 'native-ota');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const options = { currentVersion: '0.20.20', directory, publicKey, target: async () => ({ platform: 'win32', arch: 'x64', format: 'nsis' }),
        fetcher: (url, init) => net.fetch(origin + new URL(url).pathname, init),
        install: async plan => { assert.deepEqual(await readFile(plan.file), payload); installs++; },
        changed: state => { if (state.downloaded === prefix.length && pending) { pending.destroy(); pending = null; } },
    };
    const updater = createUpdater(options), restarted = createUpdater(options);
    try {
        await updater.check(); assert.equal(updater.state().status, 'error');
        assert.deepEqual(await readFile(join(directory, 'ota/0.21.0', file + '.part')), prefix);
        updater.close();
        await restarted.check(); assert.equal(restarted.state().status, 'ready');
        await restarted.apply(); assert.equal(installs, 1);
        assert.deepEqual(ranges, [undefined, `bytes=${prefix.length}-`]);
        console.log('NATIVE_OTA_RESUME_OK: Electron HTTP socket interruption, restored prefix, Range/If-Range, complete-file hash before installation');
    } finally { updater.close(); restarted.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
}
app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1000, height: 720, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    win.webContents.on('console-message', details => { if (details.level >= 2) console.error(details.message); });
    const js = async code => { try { return await win.webContents.executeJavaScript(code); } catch(error) { throw new Error(code + ': ' + error.message); } };
    const wait = async condition => { const end = Date.now() + 20000; while (!await js(condition)) { if (Date.now() > end) throw Error('Timed out: ' + condition); await new Promise(resolve => setTimeout(resolve, 25)); } };
    try {
        await nativeResume();
        await win.loadURL(process.argv[2]);
        await wait('window.updateTest && document.querySelector("[aria-expanded]")');
        await js('document.querySelector("[aria-expanded]").click()');
        await wait('document.querySelector("section[aria-label=软件更新]")');
        const contrast = async () => js(`(() => {
            const button = document.querySelector('section[aria-label="软件更新"] > button');
            const style = getComputedStyle(button), panel = getComputedStyle(button.parentElement);
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
            const ctx = canvas.getContext('2d');
            const rgb = color => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3); };
            const opacity = Number(style.opacity), base = rgb(panel.backgroundColor);
            const composite = color => rgb(color).map((value, i) => value * opacity + base[i] * (1 - opacity));
            const luminance = color => color.map(value => { value /= 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
            const fg = luminance(composite(style.color)), bg = luminance(composite(style.backgroundColor));
            return { ratio: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05), color: style.color, background: style.backgroundColor, icon: getComputedStyle(button.querySelector('svg')).color, disabled: button.disabled };
        })()`);
        for (const dark of [false, true]) {
            await js(`updateTest.theme(${dark})`);
            for (const status of ['idle', 'checking', 'downloading', 'installing', 'ready', 'error']) {
                await js(`updateTest.status('${status}')`);
                await wait(`updateTest.state().status === '${status}' && document.querySelector('section > button').disabled === ${['checking', 'downloading', 'installing'].includes(status)}`);
                const colors = await contrast();
                assert.ok(colors.ratio >= 4.5, `${dark ? 'dark' : 'light'} ${status} button contrast: ${JSON.stringify(colors)}`);
                assert.equal(colors.icon, colors.color, 'update icon must match readable button text');
            }
            await js('updateTest.status("idle", false)');
            await wait('document.querySelector("section > button").disabled');
            assert.ok((await contrast()).ratio >= 4.5, 'unsupported target button remains legible');
        }
        await js('updateTest.theme(false); updateTest.status("ready")');
        await wait('!document.querySelector("section > button").disabled');
        assert.match(await js('document.body.textContent'), /新版本 v0.20.21 已下载完成/);
        await js('updateTest.agentBusy(true);Array.from(document.querySelectorAll("section button")).find(x=>x.textContent === "更新并重启").click()');
        await js('new Promise(resolve => setTimeout(resolve, 100))');
        assert.ok(!(await js('updateTest.state().operations')).includes('install'));
        await js('updateTest.agentBusy(false);Array.from(document.querySelectorAll("section button")).find(x=>x.textContent === "更新并重启").click()');
        await wait('updateTest.state().operations.includes("install")');
        assert.equal(await js('updateTest.saved()'), 'OTA 未落盘画布');
        await js('updateTest.status("downloading")');
        await wait('document.querySelector("[role=progressbar]")');
        assert.equal(await js('document.querySelector("[role=progressbar]").getAttribute("aria-valuenow")'), '36');
        await js('updateTest.status("ready")');
        await wait('document.body.textContent.includes("新版本 v0.20.21")');
        const before = await js('document.querySelector("section").getBoundingClientRect().toJSON()');
        assert.ok(before.width <= 281 && before.height < 300, 'compact update panel');
        if (process.env.CANVAS_UPDATE_SCREENSHOT) {
            await js('new Promise(resolve => requestAnimationFrame(resolve))');
            writeFileSync(process.env.CANVAS_UPDATE_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
            await js('updateTest.theme(true)');
            win.setSize(400, 680);
            await js('new Promise(resolve => requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
            const narrow = await js('document.querySelector("section").getBoundingClientRect().toJSON()');
            assert.ok(narrow.left >= 0 && narrow.right <= 400);
            writeFileSync(process.env.CANVAS_UPDATE_SCREENSHOT.replace('.png', '-dark.png'), (await win.webContents.capturePage()).toPNG());
        }
        console.log('OTA_UI_OK: version prompt, background progress, busy guard, save before install, compact panel'); app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});
