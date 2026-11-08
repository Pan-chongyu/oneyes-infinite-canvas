const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { join, basename } = require('node:path');
const { mkdir, rm, readdir, writeFile, stat, copyFile, open } = require('node:fs/promises');
const { createWriteStream, createReadStream } = require('node:fs');
const { Readable } = require('node:stream');
const { pipeline, finished } = require('node:stream/promises');
const { validateSmartEdit, processSmartEdit } = require('./smart-edit.cjs');
const { prepareUpscale, finishUpscale } = require('./video-upscale.cjs');

// Structured commands and opaque job IDs only. Renderer input never becomes a path or shell command.
function createMediaTools({ directory, binaries, changed = () => {}, onError = () => {} }) {
    const jobs = new Map();
    const root = join(directory, 'media-work');
    const ready = rm(root, { recursive: true, force: true }).then(() => mkdir(root, { recursive: true }));
    ready.catch(() => {}); // A media-directory error must not prevent the rest of the app from opening.
    const binary = name => join(binaries, name + (process.platform === 'win32' ? '.exe' : ''));
    const notify = (job, stage, progress) => changed({ id: job.id, stage, ...(Number.isFinite(progress) ? { progress: Math.max(0, Math.min(100, progress)) } : {}) });
    const get = id => { const job = jobs.get(id); if (!job) throw new Error('处理任务已结束，请重新开始'); return job; };
    const run = (job, name, args, line = () => {}) => new Promise((resolve, reject) => {
        job.controller.signal.throwIfAborted();
        const formats = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,mpeg,mpegts,ogg,flv,asf,rm,wav,mp3,flac,aac' + (job.operation.startsWith('edit') ? ',png_pipe,jpeg_pipe,webp_pipe,image2' : '')];
        // Uploaded media must be self-contained, never a playlist reading paths or network URLs.
        if (name === 'ffprobe') args = [...formats, ...args];
        else if (!args.includes('concat')) { args = args.flatMap(arg=>arg==='-i'?[...formats,arg]:[arg]); }
        const child = spawn(binary(name), args, { cwd:job.path, shell: false, windowsHide: true, signal: job.controller.signal });
        let stdout = '', pending = '';
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { pending += chunk; const lines = pending.split(/\r?\n/); pending = lines.pop(); lines.forEach(line); });
        let error;
        child.on('error', value => { error = value; });
        child.on('close', code => {
            if (pending) line(pending);
            if (job.controller.signal.aborted) return reject(new Error('已取消本地处理'));
            if (error?.code === 'ENOENT') return reject(new Error('本地媒体组件缺失，请重新安装最新版 OneYes Canvas', { cause: error }));
            if (error || code !== 0) return reject(Object.assign(new Error('无法处理该媒体，请检查文件是否完整及编码是否受支持', { cause: error }), { code: error?.code || 'ERR_MEDIA_PROCESS' }));
            resolve(stdout);
        });
    });
    const probe = async (job, file) => {
        const data = JSON.parse(await run(job, 'ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
        const video = data.streams.find(stream => stream.codec_type === 'video');
        if (!video || !(video.width > 0 && video.height > 0) || !(Number(data.format.duration) > 0)) throw new Error('无法读取视频的原始尺寸和时长');
        const rotation = Number(video.side_data_list?.find(item => item.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0);
        const rotated = Math.abs(rotation % 180) === 90;
        const [numerator, denominator = 1] = String(video.avg_frame_rate).split('/').map(Number);
        return { video, audios: data.streams.filter(stream => stream.codec_type === 'audio'), duration: Number(data.format.duration), startTime: Number(data.format.start_time) || 0, width: rotated ? video.height : video.width, height: rotated ? video.width : video.height, fps: numerator / denominator };
    };
    const input = (job, index) => join(job.path, `input-${index}`);
    const output = async (job, name, kind) => {
        const file = join(job.path, name);
        const info = await stat(file);
        if (!info.size) throw new Error('媒体处理没有产生有效文件');
        job.outputs.set(name, { file, kind });
        return { name, kind, bytes: info.size };
    };
    async function processJob(job) {
        await Promise.all(job.uploads.values());
        if (job.received.size !== job.count) throw new Error('请等待全部素材上传完成');
        if (job.operation === 'videoSuperResolution') return prepareUpscale(job, { run, input, output, probe, notify });
        if (job.operation.startsWith('edit')) return processSmartEdit(job, { run, input, output, notify, binaries });
        if(['extract','mix','subtitles'].includes(job.operation))return processStudioMedia(job);
        const metadata = [];
        for (let index = 0; index < job.count; index++) metadata.push(await probe(job, input(job, index)));
        const results = [];
        if (job.operation === 'sample') {
            const meta = metadata[0];
            for (let index = 0; index < job.options.samples; index++) {
                job.controller.signal.throwIfAborted();
                const time = meta.duration * index / job.options.samples, name = `sample-${String(index + 1).padStart(6,'0')}.png`;
                notify(job, `正在提取参考帧 ${index + 1} / ${job.options.samples}`, index / job.options.samples * 100);
                await run(job,'ffmpeg',['-nostdin','-y','-ss',String(time),'-i',input(job,0),'-map','0:v:0','-frames:v','1',join(job.path,name)]);
                results.push({...await output(job,name,'image'),time});
            }
            await writeFile(join(job.path,'video-info.json'),JSON.stringify({duration:meta.duration,width:meta.width,height:meta.height}));
            results.push(await output(job,'video-info.json','text'));
            return results;
        }
        const encode = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-movflags', '+faststart'];
        const verifyVideo = async (file, source) => {
            const meta = await probe(job, join(job.path, file));
            if (meta.width !== source.width || meta.height !== source.height || meta.audios.length !== source.audios.length) throw new Error('处理结果尺寸或音轨不一致，已停止保存；原始素材保持不变');
        };
        if (job.operation === 'analyze') {
            const times = [];
            notify(job, '正在检测镜头并提取原尺寸关键帧');
            await run(job, 'ffmpeg', ['-nostdin', '-y', '-i', input(job, 0), '-vf', `select='eq(n,0)+gt(scene,${job.options.threshold})',showinfo`, '-fps_mode:v', 'vfr', join(job.path, 'frame-%06d.png')], line => {
                const match = line.match(/pts_time:([\d.]+)/);
                if (match) { const time = Number(match[1]); times.push(times.length ? time : 0); notify(job, '正在检测镜头并提取原尺寸关键帧', time / metadata[0].duration * 100); }
            });
            const frames = (await readdir(job.path)).filter(name => /^frame-\d+\.png$/.test(name)).sort();
            if (!frames.length || frames.length !== times.length) throw new Error('镜头时间表与关键帧不一致，请重新处理原始视频');
            for (const [index, name] of frames.entries()) results.push({ ...await output(job, name, 'image'), time: times[index] });
            if (job.options.clips) for (const [index, start] of times.entries()) {
                notify(job, `正在导出镜头 ${index + 1} / ${times.length}`, index / times.length * 100);
                const name = `shot-${String(index + 1).padStart(6, '0')}.mp4`;
                await run(job, 'ffmpeg', ['-nostdin', '-y', '-ss', String(start), '-i', input(job, 0), '-t', String((times[index + 1] ?? metadata[0].duration) - start), '-map', '0:v:0', '-map', '0:a?', ...encode, join(job.path, name)]);
                await verifyVideo(name, metadata[0]);
                results.push({ ...await output(job, name, 'video'), time: start });
            }
            if (job.options.audio) for (let index = 0; index < metadata[0].audios.length; index++) {
                notify(job, `正在提取原音轨 ${index + 1}`);
                const name = `audio-${index + 1}.wav`;
                await run(job, 'ffmpeg', ['-nostdin', '-y', '-i', input(job, 0), '-map', `0:a:${index}`, '-vn', '-c:a', 'pcm_f32le', join(job.path, name)]);
                results.push(await output(job, name, 'audio'));
            }
            const report = [`镜头分析 · ${metadata[0].width} × ${metadata[0].height} · ${metadata[0].duration.toFixed(3)} 秒`, '按画面变化检测切镜；关键帧保持原始显示尺寸。', ...times.map((start, index) => `镜头 ${index + 1}：${start.toFixed(3)} – ${(times[index + 1] ?? metadata[0].duration).toFixed(3)} 秒（时长 ${((times[index + 1] ?? metadata[0].duration) - start).toFixed(3)} 秒）`)];
            await writeFile(join(job.path, 'analysis.txt'), report.join('\n'));
            results.push(await output(job, 'analysis.txt', 'text'));
        } else {
            const first = metadata[0];
            const audioShape = meta => JSON.stringify(meta.audios.map(audio => [audio.channels, audio.sample_rate, audio.channel_layout]));
            if (!Number.isFinite(first.fps) || first.fps <= 0 || metadata.some(meta => meta.width !== first.width || meta.height !== first.height || meta.fps !== first.fps || audioShape(meta) !== audioShape(first))) throw new Error('视频尺寸、帧率或音轨结构不一致，请选择一致的素材；不会自动缩小、裁切或丢弃音轨');
            const list = [];
            for (let index = 0; index < job.count; index++) {
                const trim = job.options.trims[index] || {};
                const start = trim.start ?? 0, end = trim.end ?? metadata[index].duration;
                if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > metadata[index].duration || end <= start) throw new Error(`第 ${index + 1} 段视频的截取时间无效`);
                notify(job, `正在准备片段 ${index + 1} / ${job.count}`, index / job.count * 100);
                const name = `segment-${index}.mp4`;
                await run(job, 'ffmpeg', ['-nostdin', '-y', '-ss', String(start), '-i', input(job, index), '-t', String(end - start), '-map', '0:v:0', '-map', '0:a?', ...encode, join(job.path, name)]);
                await verifyVideo(name, metadata[index]);
                list.push(`file '${name}'`);
            }
            notify(job, '正在合并视频');
            await writeFile(join(job.path, 'segments.txt'), list.join('\n'));
            await run(job, 'ffmpeg', ['-nostdin', '-y', '-f', 'concat', '-safe', '1', '-i', join(job.path, 'segments.txt'), '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', '-movflags', '+faststart', join(job.path, 'merged.mp4')]);
            await verifyVideo('merged.mp4', first);
            results.push(await output(job, 'merged.mp4', 'video'));
        }
        notify(job, '处理完成', 100);
        return results;
    }
    async function processStudioMedia(job){
        notify(job,'正在处理音视频');
        const audioInfo=async(index)=>{const info=JSON.parse(await run(job,'ffprobe',['-v','error','-show_streams','-show_format','-of','json',input(job,index)]));if(!info.streams.some(s=>s.codec_type==='audio'))throw Error('所选素材没有音轨');return info;};
        if(job.operation==='extract'){
            await audioInfo(0);
            await run(job,'ffmpeg',['-nostdin','-y','-i',input(job,0),'-map','0:a:0','-vn','-c:a','pcm_s16le',join(job.path,'speech.wav')]);
            return [await output(job,'speech.wav','audio')];
        }
        const meta=await probe(job,input(job,0));
        if(job.operation==='subtitles'){
            await mkdir(join(job.path,'fonts'));
            await copyFile(join(binaries,'NotoSansCJKsc-Regular.otf'),join(job.path,'fonts','NotoSansCJKsc-Regular.otf'));
            await writeFile(join(job.path,'captions.srt'),job.options.srt,'utf8');
            await run(job,'ffmpeg',['-nostdin','-y','-i',input(job,0),'-map','0:v:0','-map','0:a?','-vf',"subtitles=filename=captions.srt:fontsdir=fonts:force_style='Fontname=Noto Sans CJK SC'",'-c:v','libx264','-crf','18','-c:a','copy','-movflags','+faststart',join(job.path,'subtitled.mp4')]);
            const actual=await probe(job,join(job.path,'subtitled.mp4'));
            if(actual.width!==meta.width||actual.height!==meta.height||actual.audios.length!==meta.audios.length)throw Error('字幕结果尺寸或音轨不符，已停止保存');
            return [await output(job,'subtitled.mp4','video')];
        }
        const args=['-nostdin','-y','-i',input(job,0)],filters=[],labels=[];
        // Preserve every original audio track by mixing the soundtrack into each.
        for(let i=1;i<job.count;i++){await audioInfo(i);args.push('-i',input(job,i));const fadeOut=job.options.fadeOut;filters.push(`[${i}:a:0]volume=${job.options.volume},apad,atrim=duration=${meta.duration},afade=t=in:st=0:d=${job.options.fadeIn},afade=t=out:st=${Math.max(0,meta.duration-fadeOut)}:d=${fadeOut}[music${i}]`);labels.push(`[music${i}]`);}
        if(!labels.length)throw Error('请添加至少一份旁白或配乐');
        filters.push(`${labels.join('')}amix=inputs=${labels.length}:duration=longest:normalize=0[music]`);
        const tracks=Math.max(1,meta.audios.length);
        filters.push(`[music]asplit=${tracks}${Array.from({length:tracks},(_,i)=>`[track${i}]`).join('')}`);
        for(let i=0;i<tracks;i++)filters.push(meta.audios.length?`[0:a:${i}]volume=${job.options.originalVolume}[original${i}];[original${i}][track${i}]amix=inputs=2:duration=longest:normalize=0[out${i}]`:`[track${i}]anull[out${i}]`);
        args.push('-filter_complex',filters.join(';'),'-map','0:v:0');for(let i=0;i<tracks;i++)args.push('-map',`[out${i}]`);
        args.push('-t',String(meta.duration),'-c:v','copy','-c:a','aac','-movflags','+faststart',join(job.path,'mixed.mp4'));
        await run(job,'ffmpeg',args);const actual=await probe(job,join(job.path,'mixed.mp4'));
        if(actual.width!==meta.width||actual.height!==meta.height||actual.audios.length!==tracks)throw Error('混音结果尺寸或音轨不符，已停止保存');
        return [await output(job,'mixed.mp4','video')];
    }
    return {
        async create(operation, count, options = {}) {
            if (!['analyze','sample', 'concat','extract','mix','subtitles','editAnalyze','editRender','videoSuperResolution'].includes(operation) || !Number.isSafeInteger(count) || count < 1 || (['analyze','sample','extract','subtitles','videoSuperResolution'].includes(operation) && count !== 1)) throw new Error('无效的媒体处理任务');
            if (operation === 'sample' && (!Number.isSafeInteger(options.samples) || options.samples < 1)) throw Error('参考帧数量必须为正整数');
            if (operation === 'videoSuperResolution' && ![2, 3].includes(options.scale)) throw Error('请选择 2× 或 3× 视频超采样');
            if (operation.startsWith('edit')) validateSmartEdit(operation, count, options);
            if(operation==='mix'&&(count<2||['volume','originalVolume','fadeIn','fadeOut'].some(key=>!Number.isFinite(options[key])||options[key]<0)))throw Error('请填写有效的混音音量和淡入淡出时间');
            if(operation==='subtitles'&&(typeof options.srt!=='string'||!/^\d+\r?\n\d\d:\d\d:\d\d,\d{3} --> /m.test(options.srt)))throw Error('字幕内容无效');
            if (operation === 'analyze' && (!Number.isFinite(options.threshold) || options.threshold < 0 || options.threshold > 1)) throw new Error('请设置有效的镜头检测灵敏度');
            if (operation === 'concat' && !Array.isArray(options.trims)) throw new Error('请设置视频片段顺序');
            await ready;
            const id = randomUUID(), path = join(root, id);
            await mkdir(path);
            jobs.set(id, { id, path, operation, count, options, uploads: new Map(), received: new Set(), outputs: new Map(), reads: new Set(), controller: new AbortController() });
            return id;
        },
        async start(id) { const job = get(id); if (!job.running) job.running = processJob(job).catch(error => {
            if (!job.controller.signal.aborted) { try { onError(error, 'request', job.operation === 'editAnalyze' ? 'media-analyze' : job.operation === 'editRender' ? 'media-render' : 'media-process'); } catch {} }
            throw error;
        }); return job.running; },
        async finish(id) { const job = get(id); job.controller.signal.throwIfAborted(); if (job.operation !== 'videoSuperResolution') throw Error('无效的视频超采样任务'); if (!job.finishing) job.finishing = (async () => { await job.running; return finishUpscale(job, { run, input, output, probe, notify }); })().catch(error => { if (!job.controller.signal.aborted) { try { onError(error, 'request', 'media-process'); } catch {} } throw error; }); return job.finishing; },
        async release(id) { const job = jobs.get(id); if (!job) return; if (!job.releasing) { job.controller.abort(); job.releasing = (async () => { await Promise.allSettled([...job.uploads.values(), ...job.reads, ...(job.upscale ? job.upscale.uploads.values() : []), ...(job.running ? [job.running] : []), ...(job.finishing ? [job.finishing] : [])]); jobs.delete(id); await rm(job.path, { recursive: true, force: true }); })(); } return job.releasing; },
        async close() { await Promise.allSettled([...jobs.keys()].map(id => this.release(id))); },
        async request(request) {
            const url = new URL(request.url), parts = url.pathname.split('/');
            const job = get(parts[2]);
            job.controller.signal.throwIfAborted();
            if (parts.length !== 5) throw new Error('无效媒体路径');
            if (parts[3] === 'enhanced' && request.method === 'PUT') {
                const index = Number(parts[4]), state = job.upscale;
                if (!state || !/^\d+$/.test(parts[4]) || !Number.isSafeInteger(index) || index < 0 || index >= state.frames.length || state.uploads.has(index) || job.finishing || !request.body) throw Error('无效的视频增强帧');
                const file = join(job.path, `enhanced-${String(index).padStart(9, '0')}.png`);
                const upload = pipeline(Readable.fromWeb(request.body), createWriteStream(file, { flags: 'wx' }), { signal: job.controller.signal }).then(async () => {
                    const handle = await open(file, 'r');
                    try {
                        const header = Buffer.alloc(24), { bytesRead } = await handle.read(header, 0, 24, 0);
                        if (bytesRead !== 24 || !header.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || header.toString('ascii', 12, 16) !== 'IHDR' || header.readUInt32BE(16) !== state.meta.width * 3 || header.readUInt32BE(20) !== state.meta.height * 3) throw Error('AI 增强帧尺寸或格式不正确，已停止处理');
                    } finally { await handle.close(); }
                });
                state.uploads.set(index, upload); await upload;
                return new Response(null, { status: 204 });
            }
            if (parts[3] === 'input' && request.method === 'PUT') {
                const index = Number(parts[4]);
                if (!/^\d+$/.test(parts[4]) || index < 0 || index >= job.count || job.running || job.uploads.has(index) || !request.body) throw new Error('无效媒体输入');
                const upload = pipeline(Readable.fromWeb(request.body), createWriteStream(input(job, index), { flags: 'wx' }), { signal: job.controller.signal }).then(() => job.received.add(index));
                job.uploads.set(index, upload);
                await upload;
                return new Response(null, { status: 204 });
            }
            const item = job.outputs.get(parts[4]);
            if (parts[3] !== 'output' || request.method !== 'GET' || !item || basename(item.file) !== parts[4]) throw new Error('无效媒体输出');
            const stream = createReadStream(item.file, { signal: job.controller.signal });
            const reading = finished(stream).catch(() => {}).finally(() => job.reads.delete(reading));
            job.reads.add(reading);
            return new Response(Readable.toWeb(stream), { headers: { 'Content-Type': { image: 'image/png', video: 'video/mp4', audio: 'audio/wav', text: 'text/plain; charset=utf-8' }[item.kind], 'Cache-Control': 'no-store' } });
        },
    };
}
module.exports = { createMediaTools };
