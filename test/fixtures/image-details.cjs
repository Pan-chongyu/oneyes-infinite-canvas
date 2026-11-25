const { app, BrowserWindow, protocol, net, clipboard, ClipboardItem, ipcMain, nativeImage } = require('electron');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { readFile, writeFile, mkdir } = require('node:fs/promises');
const { route } = require('../../desktop/protocol.cjs');
const { configurePermissions } = require('../../desktop/permissions.cjs');
const { readClipboard, writeClipboardImage } = require('../../desktop/clipboard.cjs');
const root = process.env.CANVAS_IMAGE_DETAILS_TEST_ROOT;
app.setPath('userData', join(root, 'profile'));
protocol.registerSchemesAsPrivileged([{ scheme: 'oneyes-canvas', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
app.whenReady().then(async () => {
    let downloads = 0;
    const oldClipboard = [];
    for (const item of await clipboard.read()) {
        if (!item.types.length) continue;
        const formats = {};
        for (const type of item.types) formats[type] = await item.getType(type);
        oldClipboard.push(new ClipboardItem(formats));
    }
    protocol.handle('oneyes-canvas', request => net.fetch(route(request.url, root).file));
    const win = new BrowserWindow({ width: 1280, height: 900, show: false, webPreferences: { preload: join(__dirname, '../../desktop/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    ipcMain.handle('clipboard:writeImage', (event, bytes) => { assert.equal(event.sender, win.webContents); assert.equal(event.senderFrame, win.webContents.mainFrame); return writeClipboardImage(clipboard, bytes); });
    configurePermissions(win.webContents.session);
    const js = async code => {
        try { return await win.webContents.executeJavaScript(code); }
        catch (error) { throw new Error('Image details renderer failed: ' + code, { cause: error }); }
    };
    const wait = async code => { const end = Date.now() + 15000; while (!(typeof code === 'function' ? await code() : await js(code))) { if (Date.now() > end) throw Error('Image details wait failed: ' + code); await new Promise(resolve => setTimeout(resolve, 25)); } };
    const resize = async (width, height) => {
        const size = win.getSize();
        if (size[0] !== width || size[1] !== height) await new Promise(resolve => { win.once('resize', resolve); win.setSize(width, height); });
        await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        win.focus(); await wait('document.hasFocus()');
    };
    const click = async (selector, clickCount = 1) => {
        await wait('!document.querySelector(".ant-modal") || document.querySelector(".ant-modal").getAnimations({subtree:true}).every(animation=>animation.playState!=="running")');
        await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const point = await js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
        win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
        await wait(`(() => { const group = document.querySelector(${JSON.stringify(selector)}).closest('[data-image-actions]'); return !group || getComputedStyle(group).pointerEvents !== 'none'; })()`);
        await wait(`(() => { const target = document.querySelector(${JSON.stringify(selector)}), hit = document.elementFromPoint(${point.x}, ${point.y}); return target === hit || target.contains(hit); })()`);
        win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount, ...point }); win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount, ...point });
    };
    const downloaded = new Promise((resolve, reject) => win.webContents.session.on('will-download', (_event, item) => {
        downloads++; assert.match(item.getFilename(), /\.jpg$/); const path = join(root, item.getFilename()); item.setSavePath(path);
        item.once('done', async (_event, state) => { try { assert.equal(state, 'completed'); resolve(await readFile(path)); } catch (error) { reject(error); } });
    }));
    try {
        await win.loadURL(process.argv[2]); await wait('Boolean(window.imageDetailsTest)'); const before = await js('imageDetailsTest.node()');
        win.show(); if (process.platform === 'darwin') app.focus({ steal: true }); win.focus(); await wait('document.hasFocus()');
        const copyButton = id => `[data-image-actions="${id}"] button[aria-label="复制图片到剪贴板"]`;
        const copyAndPaste = async (id, width, height, alpha) => {
            await clipboard.writeText('before image copy'); await js('imageDetailsTest.clearPaste()');
            const drags = await js('imageDetailsTest.drags()');
            await click(copyButton(id));
            await wait(async () => Boolean((await readClipboard(clipboard)).image?.length));
            await wait(`!document.querySelector(${JSON.stringify(copyButton(id))}).disabled`);
            const copied = await readClipboard(clipboard);
            assert.ok(copied.image?.length, 'clipboard contains an image, not its URL or filename');
            assert.deepEqual(nativeImage.createFromBuffer(Buffer.from(copied.image)).getSize(), { width, height });
            assert.equal(await js('imageDetailsTest.drags()'), drags, 'copy must not start a node drag');
            await click('#paste-image-target');
            // Injected key events do not invoke Cocoa's edit-menu accelerators.
            if (process.platform === 'darwin') win.webContents.paste();
            else {
                const modifiers = ['control'];
                win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'V', modifiers }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'V', modifiers });
            }
            await wait('Boolean(imageDetailsTest.pasted())');
            assert.deepEqual(await js('imageDetailsTest.pasted()'), { width, height, alpha });
        };
        for (const dark of [false, true]) {
            await js(`imageDetailsTest.theme(${dark})`);
            const layout = await js(`(() => { const buttons = document.querySelector('[data-image-actions="first"]').children; return { download: buttons[0].getBoundingClientRect().right, copy: buttons[1].getBoundingClientRect().left }; })()`);
            assert.ok(layout.copy >= layout.download && layout.copy - layout.download <= 8, 'copy sits next to download');
            await copyAndPaste('first', 4096, 2048, 255);
            await js('imageDetailsTest.expanded(true)');
            await wait('document.querySelector("[data-image-actions=second]")?.parentElement.getAnimations({subtree:true}).every(animation=>animation.playState!=="running")');
            await copyAndPaste('second', 240, 480, 0);
            await js('imageDetailsTest.expanded(false)');
        }
        const checkActionLayout = async (id, labelsVisible) => {
            const layout = await js(`(() => {
                const group = document.querySelector('[data-image-actions="${id}"]');
                const isPrimary = ${id === 'first'};
                const card = isPrimary ? group.closest('[data-node-id]') : group.parentElement;
                const buttons = [...group.querySelectorAll('button')];
                if (isPrimary) buttons.push(card.querySelector('[aria-expanded]'));
                return {
                    card: card.getBoundingClientRect().toJSON(),
                    buttons: buttons.map(button => ({
                        bounds: button.getBoundingClientRect().toJSON(),
                        label: button.getAttribute('aria-label'),
                        title: button.title,
                        lines: [...button.querySelectorAll('span')].flatMap(span => [...span.getClientRects()]).length,
                        iconWidth: button.querySelector('svg').getBoundingClientRect().width,
                    })),
                };
            })()`);
            assert.equal(layout.buttons.length, id === 'first' ? 3 : 4);
            for (const [index, button] of layout.buttons.entries()) {
                const { bounds, iconWidth } = button;
                assert.ok(button.label && button.title, 'every icon-only action keeps its name and hover hint');
                assert.ok(bounds.left >= layout.card.left && bounds.right <= layout.card.right + 1, 'actions stay within the node width');
                assert.ok(bounds.top >= layout.card.top && bounds.bottom <= layout.card.bottom + 1, 'actions stay within the node height');
                assert.ok(iconWidth >= 10, 'action icons keep their size');
                const expectedLines = id === 'first' && index === 2 ? 1 : labelsVisible ? 1 : 0;
                assert.equal(button.lines, expectedLines, 'labels fit one line or give way to icons');
                for (const other of layout.buttons.slice(index + 1)) {
                    assert.ok(bounds.right <= other.bounds.left + 1 || bounds.bottom <= other.bounds.top + 1, 'actions never overlap');
                }
            }
        };
        for (const locale of ['zh-CN', 'en-US']) {
            await js(`imageDetailsTest.locale('${locale}')`);
            await wait(`document.querySelector('[data-image-actions="first"] button').title === '${locale === 'zh-CN' ? '下载' : 'Download'}'`);
            await checkActionLayout('first', true);
            await js('imageDetailsTest.size(110, 1.75)');
            await checkActionLayout('first', false);
            await js('imageDetailsTest.size(400, 1)');
        }
        await js('imageDetailsTest.locale("zh-CN")');
        await js('imageDetailsTest.size(110, 1.75)');
        const dragsBeforeActions = await js('imageDetailsTest.drags()');
        await click('[data-image-actions="first"] button[aria-label="下载"]');
        await wait('imageDetailsTest.downloadedImageId() === "first"');
        await copyAndPaste('first', 4096, 2048, 255);
        await click('[data-node-id="detail-fixture"] button[aria-expanded=false]');
        await wait('document.querySelector("[data-image-actions=second]")?.parentElement.getAnimations().every(animation=>animation.playState!=="running")');
        await checkActionLayout('second', false);
        await click('[data-image-actions="second"] button[aria-label="下载"]');
        await wait('imageDetailsTest.downloadedImageId() === "second"');
        assert.equal(await js('imageDetailsTest.drags()'), dragsBeforeActions);
        await click('[data-node-id="detail-fixture"] button[aria-expanded=true]');
        await wait('document.querySelector(\'[data-node-id="detail-fixture"] button[aria-expanded=false]\') && !document.querySelector("[data-image-actions=second]")');
        await js('imageDetailsTest.size(400, 1)');
        console.log('IMAGE_NODE_ACTION_LAYOUT_OK: narrow zoomed and expanded nodes, single-line Chinese and English labels, intact icons, native download and copy clicks');
        await js('imageDetailsTest.plain()'); await copyAndPaste('primary', 4096, 2048, 255);
        await js('imageDetailsTest.missingCopy()'); await clipboard.writeText('preserve clipboard on failure');
        await click(copyButton('primary')); await wait('document.querySelector(".ant-message")?.textContent.includes("复制图片失败")');
        assert.equal(await clipboard.readText(), 'preserve clipboard on failure');
        await assert.rejects(writeClipboardImage(clipboard, new Uint8Array([1, 2, 3])));
        await assert.rejects(writeClipboardImage(clipboard, 'file:///private-image.png'));
        assert.equal(await clipboard.readText(), 'preserve clipboard on failure');
        await js('imageDetailsTest.restore()');
        await wait('!document.querySelector("[aria-label=图片详情内容]")');
        console.log('IMAGE_NODE_COPY_OK: download adjacency, native clipboard, actual system paste, original JPEG pixels, PNG alpha, primary/batch/single, themes, no drag, missing/corrupt image preserves clipboard');
        await click('[data-node-id="detail-fixture"] > .relative', 2);
        await wait('document.querySelector("[aria-label=图片信息]")?.textContent.includes("4096 × 2048 px")');
        await js('imageDetailsTest.remove()'); await wait('!document.querySelector("[aria-label=图片详情内容]")');
        for (const dark of [false, true]) {
            await js(`imageDetailsTest.theme(${dark})`);
            for (const width of [1280, 640]) {
                await resize(width, 900); await click('#open-details');
                await wait('document.querySelector("[aria-label=图片信息]")?.textContent.includes("4096 × 2048 px")');
                await wait('!document.querySelector(".ant-modal-wrap .ant-modal")?.className.includes("zoom")');
                const layout = await js(`(()=>{const m=document.querySelector('.ant-modal'),s=document.querySelector('[aria-label="图片详情内容"]'),i=document.querySelector('[aria-label="图片信息"]'),r=m.getBoundingClientRect();return{left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:s.scrollWidth>s.clientWidth,info:i.textContent}})()`);
                assert.ok(layout.left >= 0 && layout.right <= layout.width && layout.bottom <= layout.height, JSON.stringify(layout)); assert.equal(layout.overflow, false);
                assert.ok(layout.info.includes('JPEG')); assert.ok(!layout.info.includes('provider::')); assert.ok(!layout.info.includes('1 × 1'));
                await click('button[title="原始大小（1）"]');
                await wait('document.querySelector("[aria-live=polite]").textContent==="100%"');
                await wait('Math.abs(document.querySelector("[aria-label^=图片预览] img").getBoundingClientRect().width-4096)<1');
                if (width === 640) {
                    await resize(620, 900);
                    await wait('Math.abs(document.querySelector("[aria-label^=图片预览] img").getBoundingClientRect().width-4096)<1');
                    await resize(640, 900);
                }
                assert.ok(Math.abs(await js('document.querySelector("[aria-label^=图片预览] img").getBoundingClientRect().width') - 4096) < 1);
                const pan = await js(`(()=>{const v=document.querySelector('[aria-label^=图片预览]'),r=v.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),left:v.scrollLeft,top:v.scrollTop}})()`);
                win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: pan.x, y: pan.y });
                win.webContents.sendInputEvent({ type: 'mouseMove', x: pan.x - 50, y: pan.y - 40 });
                win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: pan.x - 50, y: pan.y - 40 });
                await wait(`document.querySelector('[aria-label^=图片预览]').scrollLeft>${pan.left}`);
                await click('button[aria-label="适应窗口"]');
                if (width === 1280) {
                    await wait('document.querySelector("button[aria-label=缩小图片]").disabled');
                    const fitted = await js('document.querySelector("[aria-label^=图片预览] img").getBoundingClientRect().width');
                    win.webContents.sendInputEvent({ type: 'mouseWheel', deltaX: 0, deltaY: 120, x: pan.x, y: pan.y });
                    await wait(`document.querySelector('[aria-label^=图片预览] img').getBoundingClientRect().width>${fitted + 1}`);
                    await click('button[aria-label="适应窗口"]');
                }
                if (process.env.ONEYES_TEST_IMAGE_DETAIL_ARTIFACTS) {
                    await mkdir(process.env.ONEYES_TEST_IMAGE_DETAIL_ARTIFACTS, { recursive: true });
                    await writeFile(join(process.env.ONEYES_TEST_IMAGE_DETAIL_ARTIFACTS, `image-details-${dark ? 'dark' : 'light'}-${width}.png`), (await win.webContents.capturePage()).toPNG());
                }
                win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
                await wait('document.querySelector("[aria-label=图片信息]").textContent.includes("240 × 480 px")');
                assert.ok(await js('document.querySelector("[aria-label=下一张]").disabled'));
                await click('button[aria-label="上一张"]'); await wait('document.querySelector("[aria-label=图片信息]").textContent.includes("4096 × 2048 px")');
                await js('document.querySelector("[aria-label^=图片预览]").focus()');
                win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
                await wait('!document.querySelector("[aria-label=图片详情内容]")');
            }
        }
        await resize(1280, 900); await js('imageDetailsTest.open("second")'); await wait('document.querySelector("[aria-label=图片信息]").textContent.includes("240 × 480 px")');
        await click('button[aria-label="上一张"]'); await wait('document.querySelector("[aria-label=图片信息]").textContent.includes("4096 × 2048 px")');
        win.show(); win.focus(); await wait('document.hasFocus()');
        await wait('!document.querySelector(".ant-modal-wrap .ant-modal")?.className.includes("zoom")');
        await click('button[aria-label="复制提示词"]');
        await wait(async () => (await clipboard.readText()).replace(/\r\n/g, '\n') === '保留真实原图的细节与质感\n第二行提示词');
        await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='下载原图').click()`);
        assert.deepEqual(await downloaded, Buffer.from(await js('imageDetailsTest.bytes()'))); assert.equal(downloads, 1);
        assert.equal(await js('imageDetailsTest.node()'), before, 'viewing, switching and downloading never edit the node');
        await click('button[aria-pressed=true]'); await wait('!document.querySelector("[aria-label=图片信息]")');
        await click('button[aria-pressed=false]'); await wait('Boolean(document.querySelector("[aria-label=图片信息]"))');
        await resize(640, 600); await wait('document.querySelector(".ant-modal").getBoundingClientRect().bottom<=innerHeight');
        await js('imageDetailsTest.missing()'); await wait('document.querySelector("[role=alert]")?.textContent.includes("原图暂时无法读取")');
        await js('imageDetailsTest.recover()'); await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='重新读取').click()`); await wait('document.querySelector("[aria-label=图片信息]").textContent.includes("4096 × 2048 px")');
        console.log('IMAGE_DETAILS_OK: original offline pixels and bytes, natural dimensions, primary/batch navigation, 1:1, keyboard, themes, narrow layout, download and missing-file recovery');
    } catch (error) { console.error(error.stack); console.error('IMAGE_DETAIL_STATE', await js('JSON.stringify({focused:document.hasFocus(),active:document.activeElement?.outerHTML,zoom:document.querySelector("[aria-live=polite]")?.textContent,viewport:document.querySelector("[aria-label^=图片预览]")?.getBoundingClientRect().toJSON(),modal:document.querySelector(".ant-modal")?.getBoundingClientRect().toJSON()})')); if (process.env.ONEYES_TEST_IMAGE_DETAIL_ARTIFACTS) await writeFile(join(process.env.ONEYES_TEST_IMAGE_DETAIL_ARTIFACTS, 'image-details-failure.png'), (await win.webContents.capturePage()).toPNG()); process.exitCode = 1; }
    finally { if (oldClipboard.length) await clipboard.write(oldClipboard); else clipboard.clear(); win.destroy(); app.exit(process.exitCode || 0); }
}).catch(error => { console.error(error.stack); app.exit(1); });
