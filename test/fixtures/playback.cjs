const { app, BrowserWindow, protocol, net } = require('electron');
const assert = require('node:assert/strict');
const { join, resolve } = require('node:path');
const { promisify } = require('node:util');
const { configurePermissions } = require('../../desktop/permissions.cjs');
const { windowChromeOptions } = require('../../desktop/window-chrome.cjs');
const { route } = require('../../desktop/protocol.cjs');
const root = process.env.CANVAS_PLAYBACK_TEST_ROOT;
app.setPath('userData', join(root, 'profile'));
protocol.registerSchemesAsPrivileged([{ scheme: 'oneyes-canvas', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
app.whenReady().then(async () => {
    await promisify(require('node:child_process').execFile)(resolve('desktop/media-bin/ffmpeg' + (process.platform === 'win32' ? '.exe' : '')), ['-nostdin', '-y', '-f', 'lavfi', '-i', 'color=blue:s=320x180:r=12:d=8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(root, 'sample.mp4')], { windowsHide: true });
    protocol.handle('oneyes-canvas', request => net.fetch(route(request.url, root).file));
    const win = new BrowserWindow({ width: 1100, height: 760, show: false, ...windowChromeOptions(), webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    const js = code => win.webContents.executeJavaScript(code);
    const wait = async code => { const end = Date.now() + 15000; while (!await js(code)) { if (Date.now() > end) throw Error('Video playback wait failed: ' + code); await new Promise(resolve => setTimeout(resolve, 25)); } };
    const click = point => {
        win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
        win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
        win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    };
    const drag = (point, dx, dy) => {
        win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
        win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
        win.webContents.sendInputEvent({ type: 'mouseMove', x: point.x + dx, y: point.y + dy });
        win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: point.x + dx, y: point.y + dy });
    };
    // Inspect Chromium's actual controls rather than clicking a replacement button.
    win.webContents.debugger.attach('1.3');
    const controlPoint = async pseudo => {
        const { root } = await win.webContents.debugger.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
        const find = node => {
            const attrs = node.attributes || [];
            if (attrs.some((value, index) => index % 2 === 0 && value === 'pseudo' && attrs[index + 1] === pseudo)) return node;
            for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) { const found = find(child); if (found) return found; }
        };
        const node = find(root); assert.ok(node, 'Native media control exists: ' + pseudo);
        const { model } = await win.webContents.debugger.sendCommand('DOM.getBoxModel', { nodeId: node.nodeId });
        return { x: Math.round((model.content[0] + model.content[4]) / 2), y: Math.round((model.content[1] + model.content[5]) / 2) };
    };
    try {
        configurePermissions(win.webContents.session);
        await win.loadURL('oneyes-canvas://app/');
        win.show(); win.focus();
        await wait('!!window.playbackTest && document.querySelector("video").readyState >= 2');
        for (const [scale, dark] of [[1, false], [0.7, true]]) {
            await js(`playbackTest.configure(${scale},${dark})`);
            await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
            const middle = await js('(()=>{const r=document.querySelector("video").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()');
            win.webContents.sendInputEvent({ type: 'mouseMove', ...middle });
            click(await controlPoint('-webkit-media-controls-play-button'));
            await wait('!document.querySelector("video").paused');
            click(await controlPoint('-webkit-media-controls-fullscreen-button'));
            await wait('document.fullscreenElement === document.querySelector("video")');
            assert.equal(win.webContents.isDestroyed(), false);
            const rect = await js('(()=>{const r=document.querySelector("video").getBoundingClientRect();return {width:r.width,height:r.height,screenWidth:innerWidth,screenHeight:innerHeight}})()');
            assert.ok(Math.abs(rect.width - rect.screenWidth) <= 1 && Math.abs(rect.height - rect.screenHeight) <= 1, 'video fills the fullscreen viewport');
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
            await wait('!document.fullscreenElement');
            // Native window fullscreen transitions are asynchronous on macOS.
            await wait('document.querySelector("video").getBoundingClientRect().width < innerWidth');
            win.webContents.sendInputEvent({ type: 'mouseMove', ...middle });
            click(await controlPoint('-webkit-media-controls-play-button'));
            await wait('document.querySelector("video").paused');
            const events = await js('playbackTest.events()');
            assert.equal(events.drag, 0); assert.equal(events.resize, 0); assert.equal(events.background, 0); assert.equal(events.viewport, 0);
            // Video content outside the native controls remains a node drag target.
            drag(middle, 32, 12);
            await new Promise(resolve => setTimeout(resolve, 100));
            assert.equal((await js('playbackTest.events()')).drag, 1, 'video content outside the controls still starts node dragging');
        }
        console.log('VIDEO_PLAYBACK_NATIVE_OK: native play/fullscreen, Escape, scaled canvas, light/dark, no control drag, video drag preserved');
    } finally { win.webContents.debugger.detach(); win.destroy(); }
}).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); });
