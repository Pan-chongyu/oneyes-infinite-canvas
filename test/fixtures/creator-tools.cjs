const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const {writeFileSync}=require('node:fs');
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:900,height:850,webPreferences:{contextIsolation:true,nodeIntegration:false}});
 const js=code=>win.webContents.executeJavaScript(code);
 const wait=async condition=>{const end=Date.now()+20000;while(!await js(condition)){if(Date.now()>end)throw Error('Timed out: '+condition);await new Promise(resolve=>setTimeout(resolve,25));}};
 try{
  await win.loadURL(process.argv[2]);await wait('window.creatorTest && document.querySelector("[data-creator-panel]")');
  const original=await js('creatorTest.original()');
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
  console.log('CREATOR_UI_OK: five original-style nodes, duplicate guard, cancellation, canvas switch, deletion, restart recovery, source retained');app.exit(0);
 }catch(error){console.error(error);console.error(await js('document.body.innerText'));app.exit(1);}
}).catch(error=>{console.error(error);app.exit(1);});
