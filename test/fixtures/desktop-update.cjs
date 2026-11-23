const { app, BrowserWindow, net } = require('electron');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'canvas-update-ui-')));
async function nativeReleaseRedirect() {
    const { createServer } = require('node:http');
    const { createNativeFetch } = require('../../desktop/native-fetch.cjs');
    const { createReleaseFetcher } = require('../../desktop/release-fetch.cjs');
    const native = createNativeFetch(net), payload = Buffer.from('official fixture bytes');
    let downloads = 0, metadata = 0, resolutions = 0, fallbacks = 0, limited = '', expired = false, waiting, cancelled;
    const requested = new Promise(resolve => { waiting = resolve; }), disconnected = new Promise(resolve => { cancelled = resolve; });
    const server = createServer((request, response) => {
        if (request.url === '/probe') { response.end(); return; }
        if (request.url === '/wait') { request.on('close', cancelled); waiting(); return; }
        if (request.url.endsWith('/latest')) {
            metadata++;
            if (limited === 'metadata') { response.writeHead(403); response.end(); return; }
            response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ tag_name: 'v1', assets: [{ name: 'probe.bin', id: 1, state: 'uploaded' }] })); return;
        }
        if (request.url.includes('/assets/1')) {
            resolutions++; assert.equal(request.headers['cache-control'], 'no-cache');
            if (limited === 'asset' || resolutions > 60) { response.writeHead(403); response.end(); return; }
            response.writeHead(302, { Location: `https://release-assets.githubusercontent.com/fixture/file/${resolutions}` }); response.end(); return;
        }
        if (request.url.endsWith('/download/probe.bin') || request.url.endsWith('/download/v1/probe.bin')) {
            fallbacks++; assert.equal(request.headers.authorization, undefined); assert.equal(request.headers.cookie, undefined); assert.equal(request.headers['cache-control'], 'no-cache');
            if (request.url.includes('/latest/download/')) { response.writeHead(302, { Location: 'https://github.com/owner/repo/releases/download/v1/probe.bin' }); response.end(); return; }
            assert.ok(request.url.includes('/download/v1/'));
            response.writeHead(302, { Location: 'https://release-assets.githubusercontent.com/fixture/file/fallback' }); response.end(); return;
        }
        if (request.url === '/redirect') { response.writeHead(302, { Location: 'https://release-assets.githubusercontent.com/fixture/file/1' }); response.end(); return; }
        if (request.url.startsWith('/fixture/file/')) {
            downloads++; assert.equal(request.headers.authorization, undefined); assert.equal(request.headers.cookie, undefined);
            assert.equal(request.headers.range, 'bytes=2-'); assert.equal(request.headers['if-range'], '"fixture"');
            if (expired && request.url.endsWith('/1')) { response.writeHead(403); response.end(); return; }
            response.writeHead(206, { 'Content-Range': `bytes 2-${payload.length - 1}/${payload.length}` }); response.end(payload.subarray(2)); return;
        }
        response.writeHead(503, { 'Content-Type': 'application/json' }); response.end('{"unavailable":true}');
    });
    for (;;) {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try { await (await fetch(`http://127.0.0.1:${server.address().port}/probe`)).arrayBuffer(); break; }
        catch (error) { await new Promise(resolve => server.close(resolve)); if (error.cause?.message !== 'bad port') throw error; }
    }
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
        const redirect = await native(origin + '/redirect', { redirect: 'manual' });
        assert.equal(redirect.status, 302); assert.equal(downloads, 0); assert.equal(new URL(redirect.headers.get('location')).hostname, 'release-assets.githubusercontent.com');
        const download = createReleaseFetcher({ token: 'fixture-secret', request: (url, init) => native(origin + new URL(url).pathname, init) });
        const range = async () => {
            const response = await download('https://github.com/owner/repo/releases/latest/download/probe.bin', { headers: { Range: 'bytes=2-', 'If-Range': '"fixture"', Cookie: 'private', Authorization: 'private' } });
            assert.equal(response.status, 206); assert.deepEqual(Buffer.from(await response.arrayBuffer()), payload.subarray(2));
        };
        for (let i = 0; i < 100; i++) await range();
        assert.equal(downloads, 100); assert.equal(metadata, 1); assert.equal(resolutions, 1); assert.equal(fallbacks, 0);
        expired = true; await range(); assert.equal(resolutions, 2); assert.equal(downloads, 102);
        for (const stage of ['metadata', 'asset']) { limited = stage; download.reset(); await range(); }
        assert.equal(fallbacks, 3);
        const failed = await native(origin + '/failed', { redirect: 'manual' }); assert.equal(failed.status, 503); assert.deepEqual(await failed.json(), { unavailable: true });
        const abort = new AbortController(), pending = native(origin + '/wait', { redirect: 'manual', signal: abort.signal });
        await requested; abort.abort(); await assert.rejects(pending, { name: 'AbortError' }); await disconnected;
        await assert.rejects(native(origin + '/wait', { redirect: 'manual', signal: abort.signal }), { name: 'AbortError' });
        console.log('NATIVE_RELEASE_API_OK: 100 native byte ranges resolve once, expired URL renewal, rate-limited API fallback, no credential forwarding, HTTP failure and abort');
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
async function nativeResume() {
    const { createServer } = require('node:http');
    const { generateKeyPairSync, sign, createHash } = require('node:crypto');
    const { readFile, rm } = require('node:fs/promises');
    const { legacyUpdate } = require('./legacy-update.cjs');
    const { createUpdater } = legacyUpdate('updater.cjs');
    const { createReleaseFetcher } = legacyUpdate('release-fetch.cjs');
    const native = require('../../desktop/native-fetch.cjs').createNativeFetch(net);
    const { filename, RELEASE_ROOT } = require('../../desktop/update-policy.cjs');
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const payload = Buffer.from('native signed update fixture '.repeat(128)), prefix = payload.subarray(0, 256);
    const file = filename('0.21.0', 'win32', 'x64', 'nsis');
    const text = JSON.stringify({ schema: 1, version: '0.21.0', notes: 'fixture', platforms: { 'win32-x64-nsis': { file, size: payload.length, sha256: createHash('sha256').update(payload).digest('hex'), url: `${RELEASE_ROOT}/download/v0.21.0/${file}`, rangeBlockmap: { file: file + '.blockmap', url: `${RELEASE_ROOT}/download/v0.21.0/${file}.blockmap`, size: 1, sha256: 'a'.repeat(64) } } } });
    const signature = sign(null, Buffer.from(text), privateKey).toString('base64');
    let pending, first = true, installs = 0, apiCalls = 0;
    const ranges = [];
    const server = createServer((request, response) => {
        if (request.url === '/probe') { response.end(); return; }
        if (/\/releases\/(?:latest|tags\/v0.21.0)$/.test(request.url)) {
            apiCalls++; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ assets: ['canvas-latest.json', 'canvas-latest.json.sig', file].map((name, i) => ({ name, id: i + 1, state: 'uploaded' })) })); return;
        }
        if (request.url.includes('/releases/assets/')) {
            apiCalls++; const name = ['canvas-latest.json', 'canvas-latest.json.sig', file][Number(request.url.split('/').at(-1)) - 1];
            response.writeHead(302, { Location: `https://release-assets.githubusercontent.com/fixture/${name}` }); response.end(); return;
        }
        assert.ok(!request.url.endsWith('.blockmap'), 'the old updater must ignore the new range map');
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
    const options = { currentVersion: '0.20.207', directory, publicKey, target: async () => ({ platform: 'win32', arch: 'x64', format: 'nsis' }),
        fetcher: createReleaseFetcher({ request: (url, init) => native(origin + new URL(url).pathname, init) }),
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
        assert.equal(apiCalls, 10);
        console.log('NATIVE_OTA_RESUME_OK: unmodified v0.20.207 engine and API resolver, new signed feed, socket interruption, Range/If-Range, complete-file hash before installation');
    } finally { updater.close(); restarted.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
}
async function nativeBlockResume(platform,arch,format) {
    const { createServer } = require('node:http'), { gzipSync } = require('node:zlib');
    const { generateKeyPairSync, sign, createHash } = require('node:crypto');
    const { mkdir, writeFile, readFile } = require('node:fs/promises');
    const { createUpdater } = require('../../desktop/updater.cjs');
    const { filename, RELEASE_ROOT } = require('../../desktop/update-policy.cjs');
    const { publicKey, privateKey } = generateKeyPairSync('ed25519'), hash = bytes => createHash('sha256').update(bytes).digest('hex');
    const base = Buffer.concat([Buffer.alloc(64, 1), Buffer.alloc(64, 2)]), next = Buffer.concat([Buffer.alloc(64, 2), Buffer.alloc(64, 3)]);
    const map = bytes => gzipSync(JSON.stringify({ version: '2', files: [{ name: 'file', offset: 0, sizes: [64, 64], checksums: [hash(bytes.subarray(0, 64)), hash(bytes.subarray(64))] }] }));
    const release = (version, bytes) => {
        const file = filename(version, platform, arch, format), url = `${RELEASE_ROOT}/download/v${version}/${file}`, blockmap = map(bytes);
        const entry = { file, url, size: bytes.length, sha256: hash(bytes), blockmap: { file: file + '.blockmap', url: url + '.blockmap', size: blockmap.length, sha256: hash(blockmap) } };
        const published = version === '1.0.0' ? entry : { ...entry, rangeBlockmap: entry.blockmap, blockmap: undefined };
        const text = JSON.stringify({ schema: 1, version, notes: 'native blocks', platforms: { [`${platform}-${arch}-${format}`]: published } });
        return { entry, text, signature: sign(null, Buffer.from(text), privateKey).toString('base64'), blockmap };
    };
    const old = release('1.0.0', base), current = release('1.0.1', next), ranges = [];
    let pending, first = true, installs = 0;
    const server = createServer((request, response) => {
        if (request.url === '/probe') { response.end(); return; }
        if (request.url.endsWith('.sig')) { response.end(current.signature); return; }
        if (request.url.endsWith('.json')) { response.end(current.text); return; }
        if (request.url.endsWith('.blockmap')) { response.end(request.url.includes('/v1.0.0/') ? old.blockmap : current.blockmap); return; }
        ranges.push(request.headers.range);
        if (first) {
            first = false; pending = response;
            response.writeHead(206, { ETag: '"native-blocks"', 'Content-Range': 'bytes 64-127/128', 'Content-Length': 64, 'Content-Type': 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' }); response.write(next.subarray(64, 71));
        } else {
            assert.equal(request.headers.range, 'bytes=71-127'); assert.equal(request.headers['if-range'], '"native-blocks"');
            response.writeHead(206, { ETag: '"native-blocks"', 'Content-Range': 'bytes 71-127/128', 'Content-Length': 57 }); response.end(next.subarray(71));
        }
    });
    for (;;) {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try { await (await fetch(`http://127.0.0.1:${server.address().port}/probe`)).arrayBuffer(); break; }
        catch (error) { await new Promise(resolve => server.close(resolve)); if (error.cause?.message !== 'bad port') throw error; }
    }
    const directory = join(app.getPath('userData'), `native-blocks-${platform}-${arch}-${format}`), folder = join(directory, 'ota/base-1.0.0'); await mkdir(folder, { recursive: true });
    await writeFile(join(folder, old.entry.file), base); await writeFile(join(folder, 'canvas-latest.json'), old.text); await writeFile(join(folder, 'canvas-latest.json.sig'), old.signature);
    const origin = `http://127.0.0.1:${server.address().port}`;
    const options = { currentVersion: '1.0.0', directory, publicKey, target: async () => ({ platform, arch, format }), fetcher: (url, init) => net.fetch(origin + new URL(url).pathname, init),
        install: async plan => { assert.deepEqual(await readFile(plan.file), next); installs++; }, changed: state => { if (state.downloaded === 7 && pending) { pending.destroy(); pending = null; } } };
    const updater = createUpdater(options), restarted = createUpdater(options);
    try {
        await updater.check(); assert.equal(updater.state().status, 'error'); updater.close();
        await restarted.check(); assert.equal(restarted.state().status, 'ready'); assert.equal(restarted.state().mode, 'delta');
        await restarted.apply(); assert.equal(installs, 1); assert.deepEqual(ranges, ['bytes=64-127', 'bytes=71-127']);
        console.log('NATIVE_BLOCK_OTA_OK: actual Electron socket interruption, copied blocks, range resume and signed full-file validation');
    } finally { updater.close(); restarted.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1000, height: 720, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    win.webContents.on('console-message', details => { if (details.level >= 2) console.error(details.message); });
    const js = async code => { try { return await win.webContents.executeJavaScript(code); } catch(error) { throw new Error(code + ': ' + error.message); } };
    const wait = async condition => { const end = Date.now() + 20000; while (!await js(condition)) { if (Date.now() > end) throw Error('Timed out: ' + condition); await new Promise(resolve => setTimeout(resolve, 25)); } };
    try {
        await nativeReleaseRedirect();
        await nativeResume();
        for(const platform of ['win32','darwin','linux'])for(const arch of ['x64','arm64'])for(const format of {win32:['nsis'],darwin:['zip'],linux:['AppImage','deb','rpm']}[platform])await nativeBlockResume(platform,arch,format);
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
        await js('updateTest.agentBusy(false);updateTest.pauseSave();Array.from(document.querySelectorAll("section button")).find(x=>x.textContent === "更新并重启").click()');
        await wait('document.querySelector("section > button").disabled && document.querySelector("section > button").textContent.includes("正在保存画布")');
        await js('document.querySelector("section > button").click()');assert.ok(!(await js('updateTest.state().operations')).includes('install'),'saving must complete before installation');
        await js('updateTest.resumeSave()');
        await wait('updateTest.state().operations.includes("install")');
        assert.equal((await js('updateTest.state().operations')).filter(op=>op==='install').length,1,'duplicate clicks share one installation');
        assert.equal(await js('updateTest.saved()'), 'OTA 未落盘画布');
        await js('updateTest.status("downloading")');
        await wait('document.querySelector("[role=progressbar]")');
        assert.equal(await js('document.querySelector("[role=progressbar]").getAttribute("aria-valuenow")'), '36');
        for (const [status, phase, title] of [['downloading', 'planning', '分析增量'], ['downloading', 'reconstructing', '合成更新包'], ['downloading', 'verifying', '校验更新包'], ['installing', 'saving', '保存剪辑'], ['installing', 'preparing', '准备安装'], ['installing', 'handoff', '转入安装窗口']]) {
            await js(`updateTest.status('${status}', true, '${phase}')`);
            await wait(`document.querySelector('section').textContent.includes('${title}')`);
            assert.equal(await js('document.querySelector("[role=progressbar]").getAttribute("aria-valuenow")'), null, 'unmeasurable work must never show a fake percentage');
            assert.equal(await js('document.querySelectorAll("ol[aria-label=更新步骤] li").length'), 4);
        }
        await js('updateTest.status("installing", true, "verifying")');
        await wait('document.querySelector("[role=progressbar]").getAttribute("aria-valuenow") === "100"');
        await js('updateTest.status("ready")');
        await wait('document.body.textContent.includes("新版本 v0.20.21")');
        const before = await js('document.querySelector("section").getBoundingClientRect().toJSON()');
        assert.ok(before.width <= 281 && before.height < 300, 'compact update panel');
        if (process.env.CANVAS_UPDATE_SCREENSHOT) {
            win.showInactive(); win.webContents.invalidate();
            await js('new Promise(resolve => requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
            writeFileSync(process.env.CANVAS_UPDATE_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
            await js('updateTest.theme(true)');
            win.setSize(400, 680);
            await js('new Promise(resolve => requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
            const narrow = await js('document.querySelector("section").getBoundingClientRect().toJSON()');
            assert.ok(narrow.left >= 0 && narrow.right <= 400);
            win.webContents.invalidate();
            writeFileSync(process.env.CANVAS_UPDATE_SCREENSHOT.replace('.png', '-dark.png'), (await win.webContents.capturePage()).toPNG());
        }
        await js('updateTest.canvas()');
        await wait('document.querySelector("[data-canvas-top-bar] [data-canvas-update] button")');
        await wait('!document.querySelector(".ant-message-notice")');
        const trigger = '[data-canvas-update] button[aria-label="软件更新"]';
        for (const [width, dark] of [[1280, false], [860, true]]) {
            win.setSize(width, 720);
            await js(`updateTest.theme(${dark});updateTest.status('ready')`);
            await js(`document.querySelector('${trigger}').click()`);
            await wait(`document.querySelector('${trigger}').getAttribute('aria-expanded') === 'true' && document.querySelector('section[aria-label="软件更新"]')`);
            await wait(`(() => { const panel = document.querySelector('.ant-popover'); return panel && getComputedStyle(panel).opacity === '1' && panel.getAnimations({subtree:true}).every(animation => animation.playState !== 'running'); })()`);
            await js('new Promise(resolve => requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
            const bounds = await js(`(() => { const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON(); return { top:rect('[data-canvas-top-bar]'), trigger:rect('${trigger}'), panel:rect('section[aria-label="软件更新"]'), width:innerWidth, count:document.querySelectorAll('button[aria-label="软件更新"]').length }; })()`);
            assert.equal(bounds.count, 1, 'canvas has one update entry and no duplicate bottom overlay');
            assert.ok(bounds.trigger.top >= bounds.top.top && bounds.trigger.bottom <= bounds.top.bottom, 'update belongs to top toolbar');
            assert.ok(bounds.panel.top >= bounds.trigger.bottom && bounds.panel.left >= 0 && bounds.panel.right <= bounds.width, 'panel opens below toolbar and stays in viewport');
            const items = await js(`Array.from(document.querySelector('[data-canvas-top-bar]').firstElementChild.children, item => item.getBoundingClientRect().toJSON())`);
            for (let index = 1; index < items.length; index++) assert.ok(items[index - 1].right <= items[index].left, 'project title and status do not overlap');
            assert.ok(items.at(-1).right <= bounds.trigger.left, 'project title yields space to update controls');
            assert.equal(await js(`getComputedStyle(document.querySelector('[data-canvas-top-bar]').firstElementChild.children[2].querySelector('span')).overflow`), 'hidden', 'long title is visually clipped');
            assert.ok((await contrast()).ratio >= 4.5);
            if (process.env.CANVAS_UPDATE_SCREENSHOT) {
                win.showInactive(); win.webContents.invalidate();
                await js('new Promise(resolve => requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
                writeFileSync(process.env.CANVAS_UPDATE_SCREENSHOT.replace('.png', `-canvas-${dark ? 'dark' : 'light'}.png`), (await win.webContents.capturePage()).toPNG());
            }
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
            win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
            await wait(`document.querySelector('${trigger}').getAttribute('aria-expanded') === 'false'`);
            assert.equal(await js(`document.activeElement === document.querySelector('${trigger}')`), true);
            await js(`document.querySelector('${trigger}').click()`);
            await wait(`document.querySelector('${trigger}').getAttribute('aria-expanded') === 'true'`);
            const outside = await js('document.querySelector("[data-update-outside]").getBoundingClientRect().toJSON()');
            const point = { x: Math.round(outside.left + 5), y: Math.round(outside.top + 5), button: 'left', clickCount: 1 };
            win.webContents.sendInputEvent({ type: 'mouseDown', ...point }); win.webContents.sendInputEvent({ type: 'mouseUp', ...point });
            await wait(`document.querySelector('${trigger}').getAttribute('aria-expanded') === 'false'`);
        }
        console.log('OTA_UI_OK: version prompt, background progress, busy guard, save before install, compact top toolbar panel, viewport bounds, Escape and outside dismissal'); app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});
