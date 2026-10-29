const { app, BrowserWindow, protocol, net, ipcMain }=require('electron');
const { createServer }=require('node:http');
const { mkdtempSync }=require('node:fs');
const { tmpdir }=require('node:os');
const { join,resolve }=require('node:path');
const { route }=require('../../desktop/protocol.cjs');
const { requestWebdav }=require('../../desktop/webdav.cjs');
const assert=require('node:assert/strict');
const base=process.argv[2], profile=mkdtempSync(join(tmpdir(),'canvas-webdav-regression-'));
app.setPath('userData',profile);
protocol.registerSchemesAsPrivileged([{scheme:'oneyes-canvas',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
app.whenReady().then(async()=>{
    let stored=null, revision=0, conflict=false, savedManifest;
    const collections=new Set(['/dav/']),files=new Map();
    const server=createServer(async(req,res)=>{
        try{
            assert.equal(req.headers.authorization,'Basic '+Buffer.from('test-user:test-password').toString('base64'));
            assert.equal(req.headers.cookie,undefined);
            if(req.method==='MKCOL'){const status=collections.has(req.url)?405:201;collections.add(req.url);res.writeHead(status);return res.end();}
            if(req.method==='PROPFIND'){res.writeHead(collections.has(req.url)?207:404);return res.end();}
            const current=files.get(req.url);
            if(req.method==='PUT'){
                if(conflict&&req.url.endsWith('/manifest.json')||(req.headers['if-match']&&req.headers['if-match']!==current?.etag)||(req.headers['if-none-match']==='*'&&current)){res.writeHead(412);return res.end();}
                const chunks=[];for await(const chunk of req)chunks.push(chunk);files.set(req.url,{bytes:Buffer.concat(chunks),etag:'"'+(++revision)+'"'});res.writeHead(201);return res.end();
            }
            if(!current){res.writeHead(404);return res.end();}
            res.writeHead(200,{'content-type':'application/octet-stream',etag:current.etag});res.end(current.bytes);
        }catch(error){console.error(error);res.writeHead(500);res.end();}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    protocol.handle('oneyes-canvas',async request=>{
        const url=new URL(request.url);
        if(url.pathname==='/fixture-control'){
            const {operation}=await request.json();const assetPath=[...files.keys()].find(key=>key.endsWith('/assets/manifest.json'));
            if(operation==='corrupt-manifest'){savedManifest=files.get(assetPath);files.set(assetPath,{...savedManifest,bytes:Buffer.from('{}')});}
            if(operation==='restore-manifest')files.set(assetPath,savedManifest);
            if(operation==='conflict')conflict=true;
            if(operation==='clear-conflict')conflict=false;
            if(operation==='missing-media')for(const key of files.keys())if(key.includes('/files/'))files.delete(key);
            return Response.json({ok:true});
        }
        if(url.pathname==='/webdav'){const target=route(request.url,resolve('web/dist'));return requestWebdav(request,target.webdav,(...args)=>net.fetch(...args));}
        return net.fetch((url.pathname==='/'?base:new URL(base).origin+url.pathname)+url.search);
    });
    ipcMain.handle('config:read',()=>stored);ipcMain.handle('config:write',(_event,value)=>{stored=value;});ipcMain.handle('config:remove',()=>{stored=null;});
    const win=new BrowserWindow({show:false,width:1200,height:800,webPreferences:{preload:resolve('desktop/preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    win.webContents.on('console-message',event=>{ if(event.level==='error')console.error(event.message); });
    try{
        await win.loadURL('oneyes-canvas://app/');
        const result=await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const timer=setInterval(()=>{if(window.webdavTest){clearInterval(timer);window.webdavTest(${JSON.stringify(`http://127.0.0.1:${server.address().port}/dav/`)}).then(resolve,reject);}},25);})`);
        console.log('WEBDAV_NATIVE_SYNC_OK:',result);app.exit(0);
    }catch(error){console.error(error);app.exit(1);}
}).catch(error=>{console.error(error);app.exit(1);});
