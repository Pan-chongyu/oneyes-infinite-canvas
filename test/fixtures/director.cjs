const { app, BrowserWindow, protocol, net } = require('electron');
const assert = require('node:assert/strict');
const { writeFile, readFile } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { route } = require('../../desktop/protocol.cjs');
const { unzipSync } = require('node:module').createRequire(require.resolve('../../web/package.json'))('fflate');
protocol.registerSchemesAsPrivileged([{ scheme: 'oneyes-canvas', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
if(process.env.CANVAS_DIRECTOR_TEST_PROFILE)app.setPath('userData',process.env.CANVAS_DIRECTOR_TEST_PROFILE);
app.whenReady().then(async()=>{
 protocol.handle('oneyes-canvas',request=>{const {file}=route(request.url,process.env.CANVAS_DIRECTOR_TEST_ROOT);assert.ok(file);return net.fetch(file);});
 const win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}}),js=code=>win.webContents.executeJavaScript(code).catch(error=>{throw new Error(error.message+' Fixture: '+code);});
 const screenshot=async(name)=>{if(!process.env.CANVAS_DIRECTOR_SCREENSHOT)return;win.showInactive();await js('Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{}))).then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');await new Promise(resolve=>setTimeout(resolve,500));await writeFile(join(tmpdir(),name),(await win.capturePage()).toPNG());win.hide();};
 const external=[];win.webContents.session.webRequest.onBeforeRequest((details,callback)=>{const blocked=/^https?:/.test(details.url);if(blocked)external.push(details.url);callback({cancel:blocked});});
 let exportedFile,downloads=0;
 win.webContents.session.on('will-download',(_event,item)=>{item.setSavePath(join(process.env.CANVAS_DIRECTOR_TEST_PROFILE,item.getFilename()));item.once('done',(_event,state)=>{exportedFile=state==='completed'?item.getSavePath():state;downloads++;});});
 const wait=async(code)=>{const until=Date.now()+20000;while(!await js(code)){if(Date.now()>until)throw Error('Timed out: '+code);await new Promise(resolve=>setTimeout(resolve,25));}};
 const click=async(text)=>{await js(`Array.from(document.querySelectorAll('button')).find(item=>item.textContent.trim()===${JSON.stringify(text)}||item.getAttribute('aria-label')===${JSON.stringify(text)}).click()`);};
 const settings=async(value)=>{const label={object:'物体',camera:'镜头',light:'环境'}[value];await js(`Array.from(document.querySelectorAll('aside[aria-label="导演台设置"] .ant-segmented-item')).find(item=>item.textContent.trim()===${JSON.stringify(label)}).click()`);await wait(`document.querySelector('aside[aria-label="导演台设置"] .ant-segmented-item-selected')?.textContent.trim()===${JSON.stringify(label)}`);};
 const pointerClick=async(selector,edge=false,button='left')=>{
  await js('Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{})))');
  const point=await js(`(()=>{const rect=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(rect.x+${edge==='end'?'rect.width-12':edge?'4':'rect.width/2'}),y:Math.round(rect.y+${edge==='end'?'rect.height-12':edge?'4':'rect.height/2'})};})()`);
  win.webContents.sendInputEvent({type:'mouseMove',...point});win.webContents.sendInputEvent({type:'mouseDown',button,clickCount:1,...point});win.webContents.sendInputEvent({type:'mouseUp',button,clickCount:1,...point});
 };
 const verifyDismissal=async()=>{
  await settings('camera');
  const clean={selection:0,drag:0,background:0,context:0,viewport:0};
  assert.equal(await js('Boolean(document.querySelector("[data-canvas-shortcuts-ignore] .ant-modal"))'),true);
  for(const method of ['pointer','escape','space','mask']){
   await js('directorTest.resetEvents()');
   if(method==='pointer')await pointerClick('button[aria-label=Close]');
   else if(method==='mask')await pointerClick('.ant-modal-wrap',true);
   else{
    await js(`document.querySelector(${JSON.stringify(method==='space'?'button[aria-label=Close]':'.ant-modal')}).focus()`);
    const keyCode=method==='space'?'Space':'Escape';win.webContents.sendInputEvent({type:'keyDown',keyCode});win.webContents.sendInputEvent({type:'keyUp',keyCode});
   }
   await wait('!document.querySelector("[data-director-editor]")');
   await wait('!document.querySelector(".ant-modal-wrap")');
   assert.deepEqual(await js('directorTest.events()'),clean,`${method} dismissal must not select, drag, zoom or capture behind the dialog`);
   if(method==='mask'){
    await pointerClick('[data-canvas-surface]','end');await wait('directorTest.events().background===1');
   }
   await click('打开导演台');await wait('document.querySelector("[data-director-editor]")');
   await settings('camera');
   assert.equal(await js('document.querySelector("input[aria-label=镜头焦距]").value'),'85','closing retains scene edits');
  }
  await js('directorTest.resetEvents()');await pointerClick('.ant-modal-title',false,'right');
  assert.deepEqual(await js('directorTest.events()'),clean,'dialog context menu must not reach the node or canvas');
 };
 const shortcut=async(keyCode,modifiers=[])=>{await js('window.directorKeyUp=false;window.addEventListener("keyup",()=>requestAnimationFrame(()=>{window.directorKeyUp=true}),{once:true,capture:true});document.querySelector("[data-director-viewport]").focus()');win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await wait('window.directorKeyUp');};
 const verifyEditing=async()=>{
  await settings('object');
  const count=await js('directorTest.state().nodes[0].metadata.directorScene.objects.length');
  const command=process.platform==='darwin'?'meta':'control';
  await js('document.querySelector("button[aria-label=复制物体]").click()');await wait(`directorTest.state().nodes[0].metadata.directorScene.objects.length===${count+1}`);
  await shortcut('Z',[command]);await wait(`directorTest.state().nodes[0].metadata.directorScene.objects.length===${count}`);
  await shortcut('Z',[command,'shift']);await wait(`directorTest.state().nodes[0].metadata.directorScene.objects.length===${count+1}`);
  await shortcut('Backspace',[command]);assert.equal(await js('directorTest.state().nodes[0].metadata.directorScene.objects.length'),count+1,'text-editing modifier must not remove objects');
  await shortcut('Delete');await wait(`directorTest.state().nodes[0].metadata.directorScene.objects.length===${count}`);
  await click('撤销');await wait(`directorTest.state().nodes[0].metadata.directorScene.objects.length===${count+1}`);
  await click('撤销');await wait(`directorTest.state().nodes[0].metadata.directorScene.objects.length===${count}`);
  await js('document.querySelector("button[aria-label^=锁定]").click()');await wait('document.querySelector("input[aria-label=物体名称]").disabled');
  await shortcut('Delete');assert.equal(await js('directorTest.state().nodes[0].metadata.directorScene.objects.length'),count,'locked object must resist keyboard deletion');
  await js('document.querySelector("button[aria-label^=解锁]").click()');await wait('!document.querySelector("input[aria-label=物体名称]").disabled');
  await js('document.querySelector("button[aria-label^=隐藏]").click()');await wait('directorTest.state().nodes[0].metadata.directorScene.objects[0].visible===false');
  await click('撤销');await wait('directorTest.state().nodes[0].metadata.directorScene.objects[0].visible!==false');
  await settings('camera');const shotCount=await js('directorTest.state().nodes[0].metadata.directorScene.shots?.length||0');await click('保存当前机位');await wait(`directorTest.state().nodes[0].metadata.directorScene.shots.length===${shotCount+1}`);
  const saved=await js('directorTest.state().nodes[0].metadata.directorScene.shots.at(-1)');
  await click('85 mm');await wait('directorTest.state().nodes[0].metadata.directorScene.camera.lens===85');
  await click('恢复此机位');await wait(`directorTest.state().nodes[0].metadata.directorScene.camera.lens===${saved.camera.lens}`);
  const restored=await js('directorTest.state().nodes[0].metadata.directorScene');assert.deepEqual(restored.camera,saved.camera);assert.equal(restored.width,saved.width);assert.equal(restored.height,saved.height);
 };
 const verifySceneExchange=async()=>{
  const original=await js('directorTest.state().nodes[0].metadata.directorScene');
  const imported=structuredClone(original);imported.note='雨夜对话';imported.objects[0].joints={head:[0,45,0],leftArm:[0,0,80]};imported.objects[0].roughness=0.4;imported.light={...imported.light,fill:1,rim:2,ambient:0.5};
  const file=JSON.stringify({format:'oneyes-director',version:1,scene:imported});
  const upload=async(text)=>js(`(()=>{const input=document.querySelector('input[aria-label="导入导演台场景文件"]'),transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(text)}],'场景.json',{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await upload(file);await wait('directorTest.state().nodes[0].metadata.directorScene.note==="雨夜对话"');
  assert.deepEqual(await js('directorTest.state().nodes[0].metadata.directorScene'),imported);
  await click('导出场景');
  const until=Date.now()+20000;while(!exportedFile){if(Date.now()>until)throw Error('Scene export did not download');await new Promise(resolve=>setTimeout(resolve,25));}
  assert.deepEqual(JSON.parse(await readFile(exportedFile,'utf8')),{format:'oneyes-director',version:1,scene:imported});
  await upload('{');await wait('document.body.textContent.includes("不是有效的 JSON")');assert.deepEqual(await js('directorTest.state().nodes[0].metadata.directorScene'),imported,'invalid file cannot overwrite scene');
  await click('撤销');await wait('directorTest.state().nodes[0].metadata.directorScene.note!=="雨夜对话"');assert.deepEqual(await js('directorTest.state().nodes[0].metadata.directorScene'),original,'scene import must be one undo step');
  await settings('object');await js('Array.from(document.querySelectorAll("summary")).find(item=>item.textContent==="精细调姿").click()');
  await wait(`document.querySelector('input[aria-label="关节旋转（度） Y"]')`);
  await js(`(()=>{const input=document.querySelector('input[aria-label="关节旋转（度） Y"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'35');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait('directorTest.state().nodes[0].metadata.directorScene.objects[0].joints?.head?.[1]===35');
  await click('重置此关节');await wait('!directorTest.state().nodes[0].metadata.directorScene.objects[0].joints?.head');
  await click('撤销');await wait('directorTest.state().nodes[0].metadata.directorScene.objects[0].joints?.head?.[1]===35');await click('撤销');
  assert.deepEqual(await js('directorTest.state().nodes[0].metadata.directorScene'),original);
  await settings('camera');await click('保存当前机位');await click('复制机位');await wait(`directorTest.state().nodes[0].metadata.directorScene.shots.length===${original.shots.length+2}`);
  const copy=await js('directorTest.state().nodes[0].metadata.directorScene.shots.at(-1)');assert.notEqual(copy.id,original.shots.at(-1).id);
  await click('机位前移');await wait(`directorTest.state().nodes[0].metadata.directorScene.shots[${original.shots.length}].id===${JSON.stringify(copy.id)}`);await click('撤销');await click('撤销');await click('撤销');
  assert.deepEqual(await js('directorTest.state().nodes[0].metadata.directorScene'),original);
 };
 const verifyTimeline=async()=>{
  await click('选择分镜 1');
  const original=await js('directorTest.state().nodes[0].metadata.directorScene');
  const input=async(label,value)=>js(`(()=>{const field=document.querySelector('input[aria-label=${JSON.stringify(label)}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,${JSON.stringify(String(value))});field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await input('分镜时长',0.5);await wait('directorTest.state().nodes[0].metadata.directorScene.shots[0].duration===0.5');
  await click('85 mm');await wait('directorTest.state().nodes[0].metadata.directorScene.camera.lens===85');
  await click('记录当前场景为末帧');await wait('directorTest.state().nodes[0].metadata.directorScene.shots[0].keyframes?.length===1');
  const before=await js('directorTest.state().nodes[0].metadata.directorScene');assert.equal(before.shots[0].camera.lens,original.shots[0].camera.lens);assert.equal(before.shots[0].keyframes[0].frame.camera.lens,85);
  await click('预演此镜');await wait('document.querySelector("[data-director-time]")?.textContent.startsWith("0.50") && document.body.textContent.includes("预演已暂停")');
  assert.deepEqual(await js('directorTest.state().nodes[0].metadata.directorScene'),before,'preview must never overwrite persisted scene');
  assert.equal(await js('document.querySelector("input[aria-label=镜头焦距]").disabled'),true);
  await click('编辑此帧');await wait('!document.querySelector("input[aria-label=镜头焦距]").disabled');await click('35 mm');await wait('directorTest.state().nodes[0].metadata.directorScene.camera.lens===35');
  await js('Array.from(document.querySelectorAll("summary")).find(item=>item.textContent==="镜头内容、台词与关键帧管理").click()');
  await click('记录当前场景为关键帧');await wait('directorTest.state().nodes[0].metadata.directorScene.shots[0].keyframes[0].frame.camera.lens===35');
  const keys=await js('directorTest.state().nodes[0].metadata.directorScene.shots[0].keyframes');assert.equal(keys.length,1);assert.equal(keys[0].id,before.shots[0].keyframes[0].id,'editing a frame replaces its key, preserving identity');
  await js('Array.from(document.querySelectorAll("summary")).find(item=>item.textContent==="创作描述与分镜交付").click()');await input('序列帧率',4);await wait('document.querySelector("input[aria-label=序列帧率]").value==="4"');
  const previous=downloads;await click('导出 PNG 序列');await wait('document.querySelector("input[aria-label=序列帧率]").disabled');
  const until=Date.now()+20000;while(downloads===previous){if(Date.now()>until)throw Error('PNG sequence did not download');await new Promise(resolve=>setTimeout(resolve,25));}
  const archive=unzipSync(new Uint8Array(await readFile(exportedFile))),images=Object.entries(archive).filter(([name])=>name.endsWith('.png'));
  assert.equal(images.length,2);assert.notDeepEqual(images[0][1],images[1][1]);for(const [,bytes] of images){const png=Buffer.from(bytes);assert.equal(png.readUInt32BE(16),321);assert.equal(png.readUInt32BE(20),197);}
  assert.ok(archive['storyboard.html']&&archive['shotlist.csv']&&archive['scene.json']);
  await wait('!document.querySelector("input[aria-label=序列帧率]").disabled');await input('序列帧率',24);const complete=downloads;
  await click('导出 PNG 序列');await wait('Array.from(document.querySelectorAll("button")).some(item=>item.textContent==="取消导出")');await click('取消导出');await wait('document.body.textContent.includes("导出已取消")');assert.equal(downloads,complete,'cancelled render must not download a partial archive');
  await js('Array.from(document.querySelectorAll("summary")).find(item=>item.textContent==="创作描述与分镜交付").click()');
  await js('Array.from(document.querySelectorAll("summary")).find(item=>item.textContent==="镜头内容、台词与关键帧管理").click()');
  while(await js('JSON.stringify(directorTest.state().nodes[0].metadata.directorScene)')!==JSON.stringify(original)){
   assert.equal(await js('document.querySelector("button[aria-label=撤销]").disabled'),false,'all timeline edits must be undoable');
   const state=await js('JSON.stringify(directorTest.state().nodes[0].metadata.directorScene)');await click('撤销');await wait(`JSON.stringify(directorTest.state().nodes[0].metadata.directorScene)!==${JSON.stringify(state)}`);
  }
 };
 try{
  await win.loadURL(process.argv[2]);await wait('window.directorTest && document.querySelector("button")');
  const webgl=await js('(()=>{const gl=document.createElement("canvas").getContext("webgl2");if(gl)gl.getExtension("WEBGL_lose_context")?.loseContext();return Boolean(gl);})()');
  if(!webgl){
   assert.ok(process.env.CI && process.platform==='darwin' && process.arch==='x64','real WebGL is required outside the known GPU-less Intel Mac runner');
   assert.match(app.getGPUFeatureStatus().webgl,/disabled|unavailable/,'runner must explicitly report unavailable graphics');
   if(process.env.CANVAS_DIRECTOR_TEST_PHASE==='restore'){
    const state=await js('directorTest.state()');assert.equal(state.nodes[0].metadata.directorScene.camera.lens,85);assert.equal(state.nodes[0].metadata.directorScene.shots.length,1);assert.equal(state.nodes.filter(n=>n.type==='image').length,0);
   }else{
    assert.deepEqual(await js('directorTest.validation()'),{independent:true,invalid:4});await js('directorTest.configure()');
   }
   await click('打开导演台');await wait('document.body.textContent.includes("无法启动三维视窗")');
   assert.equal(await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="输出取景图").disabled'),true);
   await verifyEditing();await verifySceneExchange();await wait('document.body.textContent.includes("无法启动三维视窗")');await settings('camera');await click('85 mm');await wait('directorTest.state().nodes[0].metadata.directorScene.camera.lens===85');
   await js('directorTest.save()');await verifyDismissal();await js('document.querySelector("button[aria-label=Close]").click()');await wait('!document.querySelector("[data-director-editor]")');
   await click('打开导演台');await wait('document.body.textContent.includes("无法启动三维视窗")');await settings('camera');assert.equal(await js('document.querySelector("input[aria-label=镜头焦距]").value'),'85');
   await js('directorTest.switch()');await wait('!document.querySelector("[data-director-editor]")');
   assert.deepEqual(external,[]);console.log('DIRECTOR_NO_GPU_OK: Intel CI VM explicitly lacks WebGL; local bundle, actionable notice, disabled export, scene/lens persistence, native-process restart and project isolation verified. Real rendering remains covered on the other five runners.');app.exit(0);return;
  }
  if(process.env.CANVAS_DIRECTOR_TEST_PHASE==='restore'){
   const state=await js('directorTest.state()');assert.equal(state.nodes.find(n=>n.id==='director').metadata.directorScene.camera.lens,85);assert.equal(state.nodes.filter(n=>n.type==='image').length,2);
   assert.equal(state.nodes[0].metadata.directorScene.shots[0].keyframes.length,1);assert.deepEqual(await js('directorTest.savedMotion()'),[50,67.5,85],'independent stage and animation keys must survive a native process restart');
   const image=await js('directorTest.image()');assert.equal(image.width,321);assert.equal(image.height,197);assert.ok(image.colors>30);
   await click('打开导演台');await wait('document.querySelector("[data-director-viewport] canvas")');await settings('camera');assert.equal(await js('document.querySelector("input[aria-label=镜头焦距]").value'),'85');assert.equal(state.nodes[0].metadata.directorScene.shots.length,1);await verifyDismissal();
   await verifyEditing();assert.equal(await js('directorTest.state().nodes[0].metadata.directorScene.shots.length'),2,'adding a shot after restart preserves the saved shot');
   await js('directorTest.switch()');await wait('!document.querySelector("[data-director-editor]")');assert.equal((await js('directorTest.state()')).projectId,'B');
   console.log('DIRECTOR_RESTART_OK: scene/lens, independent stage snapshots and animated keyframes, original PNG storage, project isolation');
  }else{
   assert.deepEqual(await js('directorTest.validation()'),{independent:true,invalid:4});
   const runtime=await js('directorTest.runtime()');assert.deepEqual(runtime.sizes,[[317,191],[317,191]]);assert.equal(runtime.differs,true);assert.equal(runtime.portraitControls,true);assert.equal(runtime.cleanExport,true,'guides and selection must not leak into PNG');assert.equal(runtime.visibility,true);assert.ok(Math.abs(runtime.grounded)<0.01,'ground uses actual geometry bounds');assert.equal(runtime.lock,true);assert.equal(runtime.focused,true);assert.match(runtime.reason,/不会自动降低分辨率/);
   await js('directorTest.configure()');await click('打开导演台');await wait('document.querySelector("[data-director-viewport] canvas") && !Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="输出取景图").disabled');
   await verifyEditing();await verifySceneExchange();await verifyTimeline();
   const sequence=await js('directorTest.sequence()');assert.equal(sequence.progress,4);assert.deepEqual(sequence.sizes,[[317,191],[317,191],[193,311],[193,311]]);
   await click('输出取景图');await wait('directorTest.state().nodes.filter(n=>n.type==="image").length===1 && document.body.textContent.includes("已保存到画布")');
   await screenshot('oneyes-director-light.png');
   const first=await js('directorTest.image()');assert.equal(first.width,321);assert.equal(first.height,197);assert.ok(first.colors>30);
   await click('85 mm');await wait('directorTest.state().nodes[0].metadata.directorScene.camera.lens===85');
   await click('输出取景图');await wait('directorTest.state().nodes.filter(n=>n.type==="image").length===2 && document.body.textContent.includes("已保存到画布")');
   const second=await js('directorTest.image(1)');assert.notEqual(first.hash,second.hash);const exported=await js('directorTest.state()');assert.equal(exported.connections.length,2);const images=exported.nodes.filter(n=>n.type==='image');assert.ok(images[1].position.y>=images[0].position.y+images[0].height,'repeated exports must not overlap');
   await js('directorTest.theme(true)');await wait('document.documentElement.classList.contains("dark")');
   await screenshot('oneyes-director-dark.png');
   await verifyDismissal();
   await click('记录当前场景为末帧');await wait('directorTest.state().nodes[0].metadata.directorScene.shots[0].keyframes?.length===1');
   await js('directorTest.save()');
   await click('创建生图工作流');await wait('directorTest.state().nodes.filter(n=>n.type==="text").length===1 && document.body.textContent.includes("已保存到画布")');
   const workflow=await js('directorTest.state()'),text=workflow.nodes.find(node=>node.type==='text'),target=workflow.nodes.find(node=>node.title==='导演台 · 待生成');
   assert.equal(target.metadata.status,'idle');assert.equal(target.metadata.generationType,'edit');assert.match(text.metadata.content,/保持人物位置/);assert.equal(workflow.connections.filter(edge=>edge.toNodeId===target.id).length,2);assert.equal(workflow.nodes.filter(node=>node.type==='image').length,4);
   await js('Array.from(document.querySelectorAll("summary")).find(item=>item.textContent==="创作描述与分镜交付").click()');await click('创建视频工作流');await wait('directorTest.state().nodes.some(node=>node.title==="导演台 · 待生成视频")');
   const video=await js('directorTest.state().nodes.find(node=>node.title==="导演台 · 待生成视频")');assert.equal(video.type,'video');assert.equal(video.metadata.status,'idle');assert.equal(video.metadata.seconds,'5');assert.equal(video.metadata.references.length,1);assert.match(video.metadata.prompt,/0s：相机/);
   console.log('DIRECTOR_3D_OK: real timeline preview without persistence, frame editing/undo, native ZIP sequence download/cancel, WebGL motion pixels and exact sizes, camera roll retention, native dismissal, light/dark, linked image/video workflows');
  }
  assert.deepEqual(external,[],'director must load fully offline');
  app.exit(0);
 }catch(error){console.error(error);app.exit(1);}
}).catch(error=>{console.error(error);app.exit(1);});
