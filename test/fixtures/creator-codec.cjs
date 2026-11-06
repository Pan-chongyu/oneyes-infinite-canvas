const { app, BrowserWindow, protocol, net, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const { readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { join } = require('node:path');
const { readFile, writeFile, mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const exec = require('node:util').promisify(require('node:child_process').execFile);
const { route } = require('../../desktop/protocol.cjs');
const { createMediaTools } = require('../../desktop/media-tools.cjs');
protocol.registerSchemesAsPrivileged([{ scheme: 'oneyes-canvas', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
app.whenReady().then(async () => {
    const root = resolve('web/dist'), files = readdirSync(resolve(root, 'assets'));
    const ai = files.find(name => /^creator-ai\.worker-.+\.js$/.test(name));
    const compose = files.find(name => /^creator-compose\.worker-.+\.js$/.test(name));
    assert.ok(ai && compose);
    const localRequests = [];
    const directory = await mkdtemp(join(tmpdir(), 'canvas-upscale-codec-')), binaries = resolve('desktop/media-bin');
    const binary = name => join(binaries, name + (process.platform === 'win32' ? '.exe' : ''));
    const media = createMediaTools({ directory, binaries });
    protocol.handle('oneyes-canvas', request => {
        if (new URL(request.url).pathname.startsWith('/media-tools/')) return media.request(request);
        if (new URL(request.url).pathname === '/') return new Response('<main>Isolated creator tool test</main>', { headers: { 'Content-Type': 'text/html' } });
        const { file } = route(request.url, root);
        assert.ok(file); localRequests.push(file);
        return net.fetch(file);
    });
    const win = new BrowserWindow({ show: false, webPreferences: { preload: resolve('desktop/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const trusted = event => assert.equal(event.sender, win.webContents);
    ipcMain.handle('media:create', (event,...args)=>{trusted(event);return media.create(...args);});
    for(const operation of ['start','finish'])ipcMain.handle('media:'+operation,async(event,id)=>{trusted(event);try{return {data:await media[operation](id)};}catch(error){return {error:error.message};}});
    ipcMain.handle('media:release',(event,id)=>{trusted(event);return media.release(id);});
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
        assert.deepEqual(result.composition.slice(0,2), [4,3]);
        // Skia's premultiplied-alpha rounding differs by one byte across native backends.
        const [red,green,blue,opacity] = result.composition.slice(2);
        assert.ok(Math.abs(red-127) <= 1 && Math.abs(blue-128) <= 1);
        assert.equal(green,0); assert.equal(opacity,255); assert.equal(result.invalid,true);
        assert.ok(localRequests.some(file=>file.endsWith('.wasm')) && localRequests.some(file=>file.endsWith('u2netp.onnx')) && localRequests.some(file=>file.endsWith('espcn-3x.onnx')));
        const file = join(directory,'source.mp4');
        const timeline=join(directory,'timeline.mp4');
        await exec(binary('ffmpeg'), ['-nostdin','-y','-f','lavfi','-i','testsrc2=s=32x24:r=5','-frames:v','3','-vf',"setpts='if(eq(N,2),3,N)/(5*TB)'",'-fps_mode:v','passthrough','-c:v','libx264','-pix_fmt','yuv420p',timeline]);
        await exec(binary('ffmpeg'), ['-nostdin','-y','-i',timeline,'-f','lavfi','-i','sine=frequency=440:duration=1.2','-map','0:v','-map','1:a','-c:v','copy','-c:a','aac',file]);
        const modelReads = localRequests.filter(file=>file.endsWith('espcn-3x.onnx')).length;
        const encoded = (await readFile(file)).toString('base64');
        const video = await win.webContents.executeJavaScript(`(async()=>{
            const media=window.oneYesDesktop.media,id=await media.create('videoSuperResolution',1,{scale:3});
            const worker=new Worker('/assets/${ai}',{type:'module'});
            const enhance=(blob,index)=>new Promise((resolve,reject)=>{worker.onmessage=({data})=>{if(data.stage)return;data.blob?resolve(data.blob):reject(Error(data.error));};worker.onerror=event=>reject(Error(event.message));worker.postMessage({id:index,operation:'superResolution',blob});});
            try{
                const put=await fetch('oneyes-canvas://app/media-tools/'+id+'/input/0',{method:'PUT',body:Uint8Array.from(atob('${encoded}'),c=>c.charCodeAt(0))});if(!put.ok)throw Error('Video upload failed');
                const prepared=await media.start(id);if(prepared.error)throw Error(prepared.error);
                for(const [index,frame] of prepared.data.entries()){
                    const source=await fetch('oneyes-canvas://app/media-tools/'+id+'/output/'+frame.name);
                    const blob=await enhance(await source.blob(),index);
                    const response=await fetch('oneyes-canvas://app/media-tools/'+id+'/enhanced/'+index,{method:'PUT',body:blob});if(!response.ok)throw Error('Enhanced upload failed');
                }
                const finished=await media.finish(id);if(finished.error)throw Error(finished.error);
                const response=await fetch('oneyes-canvas://app/media-tools/'+id+'/output/'+finished.data[0].name);
                return {bytes:Array.from(new Uint8Array(await response.arrayBuffer())),frames:prepared.data.length};
            }finally{worker.terminate();await media.release(id);}
        })()`);
        assert.equal(video.frames,3);assert.equal(localRequests.filter(file=>file.endsWith('espcn-3x.onnx')).length-modelReads,1,'reuse one real local model session for every video frame');
        const final=join(directory,'enhanced.mp4');await writeFile(final,Buffer.from(video.bytes));
        const information=JSON.parse((await exec(binary('ffprobe'),['-v','error','-show_streams','-show_format','-of','json',final])).stdout);
        assert.equal(information.streams[0].width,96);assert.equal(information.streams[0].height,72);assert.equal(information.streams.filter(item=>item.codec_type==='audio').length,1);assert.ok(Number(information.format.duration)>=1.2);
        console.log('CREATOR_TOOLS_OFFLINE_OK: real local models/WASM, 3x tiled inference, transparent cutout, layer blending, original sizes');
        console.log('VIDEO_UPSCALE_OFFLINE_OK: real native IPC, actual ESPCN frames, one model session, exact 3x video, VFR and audio');
        await media.close();await rm(directory,{recursive:true,force:true});
        app.exit(0);
    } catch(error) { console.error(error);await media.close();await rm(directory,{recursive:true,force:true}); app.exit(1); }
}).catch(error=>{console.error(error);app.exit(1);});
