const { app, BrowserWindow, protocol, net } = require('electron');
const assert = require('node:assert/strict');
const { writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { route } = require('../../desktop/protocol.cjs');
protocol.registerSchemesAsPrivileged([{ scheme: 'oneyes-canvas', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
if(process.env.CANVAS_DIRECTOR_TEST_PROFILE)app.setPath('userData',process.env.CANVAS_DIRECTOR_TEST_PROFILE);
app.whenReady().then(async()=>{
 protocol.handle('oneyes-canvas',request=>{const {file}=route(request.url,process.env.CANVAS_DIRECTOR_TEST_ROOT);assert.ok(file);return net.fetch(file);});
 const win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}}),js=code=>win.webContents.executeJavaScript(code);
 const screenshot=async(name)=>{if(!process.env.CANVAS_DIRECTOR_SCREENSHOT)return;win.showInactive();await js('Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{}))).then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');await new Promise(resolve=>setTimeout(resolve,500));await writeFile(join(tmpdir(),name),(await win.capturePage()).toPNG());win.hide();};
 const external=[];win.webContents.session.webRequest.onBeforeRequest((details,callback)=>{const blocked=/^https?:/.test(details.url);if(blocked)external.push(details.url);callback({cancel:blocked});});
 const wait=async(code)=>{const until=Date.now()+20000;while(!await js(code)){if(Date.now()>until)throw Error('Timed out: '+code);await new Promise(resolve=>setTimeout(resolve,25));}};
 const click=async(text)=>{await js(`Array.from(document.querySelectorAll('button')).find(item=>item.textContent.trim()===${JSON.stringify(text)}).click()`);};
 try{
  await win.loadURL(process.argv[2]);await wait('window.directorTest && document.querySelector("button")');
  const webgl=await js('(()=>{const gl=document.createElement("canvas").getContext("webgl2");if(gl)gl.getExtension("WEBGL_lose_context")?.loseContext();return Boolean(gl);})()');
  if(!webgl){
   assert.ok(process.env.CI && process.platform==='darwin' && process.arch==='x64','real WebGL is required outside the known GPU-less Intel Mac runner');
   assert.match(app.getGPUFeatureStatus().webgl,/disabled|unavailable/,'runner must explicitly report unavailable graphics');
   if(process.env.CANVAS_DIRECTOR_TEST_PHASE==='restore'){
    const state=await js('directorTest.state()');assert.equal(state.nodes[0].metadata.directorScene.camera.lens,85);assert.equal(state.nodes.filter(n=>n.type==='image').length,0);
   }else{
    assert.deepEqual(await js('directorTest.validation()'),{independent:true,invalid:4});await js('directorTest.configure()');
   }
   await click('打开导演台');await wait('document.body.textContent.includes("无法启动三维视窗")');
   assert.equal(await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="输出取景图").disabled'),true);
   await click('85 mm');await wait('directorTest.state().nodes[0].metadata.directorScene.camera.lens===85');
   await js('directorTest.save()');await js('document.querySelector("button[aria-label=Close]").click()');await wait('!document.querySelector("[data-director-editor]")');
   await click('打开导演台');await wait('document.body.textContent.includes("无法启动三维视窗")');assert.equal(await js('document.querySelector("input[aria-label=镜头焦距]").value'),'85');
   await js('directorTest.switch()');await wait('!document.querySelector("[data-director-editor]")');
   assert.deepEqual(external,[]);console.log('DIRECTOR_NO_GPU_OK: Intel CI VM explicitly lacks WebGL; local bundle, actionable notice, disabled export, scene/lens persistence, native-process restart and project isolation verified. Real rendering remains covered on the other five runners.');app.exit(0);return;
  }
  if(process.env.CANVAS_DIRECTOR_TEST_PHASE==='restore'){
   const state=await js('directorTest.state()');assert.equal(state.nodes.find(n=>n.id==='director').metadata.directorScene.camera.lens,85);assert.equal(state.nodes.filter(n=>n.type==='image').length,2);
   const image=await js('directorTest.image()');assert.equal(image.width,321);assert.equal(image.height,197);assert.ok(image.colors>30);
   await click('打开导演台');await wait('document.querySelector("[data-director-viewport] canvas")');assert.equal(await js('document.querySelector("input[aria-label=镜头焦距]").value'),'85');
   await js('directorTest.switch()');await wait('!document.querySelector("[data-director-editor]")');assert.equal((await js('directorTest.state()')).projectId,'B');
   console.log('DIRECTOR_RESTART_OK: scene/lens, original PNG storage, project isolation');
  }else{
   assert.deepEqual(await js('directorTest.validation()'),{independent:true,invalid:4});
   const runtime=await js('directorTest.runtime()');assert.deepEqual(runtime.sizes,[[317,191],[317,191]]);assert.equal(runtime.differs,true);assert.equal(runtime.portraitControls,true);assert.match(runtime.reason,/不会自动降低分辨率/);
   await js('directorTest.configure()');await click('打开导演台');await wait('document.querySelector("[data-director-viewport] canvas") && !Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="输出取景图").disabled');
   await click('输出取景图');await wait('directorTest.state().nodes.filter(n=>n.type==="image").length===1 && document.body.textContent.includes("已保存到画布")');
   await screenshot('oneyes-director-light.png');
   const first=await js('directorTest.image()');assert.equal(first.width,321);assert.equal(first.height,197);assert.ok(first.colors>30);
   await click('85 mm');await wait('directorTest.state().nodes[0].metadata.directorScene.camera.lens===85');
   await click('输出取景图');await wait('directorTest.state().nodes.filter(n=>n.type==="image").length===2 && document.body.textContent.includes("已保存到画布")');
   const second=await js('directorTest.image(1)');assert.notEqual(first.hash,second.hash);assert.equal((await js('directorTest.state()')).connections.length,2);
   await js('directorTest.theme(true)');await wait('document.documentElement.classList.contains("dark")');
   await screenshot('oneyes-director-dark.png');
   await js('document.querySelector("button[aria-label=Close]").click()');await wait('!document.querySelector("[data-director-editor]")');await click('打开导演台');await wait('document.querySelector("[data-director-viewport] canvas")');
   await js('directorTest.save()');
   console.log('DIRECTOR_3D_OK: native scheme offline bundle, real WebGL, pose/lens changes, precise PNG, GPU limit refusal, cleanup, light/dark, scene persistence, linked image results');
  }
  assert.deepEqual(external,[],'director must load fully offline');
  app.exit(0);
 }catch(error){console.error(error);app.exit(1);}
}).catch(error=>{console.error(error);app.exit(1);});
