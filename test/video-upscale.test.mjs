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
const exec = promisify(execFile);
const probe = async file => JSON.parse((await exec(binary('ffprobe'), ['-v','error','-show_streams','-show_format','-of','json',file])).stdout);
const frames = async file => JSON.parse((await exec(binary('ffprobe'), ['-v','error','-select_streams','v:0','-show_frames','-show_entries','frame=best_effort_timestamp_time,pkt_duration_time,duration_time','-of','json',file])).stdout).frames;

test('video upscale preserves VFR, last frame duration, rotation, all audio and exact chosen pixels; rejects invalid frames and cleans cancellation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'canvas-upscale-'));
    const engine = createMediaTools({ directory: dir, binaries });
    const put = (id, path, bytes) => engine.request(new Request(`oneyes-canvas://app/media-tools/${id}/${path}`, { method:'PUT',body:bytes }));
    try {
        const source = join(dir,'source.mp4');
        const timeline=join(dir,'timeline.mp4');
        await exec(binary('ffmpeg'), ['-nostdin','-y','-f','lavfi','-i','testsrc2=s=32x24:r=5','-frames:v','3','-vf',"setpts='if(eq(N,2),3,N)/(5*TB)'",'-fps_mode:v','passthrough','-c:v','libx264','-pix_fmt','yuv420p',timeline]);
        await exec(binary('ffmpeg'), ['-nostdin','-y','-i',timeline,'-f','lavfi','-i','sine=frequency=440:duration=1.2','-f','lavfi','-i','sine=frequency=880:duration=1.2','-map','0:v','-map','1:a','-map','2:a','-c:v','copy','-c:a','aac',source]);
        const bytes = await readFile(source), expected = await frames(source);
        assert.equal(expected.length,3);
        const execute = async (file, scale) => {
            const original=await readFile(file), id=await engine.create('videoSuperResolution',1,{scale});
            await put(id,'input/0',original);
            const decoded = await engine.start(id);
            // Native transport/timeline test only. Real neural inference is independently
            // exercised through the packaged ONNX Worker in test:creator-codec.
            for (const [index, frame] of decoded.entries()) {
                const response=await engine.request(new Request(`oneyes-canvas://app/media-tools/${id}/output/${frame.name}`));
                const input=join(dir,`input-${index}.png`), output=join(dir,`output-${index}.png`);
                await writeFile(input,Buffer.from(await response.arrayBuffer()));
                await exec(binary('ffmpeg'),['-nostdin','-y','-i',input,'-vf','scale=iw*3:ih*3',output]);
                await put(id,`enhanced/${index}`,await readFile(output));
            }
            const result=(await engine.finish(id))[0];
            const response=await engine.request(new Request(`oneyes-canvas://app/media-tools/${id}/output/${result.name}`));
            const saved=join(dir,`result-${scale}.mp4`); await writeFile(saved,Buffer.from(await response.arrayBuffer()));
            const info=await probe(saved), actual=await frames(saved), before=await probe(file), originalFrames=await frames(file);
            assert.equal(actual.length,originalFrames.length);
            actual.forEach((frame,index)=>assert.ok(Math.abs(Number(frame.best_effort_timestamp_time)-Number(actual[0].best_effort_timestamp_time)-(Number(originalFrames[index].best_effort_timestamp_time)-Number(originalFrames[0].best_effort_timestamp_time)))<0.000002));
            const duration=frame=>Number(frame.duration_time??frame.pkt_duration_time);
            assert.ok(Math.abs(duration(actual.at(-1))-duration(originalFrames.at(-1)))<0.000002,'last real frame keeps its complete duration');
            assert.equal(info.streams.filter(stream=>stream.codec_type==='audio').length,before.streams.filter(stream=>stream.codec_type==='audio').length);
            assert.ok(Math.abs(Number(info.format.duration)-Number(before.format.duration))<0.03,'audio tail is not truncated at video end');
            assert.deepEqual(await readFile(file),original);
            await engine.release(id);
            return info.streams.find(stream=>stream.codec_type==='video');
        };
        for(const scale of [2,3]){const video=await execute(source,scale);assert.equal(video.width,32*scale);assert.equal(video.height,24*scale);}
        const rotated=join(dir,'rotated.mp4');await exec(binary('ffmpeg'),['-nostdin','-y','-display_rotation:v:0','90','-i',source,'-map','0','-c','copy',rotated]);
        const portrait=await execute(rotated,3);assert.equal(portrait.width,72);assert.equal(portrait.height,96);assert.ok(!portrait.side_data_list?.some(item=>item.rotation));
        await assert.rejects(engine.create('videoSuperResolution',2,{scale:3}));
        await assert.rejects(engine.create('videoSuperResolution',1,{scale:4}));
        const invalid=await engine.create('videoSuperResolution',1,{scale:3});await put(invalid,'input/0',bytes);await engine.start(invalid);
        await assert.rejects(engine.finish(invalid),/全部视频帧/); await engine.release(invalid);
        const corrupt=await engine.create('videoSuperResolution',1,{scale:3});await put(corrupt,'input/0',bytes);await engine.start(corrupt);
        await assert.rejects(put(corrupt,'enhanced/0',Buffer.from('not png')),/尺寸或格式/);await engine.release(corrupt);
        const cancel=await engine.create('videoSuperResolution',1,{scale:3});await put(cancel,'input/0',bytes);
        const preparing=engine.start(cancel), rejection=assert.rejects(preparing,/取消|aborted/i);await engine.release(cancel);await rejection;
        assert.deepEqual(await readdir(join(dir,'media-work')),[]);
    } finally { await engine.close(); await rm(dir,{recursive:true,force:true}); }
});
