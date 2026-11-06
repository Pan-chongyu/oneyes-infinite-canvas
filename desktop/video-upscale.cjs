const { join } = require('node:path');
const { readdir, writeFile } = require('node:fs/promises');

// Only locally generated PNG names and probed timestamps enter this concat file.
async function prepareUpscale(job, { run, input, output, probe, notify }) {
    const meta = await probe(job, input(job, 0));
    if (['smpte2084', 'arib-std-b67'].includes(meta.video.color_transfer) || /^(yuva|rgba|bgra|gbrap)/.test(meta.video.pix_fmt || '') || meta.video.tags?.alpha_mode === '1') throw Error('当前视频超采样支持 SDR 不透明视频；HDR 或透明视频请先显式转换，原素材保持不变');
    const timing = JSON.parse(await run(job, 'ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time,pkt_duration_time,duration_time,width,height', '-of', 'json', input(job, 0)]));
    const origin = Number(timing.frames[0]?.best_effort_timestamp_time);
    const frames = timing.frames.map(frame => ({ time: Number(frame.best_effort_timestamp_time) - origin, duration: Number(frame.duration_time ?? frame.pkt_duration_time) }));
    if (!frames.length || frames.some((frame, index) => !Number.isFinite(frame.time) || index && frame.time <= frames[index - 1].time)) throw Error('视频时间轴不完整，无法保持原始帧顺序；原素材保持不变');
    const end = Number(meta.video.duration);
    const last = frames.at(-1);
    if (!(last.duration > 0)) last.duration = Number.isFinite(end) && end > last.time ? end - last.time : 1 / meta.fps;
    if (!Number.isFinite(last.duration) || !(last.duration > 0)) throw Error('无法确定视频末帧时长，已停止处理');
    notify(job, '正在读取原始视频帧');
    await run(job, 'ffmpeg', ['-nostdin', '-y', '-i', input(job, 0), '-map', '0:v:0', '-fps_mode:v', 'passthrough', join(job.path, 'frame-%09d.png')], line => {
        const match = /frame=\s*(\d+)/.exec(line);
        if (match) notify(job, '正在读取原始视频帧', Number(match[1]) / frames.length * 100);
    });
    const names = (await readdir(job.path)).filter(name => /^frame-\d+\.png$/.test(name)).sort((a, b) => Number(a.slice(6, -4)) - Number(b.slice(6, -4)));
    if (names.length !== frames.length) throw Error('原视频帧数与时间轴不一致，已停止处理');
    const results = [];
    for (const [index, name] of names.entries()) results.push({ ...await output(job, name, 'image'), time: frames[index].time });
    const [sarN, sarD] = String(meta.video.sample_aspect_ratio || '1:1').split(':').map(Number);
    const sar = sarN > 0 && sarD > 0 ? [sarN, sarD] : [1, 1];
    const rotation = Number(meta.video.side_data_list?.find(item => item.rotation !== undefined)?.rotation ?? meta.video.tags?.rotate ?? 0);
    if (Math.abs(rotation % 180) === 90) sar.reverse();
    job.upscale = { meta, frames, offset: origin - meta.startTime, sar: sar.join('/'), uploads: new Map() };
    return results;
}

async function finishUpscale(job, { run, input, output, probe, notify }) {
    const state = job.upscale;
    if (!state || state.uploads.size !== state.frames.length) throw Error('请等待全部视频帧完成 AI 增强');
    await Promise.all(state.uploads.values());
    const { meta, frames } = state;
    const filename = index => `enhanced-${String(index).padStart(9, '0')}.png`;
    const timeline = ['ffconcat version 1.0'];
    for (const [index, frame] of frames.entries()) {
        const duration = frames[index + 1] ? frames[index + 1].time - frame.time : frame.duration;
        timeline.push(`file '${filename(index)}'`, 'option framerate 1000000', `duration ${duration.toFixed(6)}`);
    }
    // A terminal frame supplies the last real frame's duration. Remove it with a
    // lossless remux before adding audio; -frames on the final mux would truncate audio.
    timeline.push(`file '${filename(frames.length - 1)}'`, 'option framerate 1000000');
    await writeFile(join(job.path, 'upscale-frames.txt'), timeline.join('\n'));
    const width = meta.width * job.options.scale, height = meta.height * job.options.scale;
    const filter = [job.options.scale === 2 && `scale=${width}:${height}:flags=lanczos`, `setsar=${state.sar}`].filter(Boolean).join(',');
    notify(job, '正在封装 AI 超采样视频');
    const encoded = join(job.path, 'upscale-encoded.mp4'), trimmed = join(job.path, 'upscale-video.mp4');
    await run(job, 'ffmpeg', ['-nostdin', '-y', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'concat,png_pipe', '-f', 'concat', '-safe', '0', '-i', join(job.path, 'upscale-frames.txt'), '-an', '-vf', filter, '-fps_mode:v', 'passthrough', '-enc_time_base:v', '1:1000000', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-bf', '0', '-pix_fmt', width % 2 || height % 2 ? 'yuv444p' : 'yuv420p', '-video_track_timescale', '1000000', encoded]);
    await run(job, 'ffmpeg', ['-nostdin', '-y', '-i', encoded, '-map', '0:v:0', '-c', 'copy', '-frames:v', String(frames.length), trimmed]);
    const name = `AI-video-ESPCN-${job.options.scale}x.mp4`;
    await run(job, 'ffmpeg', ['-nostdin', '-y', '-itsoffset', String(state.offset), '-i', trimmed, '-i', input(job, 0), '-map', '0:v:0', '-map', '1:a?', '-map_metadata', '1', '-metadata:s:v:0', 'rotate=0', '-c:v', 'copy', '-c:a', 'aac', '-movflags', '+faststart', join(job.path, name)]);
    const actual = await probe(job, join(job.path, name));
    const check = JSON.parse(await run(job, 'ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time,pkt_duration_time,duration_time', '-of', 'json', join(job.path, name)]));
    const times = check.frames.map(frame => Number(frame.best_effort_timestamp_time));
    // MP4 rounds to its microsecond track clock; compare at that representable precision.
    if (actual.width !== width || actual.height !== height || actual.audios.length !== meta.audios.length || times.length !== frames.length || times.some((time, index) => Math.abs((time - times[0]) - frames[index].time) > 0.000002)) throw Error('超采样结果的尺寸、时间轴或音轨校验失败，已停止保存；原素材保持不变');
    notify(job, '视频 AI 超采样完成', 100);
    return [await output(job, name, 'video')];
}
module.exports = { prepareUpscale, finishUpscale };
