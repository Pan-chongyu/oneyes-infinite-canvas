const { app, BrowserWindow, protocol, net } = require('electron');
const assert = require('node:assert/strict');
const { readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { route } = require('../../desktop/protocol.cjs');
protocol.registerSchemesAsPrivileged([{ scheme: 'oneyes-canvas', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
app.whenReady().then(async () => {
    const root = resolve('web/dist'), files = readdirSync(resolve(root, 'assets'));
    const ai = files.find(name => /^creator-ai\.worker-.+\.js$/.test(name));
    const compose = files.find(name => /^creator-compose\.worker-.+\.js$/.test(name));
    assert.ok(ai && compose);
    const localRequests = [];
    protocol.handle('oneyes-canvas', request => {
        if (new URL(request.url).pathname === '/') return new Response('<main>Isolated creator tool test</main>', { headers: { 'Content-Type': 'text/html' } });
        const { file } = route(request.url, root);
        assert.ok(file); localRequests.push(file);
        return net.fetch(file);
    });
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }));
    try {
        await win.loadURL('oneyes-canvas://app/');
        const result = await win.webContents.executeJavaScript(`(async () => {
            const surface = (w,h) => { const canvas = new OffscreenCanvas(w,h); return {canvas,ctx:canvas.getContext('2d')}; };
            const process = async (script, data) => {
                const worker = new Worker('/assets/'+script, {type:'module'});
                try { return await new Promise((resolve,reject) => {
                    worker.onmessage=({data}) => { if(data.stage)return; data.blob ? resolve(data.blob) : reject(Error(data.error)); };
                    worker.onerror=event=>reject(Error(event.message)); worker.postMessage(data);
                }); } finally {worker.terminate();}
            };
            const input = surface(201,33);
            input.ctx.fillStyle='#51759b';input.ctx.fillRect(0,0,201,33);
            for(let x=0;x<201;x+=4){input.ctx.fillStyle=x%8?'#111111':'#eeeeee';input.ctx.fillRect(x,0,2,20);}
            const blob=await input.canvas.convertToBlob({type:'image/png'});
            const enhanced=await process('${ai}',{operation:'superResolution',blob});
            const bitmap=await createImageBitmap(enhanced), original=surface(bitmap.width,bitmap.height);
            original.ctx.drawImage(await createImageBitmap(blob),0,0,bitmap.width,bitmap.height);
            const bilinear=original.ctx.getImageData(0,0,bitmap.width,bitmap.height).data;
            original.ctx.clearRect(0,0,bitmap.width,bitmap.height);original.ctx.drawImage(bitmap,0,0);
            const neural=original.ctx.getImageData(0,0,bitmap.width,bitmap.height).data;
            let difference=0;for(let i=0;i<neural.length;i+=4)difference+=Math.abs(neural[i]-bilinear[i]);
            const subject=surface(80,60);subject.ctx.fillStyle='white';subject.ctx.fillRect(0,0,80,60);subject.ctx.fillStyle='#223355';subject.ctx.beginPath();subject.ctx.ellipse(40,30,18,24,0,0,Math.PI*2);subject.ctx.fill();
            subject.ctx.clearRect(0,0,1,1);
            const removed=await process('${ai}',{operation:'cutout',blob:await subject.canvas.convertToBlob({type:'image/png'})});
            const cut=await createImageBitmap(removed);subject.ctx.clearRect(0,0,80,60);subject.ctx.drawImage(cut,0,0);
            const alpha=subject.ctx.getImageData(0,0,80,60).data;
            let low=255,high=0;for(let i=3;i<alpha.length;i+=4){low=Math.min(low,alpha[i]);high=Math.max(high,alpha[i]);}
            const base=surface(4,3);base.ctx.fillStyle='red';base.ctx.fillRect(0,0,4,3);
            const top=surface(1,1);top.ctx.fillStyle='blue';top.ctx.fillRect(0,0,1,1);
            const blobs=await Promise.all([base,top].map(v=>v.canvas.convertToBlob({type:'image/png'})));
            const merged=await process('${compose}',{blobs,layers:[{},{x:1,y:1,opacity:0.5}]});
            const image=await createImageBitmap(merged);base.ctx.clearRect(0,0,4,3);base.ctx.drawImage(image,0,0);
            let invalid=false;try{await process('${compose}',{blobs,layers:[{blend:'copy'},{}]});}catch{invalid=true;}
            return {width:bitmap.width,height:bitmap.height,difference,cut:[cut.width,cut.height],alpha:[low,high,alpha[3]],composition:[image.width,image.height,...base.ctx.getImageData(1,1,1,1).data],invalid};
        })()`);
        assert.equal(result.width, 603); assert.equal(result.height, 99); assert.ok(result.difference > 100, 'AI result must differ from interpolated pixels');
        assert.deepEqual(result.cut, [80,60]); assert.equal(result.alpha[2], 0); assert.ok(result.alpha[0] < result.alpha[1]);
        assert.deepEqual(result.composition, [4,3,127,0,128,255]); assert.equal(result.invalid,true);
        assert.ok(localRequests.some(file=>file.endsWith('.wasm')) && localRequests.some(file=>file.endsWith('u2netp.onnx')) && localRequests.some(file=>file.endsWith('espcn-3x.onnx')));
        console.log('CREATOR_TOOLS_OFFLINE_OK: real local models/WASM, 3x tiled inference, transparent cutout, layer blending, original sizes');
        app.exit(0);
    } catch(error) { console.error(error); app.exit(1); }
}).catch(error=>{console.error(error);app.exit(1);});
