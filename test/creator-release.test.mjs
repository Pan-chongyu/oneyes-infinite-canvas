import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('creator release pins all six native media runtimes and distributes verified offline models and licenses', async () => {
    const manifest = JSON.parse(await readFile('desktop/media-binaries.json', 'utf8'));
    assert.deepEqual(Object.keys(manifest).sort(), ['darwin-arm64','darwin-x64','linux-arm64','linux-x64','win32-arm64','win32-x64']);
    for (const assets of Object.values(manifest)) for (const asset of assets) {
        assert.match(asset.sha256, /^[a-f0-9]{64}$/);
        assert.ok(asset.url.startsWith('https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/') || asset.url.startsWith('https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-31-12-59/'));
        assert.ok(!asset.name.includes('/') && !asset.name.includes('\\'));
    }
    for (const [file, expected] of [['u2netp','309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8'],['espcn-3x','85f36ff88cc504a24af5e0602148bc56a8aa09a58eca8c0da2756f3e8186035e']]) assert.equal(createHash('sha256').update(await readFile(`web/public/models/${file}.onnx`)).digest('hex'), expected);
    assert.match(await readFile('web/public/models/LICENSE-Apache-2.0.txt', 'utf8'), /Apache License/);
    assert.match(await readFile('web/public/models/LICENSE-ONNX-Runtime.txt', 'utf8'), /MIT License/);
    const workflow = await readFile('.github/workflows/desktop-release.yml', 'utf8');
    assert.ok(workflow.includes('npm run media:prepare') && workflow.includes('npm run test:creators') && workflow.includes('npm run test:creator-codec'));
    const pkg = JSON.parse(await readFile('package.json', 'utf8'));
    const resources = pkg.build.extraResources.find(entry => entry.to === 'media-bin');
    assert.ok(['ffmpeg','ffmpeg.exe','ffprobe','ffprobe.exe','*.LICENSE','SOURCES.txt'].every(name=>resources.filter.includes(name)));
    const media = await readFile('desktop/media-tools.cjs', 'utf8');
    assert.ok(media.includes("'-fps_mode:v', 'vfr'") && !media.includes("'-vsync'"), 'frame extraction must support both bundled FFmpeg generations');
    assert.ok(media.includes("'videoSuperResolution'") && media.includes('prepareUpscale') && media.includes('finishUpscale'));
    assert.match(await readFile('desktop/video-upscale.cjs', 'utf8'), /ffprobe.*show_frames/s);
    assert.match(await readFile('web/src/components/canvas/creator-tools-plugin.tsx', 'utf8'), /视频超采样倍率/);
});
