const {app,BrowserWindow,protocol,net,ipcMain,dialog,nativeTheme}=require('electron');
const assert=require('node:assert/strict');
const {mkdtemp,readFile,writeFile,rm}=require('node:fs/promises');
const {join,resolve}=require('node:path');
const {tmpdir}=require('node:os');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {route}=require('../../desktop/protocol.cjs');
const {createEditorWindows}=require('../../desktop/editor-windows.cjs');
const {windowChromeOptions}=require('../../desktop/window-chrome.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'oneyes-canvas',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('enable-unsafe-webgpu');
if(process.platform==='linux')for(const [name,value] of [['ignore-gpu-blocklist',''],['use-gl','angle'],['enable-features','Vulkan'],['use-angle','vulkan'],['use-vulkan','swiftshader'],['use-webgpu-adapter','swiftshader'],['disable-vulkan-surface','']])app.commandLine.appendSwitch(name,value);
app.setPath('userData',process.env.CANVAS_EDIT_TEST_PROFILE);
app.whenReady().then(async()=>{
 const directory=await mkdtemp(join(tmpdir(),'canvas-editor-ui-')),run=promisify(execFile);
 const ffmpeg=resolve('desktop/media-bin',process.platform==='win32'?'ffmpeg.exe':'ffmpeg');
 for(const color of ['red','blue'])await run(ffmpeg,['-nostdin','-y','-f','lavfi','-i',`color=${color}:s=192x128:r=12:d=2`,'-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-t','2',join(directory,color+'.mp4')]);
 protocol.handle('oneyes-canvas',request=>{const u=new URL(request.url);if(/^\/fixture-media\/(red|blue)$/.test(u.pathname))return readFile(join(directory,u.pathname.split('/').at(-1)+'.mp4')).then(b=>new Response(b,{headers:{'Content-Type':'video/mp4'}}));return net.fetch(route(request.url,process.env.CANVAS_EDIT_TEST_ROOT).file);});
 const main=new BrowserWindow({show:false,width:900,height:650,webPreferences:{preload:join(__dirname,'smart-edit-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
 const external=[];main.webContents.session.webRequest.onBeforeRequest((d,done)=>{const block=/^https?:/.test(d.url);if(block)external.push(d.url);done({cancel:block});});
 const editors=createEditorWindows({BrowserWindow,dialog,directory:resolve('desktop'),chrome:windowChromeOptions,theme:()=>{},report:(_c,_s,e)=>console.error('EDITOR_DIAGNOSTIC',e.message)});
 ipcMain.handle('editor:open',(event,key)=>{assert.equal(event.sender,main.webContents);assert.equal(event.senderFrame,main.webContents.mainFrame);return editors.open(key);});
 ipcMain.handle('editor:close',event=>{assert.ok(editors.trusted(event));return editors.close(event);});
 ipcMain.handle('editor:report',event=>{assert.ok(editors.trusted(event));});
 const js=(w,code)=>w.webContents.executeJavaScript(code).catch(e=>{throw Error(e.message+'\nCode: '+code);});
 const wait=async(w,code,budget=30000)=>{const until=Date.now()+budget;while(!await js(w,code)){if(Date.now()>until)throw Error('Timed out: '+code+'\n'+await js(w,'document.body.innerText'));await new Promise(r=>setTimeout(r,25));}};
 const click=async(w,selector)=>{await wait(w,`Boolean(document.querySelector(${JSON.stringify(selector)}))`);const p=await js(w,`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);w.webContents.sendInputEvent({type:'mouseMove',...p});w.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p});w.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p});};
 const textClick=async(w,text)=>{await js(w,`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);};
 let edit;
 try{
  await main.loadURL(process.argv[2]);await wait(main,'Boolean(window.editTest)');
  console.log('EDITOR_STAGE',process.env.CANVAS_EDIT_TEST_PHASE,'canvas ready');
  await textClick(main,'打开剪辑器');
  await wait(main,'Boolean(window.editTest.link())');
  const until=Date.now()+30000;while(!(edit=BrowserWindow.getAllWindows().find(w=>w!==main))){if(Date.now()>until)throw Error('editor window not opened');await new Promise(r=>setTimeout(r,25));}
  edit.webContents.on('console-message',d=>{if(d.level==='error')console.error('editor:',d.message);});
  await wait(edit,'document.body.dataset.editorReady=== "true"');
  console.log('EDITOR_STAGE','editor ready');
  assert.equal(await js(edit,'typeof window.oneYesDesktop'),'undefined','editor must not receive account/config/native app IPC');
  assert.equal(await js(edit,'oneYesEditing.store.getState().doc.width'),192);
  assert.equal(await js(edit,'oneYesEditing.store.getState().doc.height'),128);
  assert.equal(await js(edit,'oneYesEditing.store.getState().doc.assets.length'),2);
  assert.equal(await js(edit,'new Set(oneYesEditing.store.getState().doc.assets.map(a=>a.src)).size'),2,'same filenames must preserve separate original bytes');
  const calls=await js(main,'editTest.calls()');assert.equal(calls,0);
  if(process.env.CANVAS_EDIT_TEST_PHASE==='restore'){
   assert.equal(await js(edit,'oneYesEditing.store.getState().doc.tracks.flatMap(t=>t.clips).length'),1);
   assert.equal(await js(edit,'oneYesEditing.store.getState().doc.tracks.flatMap(t=>t.clips)[0].volume'),.5);
   console.log('EDITOR_RESTART_OK: real editor document, media, dimensions and history restored across processes; no model replay');
  }else{
   await click(edit,'.asset-insert');await wait(edit,'oneYesEditing.store.getState().doc.tracks.flatMap(t=>t.clips).length === 1');
   console.log('EDITOR_STAGE','clip inserted');
   await click(edit,'[aria-label="AI 助手"]');await wait(edit,'document.querySelectorAll("select[aria-label=剪辑模型] option").length===2');
   await js(edit,`(()=>{const el=document.querySelector('textarea[aria-label=剪辑要求]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'把首个片段原声音量设为一半');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
   await textClick(edit,'生成剪辑草稿');await wait(edit,'Boolean(document.querySelector(".oneyes-draft"))');
   console.log('EDITOR_STAGE','AI draft ready');
   assert.equal(await js(main,'editTest.calls()'),1);assert.equal(await js(main,'editTest.model()'),'second::fixture');
   assert.equal(await js(edit,'oneYesEditing.store.getState().doc.tracks[0].clips[0].volume'),1,'AI must not apply before approval');
   await textClick(edit,'应用到时间线');await wait(edit,'oneYesEditing.store.getState().doc.tracks[0].clips[0].volume===.5');
   await click(edit,'button[aria-label^="撤销"]');await wait(edit,'oneYesEditing.store.getState().doc.tracks[0].clips[0].volume===1');
   await click(edit,'button[aria-label^="重做"]');await wait(edit,'oneYesEditing.store.getState().doc.tracks[0].clips[0].volume===.5');
   await js(main,'editTest.mode("invalid")');await textClick(edit,'生成剪辑草稿');await wait(edit,'Boolean(document.querySelector(".oneyes-assistant [role=alert]"))');
   assert.equal(await js(edit,'oneYesEditing.store.getState().doc.tracks[0].clips[0].volume'),.5,'invalid AI plan must preserve manual timeline');
   assert.equal(await js(main,'editTest.calls()'),2,'failed plan is never retried automatically');await js(main,'editTest.mode("valid")');
   await js(edit,'oneYesEditorFlush()');
   const gpu=await js(edit,`(async()=>{let device,frame;try{const adapter=await navigator.gpu?.requestAdapter();if(!adapter)return {ok:false,reason:'没有 WebGPU 适配器'};device=await adapter.requestDevice();const canvas=new OffscreenCanvas(192,128),context=canvas.getContext('webgpu');context.configure({device,format:navigator.gpu.getPreferredCanvasFormat()});const encoder=device.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:1,g:0,b:0,a:1}}]});pass.end();device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();frame=new VideoFrame(canvas,{timestamp:0});const bytes=new Uint8Array(frame.allocationSize({format:'RGBA'}));await frame.copyTo(bytes,{format:'RGBA'});if(bytes[0]<240||bytes[1]>10||bytes[2]>10)throw Error('显卡画面读取失败');return {ok:true};}catch(e){return {ok:false,reason:e.message};}finally{frame?.close();device?.destroy();}})()`);
   if(!gpu.ok&&process.env.CI)console.log('EDITOR_GPU_DIAGNOSTIC',JSON.stringify({probe:gpu,features:app.getGPUFeatureStatus()}));
   assert.ok(gpu.ok||process.env.CI,'actual canvas rendering unavailable outside CI: '+gpu.reason);
   if(gpu.ok){
    console.log('EDITOR_STAGE','export start');
    await js(edit,`(()=>{window.exportTest={encoded:0,decoded:0,queue:0};const encode=VideoEncoder.prototype.encode;VideoEncoder.prototype.encode=function(...args){window.exportTest.encoded++;window.exportTest.queue=this.encodeQueueSize;window.exportTest.encoder=this;return encode.apply(this,args)};oneYesEditing.media.worker.addEventListener('message',e=>{if(e.data.type==='exportFrame'){window.exportTest.decoded++;window.exportTest.timestamp=e.data.frame?.timestamp}});})()`);
    await click(edit,'button[aria-label="导出"]');await textClick(edit,'导出 MP4');
    const monitor=setInterval(()=>{void js(edit,'JSON.stringify({...window.exportTest,encoder:window.exportTest?.encoder?.encodeQueueSize})').then(v=>console.log('EXPORT_PROGRESS',v));},5000);
    try{await wait(edit,'!document.querySelector(".export-dialog[open]") || Boolean(document.querySelector(".export-dialog .scene-error"))',30000);}finally{clearInterval(monitor);}
    assert.equal(await js(edit,'document.querySelector(".export-dialog .scene-error")?.textContent || ""'),'');
    await wait(main,'editTest.state().nodes.some(n=>n.id.startsWith("edit-"))');
    const blob=await js(main,'editTest.link().then(l=>l.output.blob.arrayBuffer()).then(b=>Array.from(new Uint8Array(b)))');
    const path=join(directory,'output.mp4');await writeFile(path,Buffer.from(blob));
    const ffprobe=resolve('desktop/media-bin',process.platform==='win32'?'ffprobe.exe':'ffprobe');const {stdout}=await run(ffprobe,['-v','quiet','-print_format','json','-show_streams',path]);const streams=JSON.parse(stdout).streams;
    assert.equal(streams.find(s=>s.codec_type==='video').width,192);assert.equal(streams.find(s=>s.codec_type==='video').height,128);assert.ok(streams.some(s=>s.codec_type==='audio'));
    await js(main,'editTest.flush()');console.log('EDITOR_EXPORT_OK: production WebGPU/WebCodecs workers, MP4 with original dimensions/audio, idempotent canvas output');
    await click(edit,'button[aria-label="导出"]');await textClick(edit,'导出 MP4');await wait(edit,'Boolean(document.querySelector(".export-progress"))');await textClick(edit,'取消导出');await wait(edit,'!document.querySelector(".export-progress")');
    assert.equal(await js(main,'editTest.state().nodes.filter(n=>n.id.startsWith("edit-")).length'),1,'cancelled export must not add a result');
    await click(edit,'button[aria-label="关闭导出成片"]');
   }else{
    console.log('EDITOR_GPU_UNAVAILABLE: actual canvas render/readback probe failed on CI; rendering not verified, editing/AI/persistence checked without resolution downgrade');
   }
   if(process.env.CANVAS_EDIT_TEST_SCREENSHOT){await js(edit,'oneYesEditing.store.seek(500000)');await new Promise(r=>setTimeout(r,300));await writeFile(process.env.CANVAS_EDIT_TEST_SCREENSHOT,(await edit.webContents.capturePage()).toPNG());}
   await js(edit,'document.documentElement.dataset.theme="light"');assert.equal(await js(edit,'getComputedStyle(document.documentElement).getPropertyValue("--bg").trim()'),'#f4f2ed');
   if(process.env.CANVAS_EDIT_TEST_SCREENSHOT)await writeFile(process.env.CANVAS_EDIT_TEST_SCREENSHOT.replace('.png','-light.png'),(await edit.webContents.capturePage()).toPNG());
   console.log('EDITOR_UI_OK: independent secured window, real upstream timeline, same-name media, configured model, AI review and undo/redo');
   const callsBeforeDisconnect=await js(main,'editTest.calls()');
   editors.disconnectHost();
   await textClick(edit,'生成剪辑草稿');await wait(edit,'document.querySelector(".oneyes-assistant [role=alert]")?.textContent.includes("原画布已关闭")');
   assert.equal(await js(main,'editTest.calls()'),callsBeforeDisconnect,'disconnected editor must reject future requests without calling models');
   await js(edit,`(()=>{window.editorReconnected=false;const c=new BroadcastChannel('oneyes-editor-link-v1');c.onmessage=e=>{if(e.data.operation==='inputs'){window.editorReconnected=true;c.close();}};})()`);
   await textClick(main,'打开剪辑器');await wait(edit,'window.editorReconnected===true');
   await textClick(edit,'生成剪辑草稿');await wait(edit,'Boolean(document.querySelector(".oneyes-draft"))');
   assert.equal(await js(main,'editTest.calls()'),callsBeforeDisconnect+1,'reopening the node reconnects the same editor');
  }
  await editors.flushAll();await js(main,'editTest.flush()');
  const key=await js(main,'editTest.link().then(l=>l.key)');await editors.open(key);assert.equal(BrowserWindow.getAllWindows().length,2,'repeated open reuses one window');
  await js(edit,'oneYesEditor.close()');while(!edit.isDestroyed())await new Promise(r=>setTimeout(r,25));
  assert.deepEqual(external,[],'editor must run offline, without upstream external accounts/proxies or AI requests');
  await writeFile(join(process.env.CANVAS_EDIT_TEST_PROFILE,process.env.CANVAS_EDIT_TEST_PHASE+'.passed'),'passed');
 }catch(error){console.error('EDITOR_TEST_FAILED',error);process.exitCode=1;if(edit&&!edit.isDestroyed()){console.error('EXPORT_DIAGNOSTIC',await js(edit,'JSON.stringify({...window.exportTest,encoder:window.exportTest?.encoder?.encodeQueueSize})'));if(process.env.CANVAS_EDIT_TEST_SCREENSHOT)await writeFile(process.env.CANVAS_EDIT_TEST_SCREENSHOT,(await edit.webContents.capturePage()).toPNG());}}
 finally{await rm(directory,{recursive:true,force:true});app.exit(process.exitCode||0);}
}).catch(e=>{console.error(e);process.exitCode=1;app.exit(1);});
