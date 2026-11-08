const { app, BrowserWindow, protocol, net, ipcMain } = require('electron');
const { join, resolve } = require('node:path');
const fs = require('node:fs/promises');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
const { createCollaboration } = require('../../desktop/collaboration.cjs');
const { route } = require('../../desktop/protocol.cjs');
const trace = value => require('node:fs').appendFileSync(join(process.env.CANVAS_COLLABORATION_TEST_ROOT, 'trace.log'), value + '\n');
trace('entry'); process.on('exit', code => trace('exit ' + code)); app.on('will-quit', () => trace('will-quit'));
app.setPath('userData', join(process.env.CANVAS_COLLABORATION_TEST_ROOT, 'profile'));
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([{ scheme: 'oneyes-canvas', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
app.whenReady().then(async () => {
    trace('ready');
    const directory = await fs.mkdtemp(join(tmpdir(), 'canvas-collab-ui-'));
    const services = new Map(), windows = [];
    const js = (win, code) => win.webContents.executeJavaScript(code);
    const wait = async (win, code) => { const until = Date.now() + 15000; while (!await js(win, code)) { if (Date.now() > until) throw Error('协作界面等待失败: ' + code + ' ' + await js(win, 'JSON.stringify({room:collabTest.room(),state:collabTest.state()})')); await new Promise(resolve => setTimeout(resolve, 25)); } };
    ipcMain.handle('collaboration:call', (event, op, args) => services.get(event.sender.id).call(op, args));
    const make = async () => {
        trace('make-window');
        const win = new BrowserWindow({ width: 1000, height: 720, show: false, webPreferences: { preload: resolve('desktop/preload.cjs'), partition: 'collaboration-' + windows.length, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
        windows.push(win);
        win.webContents.on('console-message', event => { if (event.level === 'error') trace('renderer ' + event.message); });
        win.webContents.on('render-process-gone', (_event, details) => trace('renderer-gone ' + JSON.stringify(details)));
        const service = createCollaboration({ directory, address: '127.0.0.1', changed: value => { if (!win.isDestroyed()) win.webContents.send('collaboration:event', value); } });
        services.set(win.webContents.id, service);
        win.webContents.session.protocol.handle('oneyes-canvas', async request => request.url.startsWith('oneyes-canvas://app/collaboration/') ? service.request(request) : net.fetch(route(request.url, process.env.CANVAS_COLLABORATION_TEST_ROOT).file));
        await win.loadURL('oneyes-canvas://app/'); trace('loaded'); await wait(win, '!!window.collabTest'); trace('test-ready'); return win;
    };
    try {
        const a = await make(), b = await make();
        if (process.env.CANVAS_COLLABORATION_SCREENSHOT) {
            a.showInactive();
            await js(a, 'document.querySelector("button").click()'); await wait(a, '!!document.querySelector(".ant-modal")');
            for (const dark of [false, true]) {
                await js(a, `collabTest.theme(${dark});new Promise(resolve=>setTimeout(resolve,300))`);
                await fs.writeFile(process.env.CANVAS_COLLABORATION_SCREENSHOT.replace('.png', dark ? '-dark.png' : '-light.png'), (await a.webContents.capturePage()).toPNG());
            }
            await js(a, 'document.querySelector(".ant-modal-close").click()');
        }
        await js(a, 'collabTest.host()'); await wait(a, '!!collabTest.room().invite');
        const invite = await js(a, 'collabTest.room().invite');
        await js(b, `collabTest.join(${JSON.stringify(invite)})`);
        await wait(b, 'collabTest.room().status === "online" && collabTest.state().nodes.some(n=>n.id==="text")');
        assert.equal(await js(b, 'collabTest.originalProjects().length'), 2, 'joining preserves the original canvas');
        await Promise.all([js(a, 'collabTest.modify("text",{position:{x:250,y:180}})'), js(b, 'collabTest.modify("text",{title:"协作者标题"})')]);
        await wait(a, 'collabTest.state().nodes[0].title === "协作者标题"');
        await wait(b, 'collabTest.state().nodes[0].position.x===250');
        await js(a, 'collabTest.undo()');
        await wait(b, 'collabTest.state().nodes[0].position.x===100');
        assert.equal(await js(a, 'collabTest.state().nodes[0].title'), '协作者标题');
        await js(a, 'collabTest.redo();collabTest.add();collabTest.connect()');
        await wait(b, 'collabTest.state().connections.length === 1 && collabTest.state().nodes.length === 2');
        // Leave the pointer held: peers must see intermediate geometry, not only the final mouseup.
        const bounds=await js(a,'(()=>{const r=document.querySelector("[data-node-id=text] > .border-2").getBoundingClientRect();return {x:Math.round(r.x+40),y:Math.round(r.y+40)}})()');
        a.webContents.sendInputEvent({type:'mouseMove',...bounds});a.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...bounds});
        for(const dx of [20,60]){a.webContents.sendInputEvent({type:'mouseMove',x:bounds.x+dx,y:bounds.y+10});await wait(b,`collabTest.state().nodes.find(n=>n.id==="text").position.x===${250+dx}`);}
        a.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:bounds.x+60,y:bounds.y+10});await wait(a,'collabTest.interaction()===null');await js(a,'collabTest.undo()');await wait(b,'collabTest.state().nodes.find(n=>n.id==="text").position.x===250');await js(a,'collabTest.redo()');await wait(b,'collabTest.state().nodes.find(n=>n.id==="text").position.x===310');
        const resize=await js(a,'(()=>{const r=document.querySelector("[data-node-id=text] > .border-2").getBoundingClientRect();return {x:Math.round(r.right),y:Math.round(r.bottom)}})()');
        a.webContents.sendInputEvent({type:'mouseMove',...resize});a.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...resize});a.webContents.sendInputEvent({type:'mouseMove',x:resize.x+50,y:resize.y+30});
        await wait(b,'collabTest.state().nodes.find(n=>n.id==="text").width===350 && collabTest.state().nodes.find(n=>n.id==="text").height===200');
        a.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:resize.x+50,y:resize.y+30});
        await js(a,'document.querySelector("[data-node-id=text] > .border-2").dispatchEvent(new MouseEvent("dblclick",{bubbles:true}))');await wait(a,'!!document.querySelector("[data-node-id=text] textarea")');
        await js(a,'(()=>{const field=document.querySelector("[data-node-id=text] textarea");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(field,"实时协作，尚未结束输入🎬");field.dispatchEvent(new Event("input",{bubbles:true}));})()');
        await wait(b,'collabTest.state().nodes.find(n=>n.id==="text").metadata.content==="实时协作，尚未结束输入🎬"');assert.equal(await js(a,'!!document.querySelector("[data-node-id=text] textarea")'),true,'text is shared before the editor loses focus');
        await js(a,'document.querySelector("[data-node-id=text] textarea").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
        const handle=await js(a,'(()=>{const r=Array.from(document.querySelectorAll("[data-node-id=text] > .cursor-crosshair")).at(-1).getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()');
        a.webContents.sendInputEvent({type:'mouseMove',...handle});a.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...handle});a.webContents.sendInputEvent({type:'mouseMove',x:800,y:400});
        await wait(b,'!!document.querySelector("[data-collaboration-connection] path")');assert.equal(await js(b,'collabTest.state().connections.length'),1,'unfinished connection is only a preview');
        a.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:800,y:400});await wait(b,'!document.querySelector("[data-collaboration-connection]")');
        await js(a,'collabTest.viewport({x:40,y:30,k:0.5});collabTest.selected(["text"]);collabTest.action("move")');await js(b,'collabTest.viewport({x:5,y:10,k:2})');
        await js(a,'(()=>{const canvas=document.querySelector("[data-canvas-surface]"),r=canvas.getBoundingClientRect();canvas.dispatchEvent(new PointerEvent("pointermove",{clientX:r.left+100,clientY:r.top+90,bubbles:true}));})()');
        await wait(b,'collabTest.room().peers.some(peer=>peer.cursor?.x===120&&peer.cursor?.y===120&&peer.action==="move") && !!document.querySelector("[data-collaboration-selection=text]")');
        assert.equal(await js(b,'document.querySelector("[data-collaboration-cursor]").style.transform'),'translate(120px, 120px) scale(0.5)','cursor maps to world coordinates and stays a constant screen size');
        if(process.env.CANVAS_COLLABORATION_SCREENSHOT){b.showInactive();await js(b,'collabTest.theme(true);collabTest.viewport({x:0,y:0,k:1});Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{}))).then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');await fs.writeFile(process.env.CANVAS_COLLABORATION_SCREENSHOT.replace('.png','-live.png'),(await b.webContents.capturePage()).toPNG());}
        await js(a,'window.dispatchEvent(new Event("blur"))');await wait(b,'collabTest.room().peers.every(peer=>!peer.cursor&&!peer.selected.length)');
        await js(a,'collabTest.action(null);collabTest.viewport({x:0,y:0,k:1})');await js(b,'collabTest.viewport({x:0,y:0,k:1})');
        await js(a, 'collabTest.media()');
        await wait(b, 'collabTest.state().nodes.find(n=>n.id==="image")?.metadata?.content?.startsWith("blob:") && !collabTest.room().syncing');
        assert.deepEqual(await js(b, 'collabTest.bytes()'), await js(a, 'collabTest.bytes()'));
        assert.equal(await js(b, 'document.querySelector("img").naturalWidth'), 17);
        await js(b, 'collabTest.save()');
        await js(a, 'collabTest.leave()');
        await wait(b, 'collabTest.room().status === "offline" && !collabTest.room().role');
        assert.equal(await js(b,'collabTest.room().peers.length'),0,'departed collaborators leave no stale cursor');
        assert.equal(await js(b, 'collabTest.state().nodes.length'), 3);
        assert.equal(await js(b, 'collabTest.state().nodes.find(n=>n.id==="image").metadata.imageTaskId'), undefined);
        await js(b, 'collabTest.save()'); await b.webContents.reload(); await wait(b, '!!window.collabTest && document.querySelector("img")?.naturalWidth === 17');
        assert.equal(await js(b, 'collabTest.state().nodes.length'), 3, 'a reopened local replica keeps its nodes and original image');
        const replica = await js(b, 'collabTest.state().id');
        const original = await js(b, 'collabTest.originalProjects().find(p=>p.id!==collabTest.state().id).id');
        await js(b, 'collabTest.host()');
        await js(b, `collabTest.open(${JSON.stringify(original)})`);
        await wait(b, 'collabTest.room().status === "offline" && collabTest.state().nodes.length === 1');
        assert.equal(await js(b, 'collabTest.state().nodes[0].title'), '共创文字', 'opening the original canvas does not import the collaboration snapshot');
        assert.equal(await js(b, `collabTest.originalProjects().find(p=>p.id===${JSON.stringify(replica)}).nodes.length`), 3, 'leaving by navigation flushes only the shared project');
        await fs.writeFile(join(process.env.CANVAS_COLLABORATION_TEST_ROOT, 'collaboration-result.json'), JSON.stringify({ passed: true }));
        console.log('COLLABORATION_UI_OK: real held drag/resize and typing, scaled presence/selection and cleanup, field/text merge, local undo, native originals, copy retained');
    } finally { await Promise.allSettled([...services.values()].map(service => service.close())); windows.forEach(win => win.destroy()); await fs.rm(directory, { recursive: true, force: true }); }
}).then(() => app.exit(0)).catch(error => { trace('error ' + error.stack); console.error(error); app.exit(1); });
