const {app,BrowserWindow,protocol,net}=require('electron');
const assert=require('node:assert/strict');
const {writeFileSync}=require('node:fs');
const {createServer}=require('node:http');
const {route}=require('../../desktop/protocol.cjs');
const {downloadImage}=require('../../desktop/image-download.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'oneyes-canvas',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
app.whenReady().then(async()=>{
 let originalBytes;const reads=[];
 const storage=createServer((req,res)=>{assert.equal(req.method,'GET');assert.equal(req.headers.authorization,undefined);assert.equal(req.headers.cookie,undefined);res.writeHead(req.url.includes('blocked=1')?403:200,{'Content-Type':'application/octet-stream'});res.end(originalBytes);});
 await new Promise(resolve=>storage.listen(0,'127.0.0.1',resolve));
 protocol.handle('oneyes-canvas',request=>{
  const target=route(request.url,process.env.CANVAS_CREATOR_TEST_ROOT);
  if(target.image)return downloadImage(request,target.image,(url,init)=>{reads.push({url,credentials:init.credentials,redirect:init.redirect});assert.equal(new URL(url).hostname,'creator-fixture.invalid');return net.fetch(`http://127.0.0.1:${storage.address().port}${new URL(url).pathname}${new URL(url).search}`,init);});
  assert.ok(target.file);return net.fetch(target.file);
 });
 const win=new BrowserWindow({show:false,width:900,height:850,webPreferences:{contextIsolation:true,nodeIntegration:false}});
 const js=code=>win.webContents.executeJavaScript(code);
 const wait=async condition=>{const end=Date.now()+20000;while(!await js(condition)){if(Date.now()>end)throw Error('Timed out: '+condition);await new Promise(resolve=>setTimeout(resolve,25));}};
 try{
  await win.loadURL(process.argv[2]);await wait('window.creatorTest && document.querySelector("[data-creator-panel]")');
  const original=await js('creatorTest.original()');
  originalBytes=Buffer.from(original);
  await js('window.reported=[];window.oneYesDesktop={diagnostics:{report:async event=>reported.push(event)}};undefined');
  assert.equal(await js('creatorTest.pair()'),true,'double click shares the current task');
  await wait('creatorTest.state().nodes.length===3');
  const output=await js('creatorTest.state().nodes.find(n=>n.id!=="tool"&&n.id!=="source")');
  assert.equal(output.type,'image');assert.equal(output.metadata.naturalWidth,9);assert.equal(output.metadata.naturalHeight,7);assert.ok(output.metadata.storageKey);
  assert.equal(await js('creatorTest.state().connections.length'),1);
  await js('creatorTest.clear(); creatorTest.seed("compose")');
  await js('creatorTest.start(); creatorTest.cancel()');await wait('creatorTest.state().nodes[1].metadata.status==="idle"');
  assert.equal(await js('creatorTest.state().nodes.length'),2);
  await js('creatorTest.seed("compose")');await js('creatorTest.start();creatorTest.switchProject()');
  await js('new Promise(resolve=>setTimeout(resolve,100))');
  assert.equal(await js('creatorTest.state().projectId'),'B');assert.equal(await js('creatorTest.state().nodes.length'),1,'late results never reach another canvas');
  await js('creatorTest.seed("compose")');await js('creatorTest.start();creatorTest.remove()');
  await js('new Promise(resolve=>setTimeout(resolve,100))');assert.equal(await js('creatorTest.state().nodes.length'),1);
  await js('creatorTest.seed("compose","loading")');
  await wait('creatorTest.state().nodes[1].metadata.status==="error"');
  assert.match(await js('document.body.innerText'),/上次本地处理已中断/);
  for(const name of ['analyze','concat','cutout','compose','superResolution']){
   await js(`creatorTest.seed('${name}');creatorTest.theme(true)`);
   await wait(`document.querySelector('[data-creator-panel="${name}"]')`);
   assert.ok(await js('document.body.innerText.includes("结果作为新节点保存")'));
  }
  assert.deepEqual(await js('creatorTest.original()'),original);
  const remote='https://creator-fixture.invalid/original.png?signature=fixture-private';
  for(const kind of ['remote','batch','missing-index']){
   await js(`creatorTest.input(${JSON.stringify(kind)},${JSON.stringify(remote)})`);
   await js('creatorTest.start()');await wait('creatorTest.state().nodes.length===3');
   const result=await js('creatorTest.state().nodes.find(n=>n.id!=="source"&&n.id!=="tool")');
   assert.equal(result.metadata.naturalWidth,9);assert.equal(result.metadata.naturalHeight,7);assert.ok(result.metadata.storageKey);
   assert.equal(await js('creatorTest.outputPixels()'),true,'full original pixels must be preserved');
   assert.deepEqual(await js('creatorTest.original()'),original);await js('creatorTest.clear()');
  }
  assert.equal(reads.length,1);assert.deepEqual(reads[0],{url:remote,credentials:'omit',redirect:'error'});
  await js(`creatorTest.input('remote',${JSON.stringify(remote+'&blocked=1')})`);
  const denied=await js('creatorTest.start().then(()=>"",error=>error.message)');assert.match(denied,/原图链接已失效或无权访问/);assert.match(denied,/不会重新提交生图请求/);
  assert.equal(await js('reported.at(-1).error.status'),403);assert.equal(await js('reported.at(-1).stage'),'request');assert.equal(reads.length,2);assert.equal(await js('creatorTest.state().nodes.length'),2);
  await js('creatorTest.input("empty","")');const failure=await js('creatorTest.start().then(()=>"",error=>error.message)');assert.match(failure,/原始素材|图片/);
  assert.equal(await js('creatorTest.state().nodes.length'),2);assert.equal(await js('creatorTest.state().nodes[1].metadata.status'),'error');assert.equal(await js('reported.at(-1).stage'),'request');
  if(process.env.CANVAS_CREATOR_SCREENSHOT){
   await js('creatorTest.seed("compose");creatorTest.theme(false)');
   await wait('document.querySelector("[data-creator-panel=compose]")');
   await wait('!document.body.innerText.includes("取消处理")');
   await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
   writeFileSync(process.env.CANVAS_CREATOR_SCREENSHOT,(await win.webContents.capturePage()).toPNG());
   await js('creatorTest.theme(true)');win.setSize(680,820);
   await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
   await js('Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))');
   assert.ok(await js('Number(getComputedStyle(document.querySelector("[data-creator-panel] button")).color.match(/[\\d.]+/)[0])>150'),'dark buttons stay legible');
   writeFileSync(process.env.CANVAS_CREATOR_SCREENSHOT.replace('.png','-dark.png'),(await win.webContents.capturePage()).toPNG());
  }
  console.log('CREATOR_UI_OK: native-scheme original without CORS or credentials, batch selection, missing-index original, precise output, five nodes, cancellation, project isolation, source retained');storage.close();app.exit(0);
 }catch(error){console.error(error);console.error(await js('document.body.innerText'));app.exit(1);}
}).catch(error=>{console.error(error);app.exit(1);});
