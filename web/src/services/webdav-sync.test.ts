import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
const values = new Map<string, string>();
globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => {values.set(k,v);}, removeItem: k => {values.delete(k);}, clear: () => values.clear(), key: i => [...values.keys()][i] ?? null, get length() {return values.size;} };
globalThis.window = { localStorage, setTimeout, clearTimeout } as unknown as Window & typeof globalThis;
const { buildWebdavUrl, testWebdavConnection, downloadWebdavFile, readWebdavFile, uploadWebdavFile, webdavFileExists } = await import('./webdav-sync');
const { parseDomainManifest, mergeCanvasData, blobSha256 } = await import('./app-sync-data');
const { useConfigStore, defaultConfig } = await import('@/stores/use-config-store');
const { requestWebdav } = createRequire(import.meta.url)('../../../desktop/webdav.cjs');
const nativeFetch = globalThis.fetch;
globalThis.DOMParser = createRequire(import.meta.url)('../../../node_modules/@xmldom/xmldom').DOMParser;
const multistatus = (href: string, collection = true, status = 200) => `<D:multistatus xmlns:D="DAV:"><D:response><D:href>${href.replaceAll('&','&amp;')}</D:href>${status===200?`<D:propstat><D:prop><D:resourcetype>${collection?'<D:collection/>':''}</D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>`:`<D:status>HTTP/1.1 ${status} Error</D:status>`}</D:response></D:multistatus>`;
const config = { url: 'https://dav.example.test/remote.php/dav/files/user/', directory: '画布 备份/OneYes', username: '用户', password: 'p@ss:/密码', lastSyncedAt: '' };

test('WebDAV paths retain base paths and encode Unicode, spaces and special characters', () => {
    assert.equal(buildWebdavUrl(config, 'canvas/a #?.json'), 'https://dav.example.test/remote.php/dav/files/user/%E7%94%BB%E5%B8%83%20%E5%A4%87%E4%BB%BD/OneYes/canvas/a%20%23%3F.json');
    assert.ok(buildWebdavUrl(config, '').endsWith('/OneYes/'));
    assert.match(buildWebdavUrl({...config,url:'https://dav.test/dav%20root',directory:''},'file'), /dav%20root\/file$/);
    for (const url of ['', 'ftp://dav.test', 'https://u:p@dav.test', 'https://dav.test/?password=x', 'https://dav.test/#x']) assert.throws(() => buildWebdavUrl({...config,url},'file'));
    for (const directory of ['../secret','a/./b','a\\b','%2e%2e/secret','a/%2fsecret']) assert.throws(() => buildWebdavUrl({...config,directory},'file'));
});

test('desktop native DAV roundtrip deduplicates collections, preserves auth/ETag and reads without CORS', async t => {
    const collections = new Set(['/dav/']), files = new Map<string, Buffer>(), seen: Array<{method:string;path:string}> = [];
    const expectedAuth = 'Basic '+Buffer.from(config.username+':'+config.password).toString('base64');
    const server = createServer(async(req,res) => {
        const path=req.url!, method=req.method!; seen.push({method,path});
        assert.equal(req.headers.authorization,expectedAuth);assert.equal(req.headers.cookie,undefined);assert.equal(req.headers['proxy-authorization'],undefined);
        if(method==='MKCOL') {if(collections.has(path))res.writeHead(405);else{collections.add(path);res.writeHead(201);}return res.end();}
        if(method==='PROPFIND'){assert.equal(req.headers.depth,'0');const chunks=[];for await(const chunk of req)chunks.push(chunk);assert.match(Buffer.concat(chunks).toString(),/resourcetype/);res.writeHead(collections.has(path)?207:404);return res.end(multistatus(path));}
        if(method==='PUT') {const chunks=[];for await(const chunk of req)chunks.push(chunk);files.set(path,Buffer.concat(chunks));assert.equal(req.headers['if-none-match'],'*');res.writeHead(201);return res.end();}
        if(!files.has(path)){res.writeHead(404);return res.end();}
        res.writeHead(200,{'content-type':'application/octet-stream',etag:'"v1"'});res.end(files.get(path));
    });
    server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
    const port=(server.address() as {port:number}).port, current={...config,url:`http://127.0.0.1:${port}/dav/`};
    window.oneYesDesktop={} as NonNullable<Window['oneYesDesktop']>;
    globalThis.fetch=async(input,init)=>{
        const routed=new URL(String(input));assert.equal(routed.pathname,'/webdav');
        assert.doesNotMatch(routed.href,/p%40ss|password|Authorization/);
        return requestWebdav(new Request(routed,init),routed.searchParams.get('url'),nativeFetch);
    };
    try {
        const blob=new Blob(['original media bytes']);
        await Promise.all([uploadWebdavFile(current,'canvas/files/a.bin',blob,blob.type,{ifNoneMatch:'*'}),uploadWebdavFile(current,'assets/files/b.bin',blob,blob.type,{ifNoneMatch:'*'})]);
        assert.equal(seen.filter(x=>x.method==='MKCOL'&&x.path.endsWith('/OneYes/')).length,1);
        const resource=await readWebdavFile(current,'canvas/files/a.bin');assert.equal(resource?.etag,'"v1"');assert.equal(await resource?.blob.text(),'original media bytes');
        assert.equal(await downloadWebdavFile(current,'not-found.json'),null);
        await testWebdavConnection(current);await testWebdavConnection({...current,password:config.password});
        assert.ok(seen.some(x=>x.method==='PROPFIND'));
    } finally {globalThis.fetch=nativeFetch;delete window.oneYesDesktop;}
});

test('DAV failures preserve HTTP reasons and a subsequent attempt creates directories again', async()=>{
    try {
        for(const [status,pattern] of [[401,/认证/],[403,/权限/],[412,/其他设备/],[423,/锁定/],[507,/空间/]] as const){
            globalThis.fetch=async()=>new Response(null,{status});
            await assert.rejects(testWebdavConnection(config),pattern);
        }
        let creates=0;
        globalThis.fetch=async(input,init)=>{if(init?.method==='MKCOL'){creates++;return new Response(null,{status:201});}return new Response(multistatus(new URL(String(input)).pathname),{status:207});};
        await testWebdavConnection(config);await testWebdavConnection(config);assert.equal(creates,4);
        globalThis.fetch=async()=>new Response('');await assert.rejects(downloadWebdavFile(config,'manifest.json'),/为空/);
    } finally{globalThis.fetch=nativeFetch;}
});

test('DAV method fallbacks validate the requested XML resource and never accept login pages or nested failures',async()=>{
    try{
        for(const status of [405,501]){
            const calls:string[]=[];
            globalThis.fetch=async(input,init)=>{calls.push(init!.method!);return init?.method==='HEAD'?new Response(null,{status}):new Response(multistatus(new URL(String(input)).pathname,false),{status:207});};
            assert.equal(await webdavFileExists(config,'canvas/files/original.png'),true);assert.deepEqual(calls,['HEAD','PROPFIND']);
        }
        for(const status of [401,403,507]){
            let calls=0;globalThis.fetch=async()=>{calls++;return new Response(null,{status});};
            await assert.rejects(webdavFileExists(config,'canvas/files/original.png'));assert.equal(calls,1,'auth and quota failures must not switch methods');
        }
        for(const body of ['<html>login</html>',multistatus('/wrong-resource/'),multistatus(new URL(buildWebdavUrl(config,'')).pathname,false)]){
            globalThis.fetch=async(_input,init)=>init?.method==='MKCOL'?new Response(null,{status:201}):new Response(body,{status:207});
            await assert.rejects(testWebdavConnection(config),/资源信息|文件夹/);
        }
        globalThis.fetch=async(input,init)=>new Response(init?.method==='MKCOL'?null:multistatus(new URL(String(input)).pathname,true,404),{status:init?.method==='MKCOL'?403:207});
        await assert.rejects(testWebdavConnection(config),/权限/);
        globalThis.fetch=async(input,init)=>init?.method==='HEAD'?new Response(null,{status:405}):new Response(multistatus(new URL(String(input)).pathname,false,404),{status:207});
        assert.equal(await webdavFileExists(config,'missing.png'),false);
    }finally{globalThis.fetch=nativeFetch;}
});

test('browser forwarding and desktop DAV routes do not mix proxy credentials into URLs',async()=>{
    const previous=useConfigStore.getState().config;
    try{
        useConfigStore.setState({config:{...defaultConfig,proxyEnabled:true,proxyMode:'forwarder',proxyUrl:'http://127.0.0.1:23210'}});
        globalThis.fetch=async(url)=>{assert.ok(String(url).startsWith('http://127.0.0.1:23210/https://dav.'));return new Response(null,{status:404});};
        assert.equal(await downloadWebdavFile(config,'manifest.json'),null);
        window.oneYesDesktop={} as NonNullable<Window['oneYesDesktop']>;
        globalThis.fetch=async(url)=>{assert.ok(String(url).startsWith('oneyes-canvas://app/webdav?'));return new Response(null,{status:404});};
        assert.equal(await downloadWebdavFile(config,'manifest.json'),null);
    }finally{globalThis.fetch=nativeFetch;delete window.oneYesDesktop;useConfigStore.setState({config:previous});}
});

test('manifests reject corrupted, future, cross-domain and escaping media entries',async()=>{
    const sha256=await blobSha256(new Blob(['abc']));assert.equal(sha256,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const manifest={app:'infinite-canvas',version:1,domain:'canvas',exportedAt:'',data:{projects:[],deleted:[]},files:[{storageKey:'image:abc',path:'canvas/files/a.png',mimeType:'image/png',bytes:3,sha256}]};
    assert.equal(parseDomainManifest(JSON.stringify(manifest),'canvas').files.length,1);
    assert.equal(parseDomainManifest('\uFEFF'+JSON.stringify(manifest),'canvas').files.length,1);
    for(const patch of [{version:2},{data:{}},{data:{projects:[null],deleted:[]}},{files:[{...manifest.files[0],path:'assets/files/a.png'}]},{files:[{...manifest.files[0],path:'canvas/files/../secret'}]},{files:[{...manifest.files[0],bytes:0}]},{files:[manifest.files[0],manifest.files[0]]}])assert.throws(()=>parseDomainManifest(JSON.stringify({...manifest,...patch}),'canvas'));
    assert.throws(()=>parseDomainManifest(JSON.stringify(manifest),'assets'));
});

test('sync merges newer canvases and respects deletion tombstones across devices',()=>{
    const project=(id:string,updatedAt:string): import('@/stores/canvas/use-canvas-store').CanvasProject=>({id,updatedAt,createdAt:updatedAt,title:id,nodes:[],connections:[],chatSessions:[],activeChatId:null,backgroundMode:'lines',showImageInfo:false,viewport:{x:0,y:0,k:1}});
    const old=project('a','2026-01-01T00:00:00Z'),newer=project('a','2026-01-02T00:00:00Z');
    assert.equal(mergeCanvasData({projects:[newer],deleted:[]},{projects:[old],deleted:[]}).projects[0],newer);
    assert.equal(mergeCanvasData({projects:[],deleted:[{id:'a',deletedAt:'2026-01-03T00:00:00Z'}]},{projects:[newer],deleted:[]}).projects.length,0);
    const restored=mergeCanvasData({projects:[newer],deleted:[]},{projects:[],deleted:[{id:'a',deletedAt:'2026-01-01T00:00:00Z'}]});
    assert.equal(restored.projects.length,1);assert.equal(restored.deleted.length,0);
});
