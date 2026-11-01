const { readFile, mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
async function smokeMedia(binaries, window) {
    for (const name of ['ffmpeg', 'ffprobe']) {
        const path = join(binaries, name + (process.platform === 'win32' ? '.exe' : ''));
        const bytes = await readFile(path);
        let arch;
        if (process.platform === 'win32') { const machine = bytes.readUInt16LE(bytes.readUInt32LE(0x3c) + 4); arch = { 34404: 'x64', 43620: 'arm64' }[machine]; }
        else if (process.platform === 'linux') arch = { 62: 'x64', 183: 'arm64' }[bytes.readUInt16LE(18)];
        else arch = { 16777223: 'x64', 16777228: 'arm64' }[bytes.readUInt32LE(4)];
        if (arch !== process.arch) throw new Error(`Media binary architecture mismatch: ${name}`);
        const { stdout } = await execFile(path, ['-version'], { windowsHide: true });
        if (!stdout.startsWith(name + ' version ')) throw new Error(`Media binary failed: ${name}`);
    }
    if (!window) return;
    const directory = await mkdtemp(join(tmpdir(), 'canvas-native-media-'));
    try {
        const file = join(directory, 'source.mp4');
        await execFile(join(binaries, 'ffmpeg' + (process.platform === 'win32' ? '.exe' : '')), ['-nostdin', '-y', '-f', 'lavfi', '-i', 'color=red:s=96x64:r=12:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file], { windowsHide: true });
        const data = (await readFile(file)).toString('base64');
        const result = await window.webContents.executeJavaScript(`(async () => {
            const media=window.oneYesDesktop.media,id=await media.create('analyze',1,{threshold:0.3});
            try {
                const upload=await fetch('oneyes-canvas://app/media-tools/'+id+'/input/0',{method:'PUT',body:Uint8Array.from(atob('${data}'),value=>value.charCodeAt(0))});
                if(!upload.ok)throw Error('Native video upload failed');
                const result=await media.start(id);if(result.error)throw Error(result.error);
                const frame=result.data.find(item=>item.kind==='image');
                const response=await fetch('oneyes-canvas://app/media-tools/'+id+'/output/'+frame.name);
                const blob=await response.blob(),image=await createImageBitmap(blob);
                const info={width:image.width,height:image.height,bytes:blob.size,expected:frame.bytes,report:result.data.some(item=>item.kind==='text')};image.close();return info;
            } finally {await media.release(id);}
        })()`);
        if (result.width !== 96 || result.height !== 64 || result.bytes !== result.expected || !result.report) throw new Error('Packaged native media roundtrip failed');
        const captioned = await window.webContents.executeJavaScript(`(async () => {
            const media=window.oneYesDesktop.media,id=await media.create('subtitles',1,{srt:'1\\n00:00:00,000 --> 00:00:00,900\\n无限画布\\n'});
            try {
                const upload=await fetch('oneyes-canvas://app/media-tools/'+id+'/input/0',{method:'PUT',body:Uint8Array.from(atob('${data}'),v=>v.charCodeAt(0))});if(!upload.ok)throw Error('Subtitle upload failed');
                const result=await media.start(id);if(result.error)throw Error(result.error);
                const item=result.data[0],response=await fetch('oneyes-canvas://app/media-tools/'+id+'/output/'+item.name);
                return response.ok&&(await response.blob()).size===item.bytes;
            } finally {await media.release(id);}
        })()`);
        if(!captioned)throw Error('Packaged Chinese subtitle roundtrip failed');
    } finally { await rm(directory, { recursive: true, force: true }); }
}
module.exports = { smokeMedia };
