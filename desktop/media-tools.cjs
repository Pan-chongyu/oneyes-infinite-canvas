const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { join, basename } = require('node:path');
const { mkdir, rm, readdir, writeFile, stat } = require('node:fs/promises');
const { createWriteStream, createReadStream } = require('node:fs');
const { Readable } = require('node:stream');
const { pipeline, finished } = require('node:stream/promises');

// Structured commands and opaque job IDs only. Renderer input never becomes a path or shell command.
function createMediaTools({ directory, binaries, changed = () => {} }) {
    const jobs = new Map();
    const root = join(directory, 'media-work');
    const ready = rm(root, { recursive: true, force: true }).then(() => mkdir(root, { recursive: true }));
    ready.catch(() => {}); // A media-directory error must not prevent the rest of the app from opening.
    const binary = name => join(binaries, name + (process.platform === 'win32' ? '.exe' : ''));
    const notify = (job, stage, progress) => changed({ id: job.id, stage, ...(Number.isFinite(progress) ? { progress: Math.max(0, Math.min(100, progress)) } : {}) });
    const get = id => { const job = jobs.get(id); if (!job) throw new Error('处理任务已结束，请重新开始'); return job; };
    const run = (job, name, args, line = () => {}) => new Promise((resolve, reject) => {
        job.controller.signal.throwIfAborted();
        const formats = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,mpeg,mpegts,ogg,flv,asf,rm'];
        // Uploaded media must be self-contained, never a playlist reading paths or network URLs.
        if (name === 'ffprobe') args = [...formats, ...args];
        else if (!args.includes('concat')) { args = [...args]; args.splice(args.indexOf('-i'), 0, ...formats); }
        const child = spawn(binary(name), args, { shell: false, windowsHide: true, signal: job.controller.signal });
        let stdout = '', pending = '';
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { pending += chunk; const lines = pending.split(/\r?\n/); pending = lines.pop(); lines.forEach(line); });
        let error;
        child.on('error', value => { error = value; });
        child.on('close', code => {
            if (pending) line(pending);
            if (job.controller.signal.aborted) return reject(new Error('已取消本地处理'));
            if (error?.code === 'ENOENT') return reject(new Error('本地媒体组件缺失，请重新安装最新版 OneYes Canvas'));
            if (error || code !== 0) return reject(new Error('无法处理该媒体，请检查文件是否完整及编码是否受支持'));
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
        return { video, audios: data.streams.filter(stream => stream.codec_type === 'audio'), duration: Number(data.format.duration), width: rotated ? video.height : video.width, height: rotated ? video.width : video.height, fps: numerator / denominator };
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
        const metadata = [];
        for (let index = 0; index < job.count; index++) metadata.push(await probe(job, input(job, index)));
        const results = [];
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
    return {
        async create(operation, count, options = {}) {
            if (!['analyze', 'concat'].includes(operation) || !Number.isSafeInteger(count) || count < 1 || (operation === 'analyze' && count !== 1)) throw new Error('无效的媒体处理任务');
            if (operation === 'analyze' && (!Number.isFinite(options.threshold) || options.threshold < 0 || options.threshold > 1)) throw new Error('请设置有效的镜头检测灵敏度');
            if (operation === 'concat' && !Array.isArray(options.trims)) throw new Error('请设置视频片段顺序');
            await ready;
            const id = randomUUID(), path = join(root, id);
            await mkdir(path);
            jobs.set(id, { id, path, operation, count, options, uploads: new Map(), received: new Set(), outputs: new Map(), reads: new Set(), controller: new AbortController() });
            return id;
        },
        async start(id) { const job = get(id); if (!job.running) job.running = processJob(job); return job.running; },
        async release(id) { const job = jobs.get(id); if (!job) return; job.controller.abort(); await Promise.allSettled([...job.uploads.values(), ...job.reads, ...(job.running ? [job.running] : [])]); jobs.delete(id); await rm(job.path, { recursive: true, force: true }); },
        async close() { await Promise.allSettled([...jobs.keys()].map(id => this.release(id))); },
        async request(request) {
            const url = new URL(request.url), parts = url.pathname.split('/');
            const job = get(parts[2]);
            job.controller.signal.throwIfAborted();
            if (parts.length !== 5) throw new Error('无效媒体路径');
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
