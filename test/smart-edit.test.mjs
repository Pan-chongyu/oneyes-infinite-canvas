import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const { createMediaTools } = createRequire(import.meta.url)('../desktop/media-tools.cjs');
const binaries = resolve('desktop/media-bin');
const binary = name => join(binaries, name + (process.platform === 'win32' ? '.exe' : ''));
const run = promisify(execFile);
// Fixture-only native diagnostics: synthetic media and generated paths, never user files.
const childProcess = createRequire(import.meta.url)('node:child_process'), nativeSpawn = childProcess.spawn;
childProcess.spawn = (...args) => {
    const child = nativeSpawn(...args); let stderr = '';
    child.stderr?.on('data', chunk => { stderr = (stderr + chunk).slice(-12000); });
    child.on('close', code => { if (code && !args[2]?.signal?.aborted) console.error('Smart-edit fixture FFmpeg failure:', args[1], stderr); });
    return child;
};
const defaults = { kinds: ['video'], silenceDb: -35, silenceSeconds: 0.2, sceneThreshold: 0.3, imageSeconds: 1, color: 'original', transition: 0, audioFade: 0, originalVolume: 1, musicVolume: 0.2, title: '', srt: '' };
test('smart edit uses actual native analysis and render: exact dimensions, order, soundtracks, transitions, images, Unicode and safe cancellation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'canvas-smart-edit-'));
    const engine = createMediaTools({ directory: dir, binaries });
    const upload = (id, i, bytes) => engine.request(new Request(`oneyes-canvas://app/media-tools/${id}/input/${i}`, { method: 'PUT', body: bytes }));
    const job = async (operation, bytes, extra = {}) => {
        const id = await engine.create(operation, bytes.length, { ...defaults, ...extra });
        try {
            for (const [i, data] of bytes.entries()) await upload(id, i, data);
            const [item] = await engine.start(id);
            const response = await engine.request(new Request(`oneyes-canvas://app/media-tools/${id}/output/${item.name}`));
            const result = Buffer.from(await response.arrayBuffer()); assert.equal(result.length, item.bytes);
            return result;
        } finally { await engine.release(id); }
    };
    const probe = async (bytes, name) => {
        const file = join(dir, name + '.mp4'); await writeFile(file, bytes);
        return JSON.parse((await run(binary('ffprobe'), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file])).stdout);
    };
    try {
        for (const color of ['red', 'blue']) await run(binary('ffmpeg'), ['-nostdin', '-y', '-f', 'lavfi', '-i', `color=${color}:s=96x64:r=12:d=2`, '-f', 'lavfi', '-i', "aevalsrc=if(between(t\\,0.5\\,1.5)\\,0.1*sin(2*PI*440*t)\\,0):s=48000:d=2", '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-map', '0:v', '-map', '1:a', '-map', '2:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '2', join(dir, color + '.mp4')]);
        const red = await readFile(join(dir, 'red.mp4')), blue = await readFile(join(dir, 'blue.mp4'));
        const meta = JSON.parse(await job('editAnalyze', [red]));
        assert.equal(meta[0].width, 96); assert.equal(meta[0].height, 64); assert.equal(meta[0].audioTracks, 2);
        assert.equal(meta[0].scenes[0], 0); assert.ok(meta[0].silence.length >= 2);
        assert.ok(meta[0].silence[0].end <= 0.55 && meta[0].silence.at(-1).start >= 1.45, 'speech on one of two audio tracks is retained');
        const clips = [{ sourceIndex: 1, start: 0, end: 1.5 }, { sourceIndex: 0, start: 0.5, end: 2 }];
        const joined = await job('editRender', [red, blue], { kinds: ['video', 'video'], clips });
        const info = await probe(joined, 'joined');
        assert.equal(info.streams[0].width, 96); assert.equal(info.streams[0].height, 64); assert.equal(info.streams.filter(s => s.codec_type === 'audio').length, 2);
        assert.ok(Math.abs(Number(info.format.duration) - 3) < 0.1);
        const first = (await run(binary('ffmpeg'), ['-v', 'error', '-i', join(dir, 'joined.mp4'), '-frames:v', '1', '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer' })).stdout;
        assert.ok(first[2] > first[0] + 100, 'chosen clip order is respected');
        const cutMeta = JSON.parse(await job('editAnalyze', [joined])); assert.ok(cutMeta[0].scenes.some(s => Math.abs(s - 1.5) < 0.1));
        await run(binary('ffmpeg'), ['-nostdin', '-y', '-f', 'lavfi', '-i', 'color=green:s=96x64', '-frames:v', '1', '-threads', '1', join(dir, 'image.png')]);
        const image = await readFile(join(dir, 'image.png'));
        const still = JSON.parse(await job('editAnalyze', [image], { kinds: ['image'] })); assert.equal(still[0].duration, 1);
        await run(binary('ffmpeg'), ['-nostdin', '-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1', join(dir, 'music.wav')]);
        const music = await readFile(join(dir, 'music.wav'));
        const styled = await job('editRender', [red, image, music], { kinds: ['video', 'image', 'audio'], clips: [{ sourceIndex: 0, start: 0, end: 1.5 }, { sourceIndex: 1, start: 0, end: 1 }], transition: 0.25, audioFade: 0.05, color: 'warm', title: "中文 ' : % {标题} \\ 路径", srt: '1\n00:00:00,000 --> 00:00:01,000\n智能剪辑 中文\n' });
        const styledInfo = await probe(styled, 'styled'); assert.equal(styledInfo.streams[0].width, 96); assert.equal(styledInfo.streams.filter(s => s.codec_type === 'audio').length, 2); assert.ok(Math.abs(Number(styledInfo.format.duration) - 2.25) < 0.2);
        const imageOnly = await job('editRender', [image], { kinds: ['image'], clips: [{ sourceIndex: 0, start: 0, end: 1 }] });
        assert.equal((await probe(imageOnly, 'image-only')).streams.filter(s => s.codec_type === 'audio').length, 0);
        const musicOnly = await job('editRender', [image, music], { kinds: ['image', 'audio'], clips: [{ sourceIndex: 0, start: 0, end: 1 }] });
        assert.equal((await probe(musicOnly, 'music-only')).streams.filter(s => s.codec_type === 'audio').length, 1);
        const shortCuts = await job('editRender', [red], { clips: Array.from({ length: 12 }, () => ({ sourceIndex: 0, start: 0.2, end: 0.4 })) });
        assert.ok(Math.abs(Number((await probe(shortCuts, 'fractional-cuts')).format.duration) - 2.4) < 0.17, 'fractional clip timing must not accumulate AAC/frame rounding');
        await run(binary('ffmpeg'), ['-nostdin', '-y', '-f', 'lavfi', '-i', 'color=red:s=48x32:r=24:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(dir, 'different.mp4')]);
        const different = await readFile(join(dir, 'different.mp4'));
        await assert.rejects(job('editRender', [red, different], { kinds: ['video', 'video'], clips: [{ sourceIndex: 0, start: 0, end: 1 }, { sourceIndex: 1, start: 0, end: 1 }] }), /尺寸或视频帧率不一致/);
        await assert.rejects(job('editRender', [red], { clips: [{ sourceIndex: 0, start: 0, end: 3 }] }), /超过原素材/);
        await assert.rejects(job('editRender', [red], { clips: [{ sourceIndex: 0, start: 0, end: 1 }], transition: 0.5 }), /转场/);
        await assert.rejects(engine.create('editRender', 1, { ...defaults, clips: [{ sourceIndex: 0, start: 0, end: NaN }] }));
        await assert.rejects(job('editAnalyze', [Buffer.from('#EXTM3U\n#EXTINF:1,\nhttp://127.0.0.1:1/private\n')]), /无法处理/);
        const id = await engine.create('editAnalyze', 1, defaults); await upload(id, 0, red);
        const pending = assert.rejects(engine.start(id), /取消|aborted/i); await engine.release(id); await pending;
        assert.deepEqual(await readdir(join(dir, 'media-work')), []); assert.deepEqual(await readFile(join(dir, 'red.mp4')), red);
    } finally { await engine.close(); await rm(dir, { recursive: true, force: true }); }
});
