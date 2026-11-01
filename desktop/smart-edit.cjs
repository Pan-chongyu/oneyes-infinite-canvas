const { join } = require('node:path');
const { mkdir, copyFile, writeFile } = require('node:fs/promises');

// Uses the host's fixed FFmpeg/FFprobe binaries. No shell, user paths, scripts or external URLs.
function validateSmartEdit(operation, count, options) {
    if (!Array.isArray(options.kinds) || options.kinds.length !== count || options.kinds.some(kind => !['video', 'image', 'audio'].includes(kind))) throw Error('剪辑素材类型无效');
    const positive = key => Number.isFinite(options[key]) && options[key] > 0;
    const nonnegative = key => Number.isFinite(options[key]) && options[key] >= 0;
    if (!positive('imageSeconds')) throw Error('请填写有效的图片展示秒数');
    if (operation === 'editAnalyze') {
        if (options.kinds.includes('audio') || !Number.isFinite(options.silenceDb) || options.silenceDb > 0 || !positive('silenceSeconds') || !nonnegative('sceneThreshold') || options.sceneThreshold > 1) throw Error('静音或镜头分析参数无效');
    } else {
        if (!Array.isArray(options.clips) || !options.clips.length || options.clips.some(c => !c || !Number.isInteger(c.sourceIndex) || c.sourceIndex < 0 || c.sourceIndex >= count || options.kinds[c.sourceIndex] === 'audio' || !Number.isFinite(c.start) || !Number.isFinite(c.end) || c.start < 0 || c.end <= c.start)) throw Error('剪辑片段或时间无效');
        if (!['original', 'warm', 'vivid'].includes(options.color) || !['transition', 'audioFade', 'originalVolume', 'musicVolume'].every(nonnegative) || typeof options.title !== 'string' || typeof options.srt !== 'string') throw Error('剪辑效果参数无效');
        if (options.srt && !/^\d+\r?\n\d\d:\d\d:\d\d,\d{3} --> /m.test(options.srt)) throw Error('字幕格式无效');
    }
}

async function processSmartEdit(job, { run, input, output, notify, binaries }) {
    const options = job.options;
    const inspect = async index => {
        const info = JSON.parse(await run(job, 'ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', input(job, index)]));
        const video = info.streams.find(s => s.codec_type === 'video'), audios = info.streams.filter(s => s.codec_type === 'audio');
        if (options.kinds[index] === 'audio') { if (!audios.length) throw Error('配乐文件没有可用音轨'); return { audios }; }
        const image = options.kinds[index] === 'image';
        if (!video || !(video.width > 0 && video.height > 0) || image && !['png', 'mjpeg', 'webp'].includes(video.codec_name)) throw Error('无法读取原始画面，请使用完整视频或 PNG/JPEG/WebP 图片');
        const rotation = Number(video.side_data_list?.find(s => s.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0), rotated = Math.abs(rotation % 180) === 90;
        const [n, d = 1] = String(video.avg_frame_rate).split('/').map(Number);
        const [rn, rd = 1] = String(video.r_frame_rate).split('/').map(Number);
        const [sn, sd] = String(video.sample_aspect_ratio || '1:1').split(':').map(Number);
        const sar = image || !sn || !sd ? 1 : rotated ? sd / sn : sn / sd;
        const duration = image ? options.imageSeconds : Number(info.format.duration), fps = image ? 30 : n / d;
        if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(fps) || fps <= 0) throw Error('素材时长或帧率无效');
        return { width: rotated ? video.height : video.width, height: rotated ? video.width : video.height, duration, fps, variableFps: !image && n * rd !== rn * d, sar, audios };
    };
    const metadata = [];
    for (let i = 0; i < job.count; i++) { notify(job, `正在读取原始素材 ${i + 1} / ${job.count}`); metadata.push(await inspect(i)); }
    if (job.operation === 'editAnalyze') {
        const analysis = [];
        for (const [i, meta] of metadata.entries()) {
            const silence = [], scenes = [0];
            if (options.kinds[i] === 'video') {
                let silenceStart;
                const args = ['-nostdin', '-i', input(job, i), '-map', '0:v:0', '-vf', `select='gt(scene,${options.sceneThreshold})',showinfo`];
                // All original audio tracks must be quiet before a period is removed.
                if (meta.audios.length) {
                    const merge = meta.audios.length > 1 ? `${meta.audios.map((_, n) => `[0:a:${n}]`).join('')}amerge=inputs=${meta.audios.length},` : '[0:a:0]';
                    args.push('-filter_complex', `${merge}silencedetect=noise=${options.silenceDb}dB:d=${options.silenceSeconds}[quiet]`, '-map', '[quiet]');
                }
                args.push('-f', 'null', '-');
                notify(job, `正在分析静音与切镜 ${i + 1} / ${job.count}`);
                await run(job, 'ffmpeg', args, line => {
                    const start = line.match(/silence_start:\s*([\d.e+-]+)/), end = line.match(/silence_end:\s*([\d.e+-]+)/), scene = line.match(/pts_time:([\d.e+-]+)/);
                    if (start) silenceStart = Math.max(0, Number(start[1]));
                    if (end && silenceStart !== undefined) { const until = Math.min(meta.duration, Number(end[1])); if (until > silenceStart) silence.push({ start: silenceStart, end: until }); silenceStart = undefined; }
                    if (scene) { const time = Number(scene[1]); if (time > scenes.at(-1) && time < meta.duration) scenes.push(time); }
                });
                if (silenceStart !== undefined && silenceStart < meta.duration) silence.push({ start: silenceStart, end: meta.duration });
            }
            analysis.push({ width: meta.width, height: meta.height, duration: meta.duration, fps: meta.fps, audioTracks: meta.audios.length, silence, scenes });
        }
        await writeFile(join(job.path, 'edit-analysis.json'), JSON.stringify(analysis));
        notify(job, '素材分析完成', 100);
        return [await output(job, 'edit-analysis.json', 'text')];
    }

    const clips = options.clips, first = metadata[clips[0].sourceIndex];
    const visuals = clips.map(c => metadata[c.sourceIndex]);
    const fps = clips.map(c => options.kinds[c.sourceIndex] === 'video' ? metadata[c.sourceIndex].fps : undefined).find(Boolean) || 30;
    if (visuals.some((m, i) => m.width !== first.width || m.height !== first.height || options.kinds[clips[i].sourceIndex] === 'video' && m.fps !== fps)) throw Error('所选画面的原始尺寸或视频帧率不一致；请先主动统一素材，不会自动缩小、裁切或改变帧率');
    if (visuals.some(m => m.variableFps || m.sar !== first.sar)) throw Error('素材使用可变帧率或不同像素比例，请先主动统一；不会静默改变帧率或画面比例');
    const shape = m => JSON.stringify(m.audios.map(a => [a.channels, a.sample_rate, a.channel_layout]));
    const sound = visuals.find(m => m.audios.length), tracks = sound?.audios || [];
    if (visuals.some(m => m.audios.length && shape(m) !== shape(sound))) throw Error('视频音轨结构不一致，请先统一素材；不会丢弃原音轨');
    for (const c of clips) {
        if (c.end > metadata[c.sourceIndex].duration) throw Error('片段结束时间超过原素材，请重新分析或修改时间');
        if (options.transition > 0 && c.end - c.start <= options.transition * 2 || options.audioFade * 2 > c.end - c.start) throw Error('转场或声音淡化时间超过片段可用时长，请减小设置');
    }
    const music = options.kinds.map((kind, i) => kind === 'audio' ? i : -1).filter(i => i >= 0);
    const totalTracks = tracks.length || (music.length ? 1 : 0), pix = first.width % 2 || first.height % 2 ? 'yuv444p' : 'yuv420p';
    const encode = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', pix, '-c:a', 'aac', '-movflags', '+faststart'];
    let duration = 0;
    for (const [i, c] of clips.entries()) {
        const length = c.end - c.start, meta = metadata[c.sourceIndex], filters = [];
        notify(job, `正在渲染片段 ${i + 1} / ${clips.length}`, i / clips.length * 75);
        const args = ['-nostdin', '-y'];
        if (options.kinds[c.sourceIndex] === 'image') args.push('-loop', '1');
        else args.push('-ss', String(c.start));
        args.push('-i', input(job, c.sourceIndex));
        const color = options.color === 'warm' ? ',colorbalance=rs=0.04:bs=-0.04' : options.color === 'vivid' ? ',eq=contrast=1.08:saturation=1.12' : '';
        filters.push(`[0:v:0]settb=AVTB,setpts=PTS-STARTPTS,fps=${fps},setsar=${first.sar},format=${pix}${color}[v]`);
        for (let n = 0; n < totalTracks; n++) {
            const track = tracks[n], layout = track?.channel_layout || ({ 1: 'mono', 2: 'stereo', 6: '5.1', 8: '7.1' }[track?.channels || 2]);
            if (!layout || !/^[\w.()+-]+$/.test(layout)) throw Error('当前音轨布局无法安全处理，请先转换音频格式');
            const start = meta.audios.length ? `[0:a:${n}]asetpts=PTS-STARTPTS` : `anullsrc=r=${Number(track?.sample_rate) || 48000}:cl=${layout}`;
            filters.push(`${start},atrim=duration=${length},apad,atrim=duration=${length},volume=${options.originalVolume},afade=t=in:st=0:d=${options.audioFade},afade=t=out:st=${Math.max(0, length - options.audioFade)}:d=${options.audioFade}[a${n}]`);
        }
        args.push('-filter_complex', filters.join(';'), '-map', '[v]');
        for (let n = 0; n < totalTracks; n++) args.push('-map', `[a${n}]`);
        args.push('-t', String(length), ...encode, join(job.path, `clip-${i}.mp4`));
        await run(job, 'ffmpeg', args);
        duration += length;
    }
    notify(job, '正在编排片段与转场', 78);
    const assembly = join(job.path, 'assembled.mp4');
    if (!options.transition || clips.length === 1) {
        // Keep requested timeline offsets rather than accumulate each MP4's AAC/frame rounding.
        await writeFile(join(job.path, 'edit-list.txt'), clips.map((c, i) => `file 'clip-${i}.mp4'\nduration ${c.end - c.start}`).join('\n'));
        await run(job, 'ffmpeg', ['-nostdin', '-y', '-f', 'concat', '-safe', '1', '-i', join(job.path, 'edit-list.txt'), '-map', '0:v:0', '-map', '0:a?', '-vf', `fps=${fps}`, ...(totalTracks ? ['-af', 'aresample=async=1:first_pts=0'] : []), '-t', String(duration), ...encode, assembly]);
    } else {
        // Pairwise composition avoids opening every source simultaneously for long timelines.
        let previous = join(job.path, 'clip-0.mp4'), elapsed = clips[0].end - clips[0].start;
        for (let i = 1; i < clips.length; i++) {
            const filters = [`[0:v]settb=AVTB,setpts=PTS-STARTPTS[v0];[1:v]settb=AVTB,setpts=PTS-STARTPTS[v1];[v0][v1]xfade=transition=fade:duration=${options.transition}:offset=${elapsed - options.transition}[v]`];
            for (let n = 0; n < totalTracks; n++) filters.push(`[0:a:${n}][1:a:${n}]acrossfade=d=${options.transition}[a${n}]`);
            const next = i === clips.length - 1 ? assembly : join(job.path, `transition-${i}.mp4`);
            const args = ['-nostdin', '-y', '-i', previous, '-i', join(job.path, `clip-${i}.mp4`), '-filter_complex', filters.join(';'), '-map', '[v]'];
            for (let n = 0; n < totalTracks; n++) args.push('-map', `[a${n}]`);
            await run(job, 'ffmpeg', [...args, '-t', String(elapsed + clips[i].end - clips[i].start - options.transition), ...encode, next]);
            previous = next; elapsed += clips[i].end - clips[i].start - options.transition;
        }
        duration -= (clips.length - 1) * options.transition;
    }
    let final = assembly;
    if (music.length || options.srt || options.title) {
        notify(job, '正在合成配乐、标题与字幕', 90);
        const args = ['-nostdin', '-y', '-i', assembly], filters = [];
        for (const index of music) args.push('-i', input(job, index));
        if (music.length) {
            music.forEach((_, i) => filters.push(`[${i + 1}:a:0]volume=${options.musicVolume},apad,atrim=duration=${duration}[m${i}]`));
            filters.push(`${music.map((_, i) => `[m${i}]`).join('')}amix=inputs=${music.length}:normalize=0,asplit=${totalTracks}${Array.from({ length: totalTracks }, (_, i) => `[music${i}]`).join('')}`);
            for (let i = 0; i < totalTracks; i++) filters.push(`[0:a:${i}][music${i}]amix=inputs=2:duration=first:normalize=0[out${i}]`);
        }
        const videoFilters = [];
        if (options.srt || options.title) {
            await mkdir(join(job.path, 'fonts'));
            await copyFile(join(binaries, 'NotoSansCJKsc-Regular.otf'), join(job.path, 'fonts', 'font.otf'));
        }
        if (options.srt) { await writeFile(join(job.path, 'edit.srt'), options.srt); videoFilters.push("subtitles=filename=edit.srt:fontsdir=fonts:force_style='Fontname=Noto Sans CJK SC'"); }
        if (options.title) {
            await writeFile(join(job.path, 'title.txt'), options.title, 'utf8');
            videoFilters.push(`drawtext=fontfile=fonts/font.otf:textfile=title.txt:expansion=none:fontsize=${Math.max(1, Math.round(first.height / 24))}:fontcolor=white:borderw=1:bordercolor=black:x=(w-tw)/2:y=h/18`);
        }
        if (videoFilters.length) filters.push(`[0:v]${videoFilters.join(',')}[v]`);
        if (filters.length) args.push('-filter_complex', filters.join(';'));
        args.push('-map', videoFilters.length ? '[v]' : '0:v:0');
        for (let i = 0; i < totalTracks; i++) args.push('-map', music.length ? `[out${i}]` : `0:a:${i}`);
        final = join(job.path, 'smart-edit.mp4');
        await run(job, 'ffmpeg', [...args, '-t', String(duration), ...(videoFilters.length ? encode : ['-c:v', 'copy', '-c:a', 'aac', '-movflags', '+faststart']), final]);
    }
    const check = JSON.parse(await run(job, 'ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', final]));
    const video = check.streams.find(s => s.codec_type === 'video');
    if (video?.width !== first.width || video?.height !== first.height || check.streams.filter(s => s.codec_type === 'audio').length !== totalTracks || Math.abs(Number(check.format.duration) - duration) > Math.max(2 / fps, 0.1)) throw Error('成片尺寸、音轨或时长校验未通过，已停止保存；原始素材不变');
    notify(job, '成片校验完成', 100);
    return [await output(job, final === assembly ? 'assembled.mp4' : 'smart-edit.mp4', 'video')];
}
module.exports = { validateSmartEdit, processSmartEdit };
