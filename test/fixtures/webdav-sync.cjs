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
    let stored=null, revision=0, conflict=false, savedManifest, recoveryManifests, compatibility=false, changedDuringRead=false;
    const collections=new Set(['/dav/']),files=new Map();
    const server=createServer(async(req,res)=>{
        try{
            assert.equal(req.headers.authorization,'Basic '+Buffer.from('test-user:test-password').toString('base64'));
            assert.equal(req.headers.cookie,undefined);
            if(req.method==='MKCOL'){const status=collections.has(req.url)?(compatibility?403:405):201;collections.add(req.url);res.writeHead(status);return res.end();}
            if(req.method==='PROPFIND'){
                const chunks=[];for await(const chunk of req)chunks.push(chunk);assert.match(Buffer.concat(chunks).toString(),/resourcetype/);
                const exists=collections.has(req.url)||files.has(req.url),isDirectory=collections.has(req.url);
                res.writeHead(207,{'Content-Type':'application/xml'});
                return res.end(`<d:multistatus xmlns:d="DAV:"><d:response><d:href>${req.url.replaceAll('&','&amp;')}</d:href>${exists?`<d:propstat><d:prop><d:resourcetype>${isDirectory?'<d:collection/>':''}</d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>`:'<d:status>HTTP/1.1 404 Not Found</d:status>'}</d:response></d:multistatus>`);
            }
            const current=files.get(req.url);
            if(req.method==='HEAD'&&compatibility){res.writeHead(405);return res.end();}
            if(req.method==='PUT'){
                assert.ok(!req.headers['if-match']?.startsWith('W/'),'weak ETag is not a valid If-Match validator');
                if(compatibility&&current&&req.url.endsWith('/manifest.json'))assert.equal(req.headers['if-unmodified-since'],'Fri, 30 Oct 2026 00:00:00 GMT');
                if(conflict&&req.url.endsWith('/manifest.json')||(req.headers['if-match']&&req.headers['if-match']!==current?.etag)||(req.headers['if-none-match']==='*'&&current)||(req.headers['if-unmodified-since']&&req.headers['if-unmodified-since']!=='Fri, 30 Oct 2026 00:00:00 GMT')){res.writeHead(412);return res.end();}
                const chunks=[];for await(const chunk of req)chunks.push(chunk);files.set(req.url,{bytes:Buffer.concat(chunks),etag:'"'+(++revision)+'"'});res.writeHead(201);return res.end();
            }
            if(!current){res.writeHead(404);return res.end();}
            res.writeHead(200,{'content-type':'application/octet-stream',...(compatibility==='no-etag'?{}:{etag:compatibility?'W/'+current.etag:current.etag}),'last-modified':'Fri, 30 Oct 2026 00:00:00 GMT'});
            const bytes=compatibility&&req.url.endsWith('/manifest.json')?Buffer.concat([Buffer.from([239,187,191]),current.bytes]):current.bytes;
            res.end(bytes);
            if(changedDuringRead&&req.method==='GET'&&req.url.endsWith('/assets/manifest.json')){
                const value=JSON.parse(current.bytes.toString());value.exportedAt='concurrent-edit';files.set(req.url,{...current,bytes:Buffer.from(JSON.stringify(value))});changedDuringRead=false;
            }
        }catch(error){console.error(error);res.writeHead(500);res.end();}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    protocol.handle('oneyes-canvas',async request=>{
        const url=new URL(request.url);
        if(url.pathname==='/fixture-control'){
            const {operation,key,ambiguous}=await request.json();const assetPath=[...files.keys()].find(key=>key.endsWith('/assets/manifest.json'));
            if(operation==='compatibility')compatibility=true;
            if(operation==='no-etag')compatibility='no-etag';
            if(operation==='end-compatibility')compatibility=false;
            if(operation==='concurrent-weak-etag')changedDuringRead=true;
            if(operation==='corrupt-canvas-media')for(const [path,file]of files)if(path.includes('/canvas/files/'))files.set(path,{...file,bytes:Buffer.alloc(file.bytes.length)});
            if(operation==='legacy-manifests')for(const [path,file]of files)if(path.endsWith('/manifest.json')){
                const manifest=JSON.parse(file.bytes.toString());for(const entry of manifest.files)delete entry.sha256;
                files.set(path,{...file,bytes:Buffer.from(JSON.stringify(manifest))});
            }
            if(operation==='invalid-recovery-source'){
                recoveryManifests=new Map([...files].filter(([path])=>path.endsWith('/manifest.json')));
                for(const domain of ambiguous?['assets','image-workbench']:['assets']){
                    const manifestPath=[...files.keys()].find(path=>path.endsWith(`/${domain}/manifest.json`)),original=files.get(manifestPath),manifest=JSON.parse(original.bytes.toString());
                    const template=manifest.files[0],sourcePath=new URL(template.path,'http://fixture'+manifestPath.replace(new RegExp(`${domain}/manifest.json$`),'')).pathname;
                    const bytes=Buffer.from(files.get(sourcePath).bytes),path=`${domain}/files/recovery-fixture.png`;
                    if(!ambiguous)bytes[0]^=1;
                    manifest.files.push({...template,storageKey:key,path,sha256:ambiguous&&domain==='image-workbench'?'0'.repeat(64):template.sha256});
                    files.set(new URL(path,'http://fixture'+manifestPath.replace(new RegExp(`${domain}/manifest.json$`),'')).pathname,{bytes,etag:'"fixture"'});
                    files.set(manifestPath,{...original,bytes:Buffer.from(JSON.stringify(manifest))});
                }
            }
            if(operation==='restore-recovery-manifests')for(const [path,file]of recoveryManifests)files.set(path,file);
            if(operation==='orphan-asset-record'){
                const original=files.get(assetPath),manifest=JSON.parse(original.bytes.toString());
                manifest.data.assets=manifest.data.assets.filter(asset=>asset.data.storageKey!==key);
                files.set(assetPath,{...original,bytes:Buffer.from(JSON.stringify(manifest))});
            }
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
