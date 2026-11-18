import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { videoModelCatalog } from "@/lib/video-model-catalog";
import { buildVideoBridgeRequest, encodeVideoBridgeRequest, usesVideoBridgeRequest, videoBridgeMediaUrl, type VideoBridgeMedia } from "./video-bridge-request";

const empty = (): VideoBridgeMedia => ({ images: [], imageDataUrls: [], videos: [], audios: [] });
const info = (id: string) => videoModelCatalog.find(model => model.id === id)!;
const config = (id: string) => {
    const model = info(id);
    return { videoSeconds: String(model.defaultSeconds), vquality: model.defaultResolution, size: model.ratios.includes("16:9") ? "16:9" : model.ratios[0], videoMode: model.modes[0], videoGenerateAudio: "true", videoWatermark: "false" };
};
const image = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "reference.png", { type: "image/png" });
const imageUrl = "data:image/png;base64,iVBORw0KGgo=";
const video = new File([new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109])], "reference.mp4", { type: "video/mp4" });

test("all 28 audited bridge models use provider-specific requests", () => {
    assert.equal(videoModelCatalog.filter(usesVideoBridgeRequest).length, 28);
    for (const model of videoModelCatalog.filter(model => /^(?:grok-|kling-)/.test(model.id))) assert.equal(usesVideoBridgeRequest(model), true, model.id);
});

test("Zhiying uses supported field names and sends each image once without frame or generic toggle fields", () => {
    const model = info("sd-2.5-fullblood");
    const request = buildVideoBridgeRequest(model, { ...config(model.id), videoMode: "reference" }, model.id, "offline fixture", { ...empty(), images: [image] });
    assert.ok(request.body instanceof FormData);
    assert.deepEqual(Array.from(request.body.keys()), ["model", "prompt", "resolution", "duration", "aspect_ratio", "reference_images"]);
    assert.equal(request.body.getAll("reference_images").length, 1);
    assert.equal(request.body.get("resolution"), "720p");
    assert.equal(request.contentType, undefined, "the transport must generate its multipart boundary");
});

test('discount requests preserve exact priced aliases and upload reference bytes only as multipart files', async () => {
    for (const model of videoModelCatalog.filter(model => model.id.includes('-discount'))) {
        for (const id of [model.id, ...model.aliases]) {
            const request = buildVideoBridgeRequest(model, { ...config(model.id), videoSeconds: '4' }, id, 'fixture', { ...empty(), images: [image, image] });
            assert.ok(request.body instanceof FormData);
            assert.deepEqual([...request.body.keys()], ['model', 'prompt', 'resolution', 'duration', 'aspect_ratio', 'reference_images', 'reference_images']);
            assert.equal(request.body.get('model'), id);
            assert.equal(request.body.get('resolution'), '720p'); assert.equal(request.body.get('duration'), '4');
            for (const part of request.body.getAll('reference_images') as File[]) {
                assert.equal(part.type, image.type); assert.equal(part.name, image.name);
                assert.deepEqual(await part.arrayBuffer(), await image.arrayBuffer());
            }
        }
        for (const seconds of ['3', String(model.duration.max + 1)]) assert.throws(() => buildVideoBridgeRequest(model, { ...config(model.id), videoSeconds: seconds }, model.id, 'fixture', empty()), /支持.*秒/);
        assert.throws(() => buildVideoBridgeRequest(model, config(model.id), model.id, 'fixture', { ...empty(), audios: ['https://fixture.invalid/ref.mp3'] }), /最多支持 0.*音频/);
    }
});

test("Zhiying older video models require actual reference duration; the four probed models do not invent it", () => {
    const old = info("sd-2.5-fullblood");
    assert.throws(() => buildVideoBridgeRequest(old, config(old.id), old.id, "fixture", { ...empty(), videos: [video] }), /实际总时长/);
    const request = buildVideoBridgeRequest(old, config(old.id), old.id, "fixture", { ...empty(), videos: [video], referenceVideoDurationTotal: 2.75 });
    assert.equal((request.body as FormData).get("reference_video_duration_total"), "2.75");
    for (const id of ["sd-2.5-fullblood-line3", "seedance-2.0-official", "seedance-2.0-fast-official", "seedance-2.5-official"]) {
        const body = buildVideoBridgeRequest(info(id), config(id), id, "fixture", { ...empty(), videos: [video] }).body as FormData;
        assert.equal(body.get("reference_video_duration_total"), null, id);
    }
});

test("Wan and Seedance keep media roles separate and preserve selected duration and resolution", () => {
    const wan = info("wan3.0-video");
    const media = { ...empty(), imageDataUrls: [imageUrl], videos: ["https://cdn.example.com/reference.mp4"], audios: ["https://cdn.example.com/reference.wav"] };
    const request = buildVideoBridgeRequest(wan, { ...config(wan.id), videoSeconds: "2", vquality: "1080", videoMode: "reference" }, wan.id, "fixture", media);
    assert.deepEqual(request.body, { model: wan.id, prompt: "fixture", resolution: "1080p", duration: 2, ratio: "16:9", watermark: false, reference_images: [imageUrl], reference_videos: media.videos, reference_audios: media.audios });
    assert.throws(() => buildVideoBridgeRequest(wan, { ...config(wan.id), videoMode: "frames" }, wan.id, "fixture", media), /不能混用参考视频或音频/);
    const seedance = info("doubao-seedance-2.0");
    const seedanceRequest = buildVideoBridgeRequest(seedance, { ...config(seedance.id), vquality: "4k", videoMode: "reference" }, seedance.id, "fixture", media);
    assert.equal((seedanceRequest.body as Record<string, unknown>).resolution, "4k");
    assert.equal((seedanceRequest.body as Record<string, unknown>).generate_audio, true);
});

test("MiniMax uses explicit metadata reference fields and never an unsupported audio toggle", () => {
    const model = info("minimax-h3");
    const request = buildVideoBridgeRequest(model, { ...config(model.id), vquality: "2K", videoMode: "reference" }, model.id, "fixture", { ...empty(), imageDataUrls: [imageUrl], audios: ["data:audio/wav;base64,AAAA"] });
    assert.deepEqual(request.body, { model: model.id, prompt: "fixture", resolution: "2k", duration: 5, ratio: "16:9", metadata: { referenceImages: [imageUrl], referenceAudios: ["data:audio/wav;base64,AAAA"] } });
    assert.throws(() => buildVideoBridgeRequest(model, { ...config(model.id), vquality: "1080", videoMode: "frames" }, model.id, "fixture", { ...empty(), imageDataUrls: [imageUrl] }), /首尾帧仅支持 768p/);
});

test("Google uses native image mode/video fields and does not silently choose edit or extend", () => {
    const veo = info("veo-3.1");
    assert.throws(() => buildVideoBridgeRequest(veo, { ...config(veo.id), videoSeconds: "4", videoMode: "reference" }, veo.id, "fixture", { ...empty(), imageDataUrls: [imageUrl] }), /固定 8 秒/);
    const gemini = info("gemini-omni-flash-1.2");
    assert.throws(() => buildVideoBridgeRequest(gemini, { ...config(gemini.id), videoMode: "reference" }, gemini.id, "fixture", { ...empty(), videos: ["https://cdn.example.com/reference.mp4"] }), /不自动切换编辑方式/);
    const request = buildVideoBridgeRequest(gemini, { ...config(gemini.id), videoMode: "reference", videoSeconds: "3" }, gemini.id, "fixture", { ...empty(), imageDataUrls: [imageUrl], videos: ["https://cdn.example.com/reference.mp4"] });
    assert.deepEqual(request.body, { model: gemini.id, prompt: "fixture", resolution: "720p", duration: 3, ratio: "16:9", images: [imageUrl], metadata: { video_mode: "reference" }, videos: ["https://cdn.example.com/reference.mp4"] });
    assert.throws(() => buildVideoBridgeRequest(veo, config(veo.id), veo.id, "fixture", { ...empty(), imageDataUrls: ["data:image/webp;base64,AAAA"] }), /仅接受 PNG \/ JPEG/);
});

test('Veo Fast new capabilities keep exact request IDs in JSON and binary reference requests', () => {
    const model = info('veo-3.1-fast'), id = model.aliases[0];
    for (const vquality of ['720', '1080', '4k']) for (const videoSeconds of ['4', '6', '8']) {
        const selected = { ...config(model.id), vquality, videoSeconds, videoMode: 'frames' };
        const before = JSON.stringify(selected);
        const request = buildVideoBridgeRequest(model, selected, id, 'fixture', empty());
        assert.equal((request.body as Record<string, unknown>).model, id);
        assert.equal((request.body as Record<string, unknown>).duration, Number(videoSeconds));
        assert.equal(JSON.stringify(selected), before);
    }
    for (const imageDataUrls of [[imageUrl], []]) {
        const images = imageDataUrls.length ? [] : [new File(['original'], 'ref.png', { type: 'image/png' })];
        assert.throws(() => buildVideoBridgeRequest(model, { ...config(model.id), videoMode: 'reference', videoSeconds: '6' }, id, 'fixture', { ...empty(), images, imageDataUrls }), /固定.*8 秒/);
        const valid = buildVideoBridgeRequest(model, { ...config(model.id), vquality: '4k', videoMode: 'reference', videoSeconds: '8' }, id, 'fixture', { ...empty(), images, imageDataUrls });
        assert.equal(valid.body instanceof FormData ? valid.body.get('model') : valid.body.model, id);
    }
});

test("reference videos are never disguised as inline files or credential-bearing URLs", () => {
    for (const value of [undefined, "blob:local-video", "data:video/mp4;base64,AAAA", "file:///clip.mp4", "http://cdn.example/clip.mp4", "https://user:secret@cdn.example/clip.mp4"]) assert.throws(() => videoBridgeMediaUrl(value, "视频"), /公开 HTTPS/);
    assert.equal(videoBridgeMediaUrl("https://cdn.example/clip.mp4?signature=fixture", "视频"), "https://cdn.example/clip.mp4?signature=fixture");
});

test('Grok bridge retains its public image boundary until trusted local upload is deployed', () => {
    for (const id of ['grok-imagine-video', 'grok-imagine-video-1.5']) {
        const model = info(id);
        for (const requestId of [model.id, ...model.aliases]) {
            const frame = buildVideoBridgeRequest(model, config(id), requestId, 'fixture', { ...empty(), imageDataUrls: ['https://cdn.example.com/first.png'] });
            assert.equal((frame.body as Record<string, unknown>).image, 'https://cdn.example.com/first.png');
            for (const value of ['data:image/webp;base64,UklGRg==', 'data:video/mp4;base64,AAAA', 'file:///local.png', 'blob:local-image', 'http://cdn.example/ref.png', 'https://user:secret@cdn.example/ref.png']) assert.throws(() => buildVideoBridgeRequest(model, config(id), requestId, 'fixture', { ...empty(), imageDataUrls: [value] }), /公开 HTTPS/);
        }
    }
});

test("verified request fixtures pass the actual deployed bridge normalizers when supplied", { skip: !process.env.ONEYES_BRIDGE_TEST_DIRECTORY }, async () => {
    const dir = process.env.ONEYES_BRIDGE_TEST_DIRECTORY!;
    const bridge88 = (await import(pathToFileURL(`${dir}/88api-request.mjs`).href)).default;
    const bridgeZY = (await import(pathToFileURL(`${dir}/zhiying-request.mjs`).href)).default;
    for (const model of videoModelCatalog.filter(usesVideoBridgeRequest)) {
        const fixtureMedia = model.id === "kling-3.0-motion-control" ? { ...empty(), imageDataUrls: [imageUrl], videos: ["https://cdn.example.com/motion.mp4"], referenceVideoDurationTotal: 5 }
            : model.id === 'grok-imagine-video-1.5' ? { ...empty(), imageDataUrls: ['https://cdn.example.com/image.png'] } : empty();
        const request = buildVideoBridgeRequest(model, config(model.id), model.id, "offline fixture", fixtureMedia);
        const http = new Request("https://fixture.invalid", { method: "POST", body: request.body instanceof FormData ? request.body : JSON.stringify(request.body), headers: request.contentType ? { "Content-Type": request.contentType } : undefined });
        const body = Buffer.from(await http.arrayBuffer());
        const adapter = model.provider === "zhiying" ? bridgeZY : bridge88;
        assert.doesNotThrow(() => adapter.normalizeCreateBody({ requestBuffer: body }, http.headers.get("Content-Type")), model.id);
    }
    for (const id of ["sd-2.5-fullblood", "sd-2.5-fullblood-line3"]) {
        const request = buildVideoBridgeRequest(info(id), config(id), id, "offline fixture", { ...empty(), images: [image], videos: [video], referenceVideoDurationTotal: 3 });
        const http = new Request("https://fixture.invalid", { method: "POST", body: request.body as FormData });
        const plan = bridgeZY.normalizeCreateBody({ requestBuffer: Buffer.from(await http.arrayBuffer()) }, http.headers.get("Content-Type"));
        assert.equal(plan.pendingFiles.length, 2);
        assert.equal(plan.payload.reference_images.length, 1);
        assert.equal(plan.payload.reference_videos.length, 1);
    }
    for (const model of videoModelCatalog.filter(model => model.id.includes('-discount'))) {
        const encoded = await encodeVideoBridgeRequest(buildVideoBridgeRequest(model, config(model.id), model.aliases[0], 'offline image fixture', { ...empty(), images: [image, image] }), model);
        const plan = bridgeZY.normalizeCreateBody({ requestBuffer: Buffer.from(await encoded.body.arrayBuffer()) }, encoded.contentType);
        assert.equal(plan.model, model.id); assert.equal(plan.pendingFiles.length, 2); assert.equal(plan.payload.reference_images.length, 2);
        for (const file of plan.pendingFiles) assert.deepEqual(file.bytes, Buffer.from(await image.arrayBuffer()));
    }
    for (const id of ["wan3.0-video", "wan3.0-video-prime", "doubao-seedance-2.0", "doubao-seedance-2.5", "minimax-h3", "veo-3.1", "veo-3.1-fast", "gemini-omni-flash-1.1", "gemini-omni-flash-1.2"]) {
        const model = info(id);
        for (const mode of ["frames", "reference"] as const) {
            const selected = { ...config(id), videoMode: mode, size: id === "doubao-seedance-2.5" && mode === "frames" ? "auto" : "16:9" };
            const request = buildVideoBridgeRequest(model, selected, id, "offline image fixture", { ...empty(), imageDataUrls: [imageUrl] });
            const plan = bridge88.normalizeCreateBody({ requestBuffer: Buffer.from(JSON.stringify(request.body)) }, "application/json");
            const sent = JSON.parse((plan.body || Buffer.from(JSON.stringify(request.body))).toString());
            assert.equal(sent.model, id);
            assert.equal(sent.duration, model.defaultSeconds);
            if (id.startsWith("wan")) assert.equal(sent.media.length, 1);
            if (id.startsWith("doubao")) assert.ok(mode === "frames" ? sent.metadata.firstFrame === imageUrl : sent.images[0] === imageUrl);
        }
    }
    for (const id of ["wan3.0-video", "doubao-seedance-2.0", "doubao-seedance-2.5", "gemini-omni-flash-1.1", "gemini-omni-flash-1.2"]) {
        const model = info(id);
        const request = buildVideoBridgeRequest(model, { ...config(id), videoMode: "reference" }, id, "offline reference fixture", { ...empty(), imageDataUrls: [imageUrl], videos: ["https://cdn.example.com/reference.mp4"] });
        assert.doesNotThrow(() => bridge88.normalizeCreateBody({ requestBuffer: Buffer.from(JSON.stringify(request.body)) }, "application/json"), `${id} reference video`);
    }
    for (const id of ['wan3.0-video', 'wan3.0-video-prime', 'veo-3.1', 'veo-3.1-fast', 'gemini-omni-flash-1.1', 'gemini-omni-flash-1.2']) for (const mode of ['frames', 'reference'] as const) {
        const model = info(id), selected = { ...config(id), videoMode: mode, ...(id === 'veo-3.1' ? { videoSeconds: '8' } : {}) };
        const request = await encodeVideoBridgeRequest(buildVideoBridgeRequest(model, selected, id, 'binary fixture', { ...empty(), images: [image, image] }), model);
        const bytes = Buffer.from(await request.body.arrayBuffer());
        const plan = bridge88.normalizeCreateBody({ requestBuffer: bytes }, request.contentType);
        assert.ok(plan); assert.ok(!bytes.includes(Buffer.from('data:image/')));
    }
});

test('bridge counts exact 128 MiB serialized binary bytes including boundary and UTF-8', async () => {
    const model = info('seedance-2.0-official'), unit = 1024 * 1024;
    const request = (first: number, second: number) => buildVideoBridgeRequest(model, config(model.id), model.id, '中文🎬', { ...empty(), videos: [new File([new Uint8Array(first)], 'a.mp4'), new File([new Uint8Array(second)], 'b.mp4')] });
    const overhead = (await new Response(request(0, 0).body as FormData).blob()).size;
    const accepted = await encodeVideoBridgeRequest(request(64 * unit, 64 * unit - overhead), model);
    assert.equal(accepted.body.size, 128 * unit); assert.match(accepted.contentType, /multipart\/form-data; boundary=/);
    await assert.rejects(encodeVideoBridgeRequest(request(64 * unit, 64 * unit - overhead + 1), model), /超过 128 MiB/);
});

test('multipart sums only text UTF-8 bytes and never counts binary media as inline text', async () => {
    const form = new FormData(), max = 32 * 1024 * 1024;
    form.append('one', '中'.repeat(Math.floor(max / 3))); form.append('two', 'x'.repeat(max % 3));
    form.append('reference_videos', new File([new Uint8Array(33 * 1024 * 1024)], 'clip.mp4'));
    await encodeVideoBridgeRequest({ body: form }, info('seedance-2.0-official'));
    form.append('extra', 'x'); await assert.rejects(encodeVideoBridgeRequest({ body: form }, info('seedance-2.0-official')), /普通文本字段合计超过 32 MiB/);
});

test('per-model file limits and live catalog values remain independent of the 128 MiB envelope', () => {
    const file = (size: number) => new File([new Uint8Array(size)], 'fixture.png', { type: 'image/png' });
    for (const id of ['seedance-2.0-official', 'seedance-2.0-fast-official', 'seedance-2.5-official', 'sd-2.5-fullblood-line3', 'wan3.0-video', ...videoModelCatalog.filter(model => model.id.includes('-discount')).map(model => model.id)]) {
        const max = (id.includes('-discount') ? 30 : id.startsWith('seedance') ? 16 : id.startsWith('sd-') ? 32 : 20) * 1024 * 1024;
        const model = info(id), selected = { ...config(id), videoMode: 'reference' };
        buildVideoBridgeRequest(model, selected, id, 'fixture', { ...empty(), images: [file(max)] });
        assert.throws(() => buildVideoBridgeRequest(model, selected, id, 'fixture', { ...empty(), images: [file(max + 1)] }), /单文件限制/);
    }
    const model = { ...info('seedance-2.0-official'), referenceFileMaxBytes: { image: 12, video: 20, audio: 22 } };
    assert.throws(() => buildVideoBridgeRequest(model, config(model.id), model.id, 'fixture', { ...empty(), images: [file(13)] }), /12 字节/);
    buildVideoBridgeRequest(model, config(model.id), model.id, 'fixture', { ...empty(), images: [file(12)] });
});

test('Wan and Google send local images as binary parts, preserve bytes/order and never add Base64 copies', async () => {
    for (const id of ['wan3.0-video', 'veo-3.1', 'gemini-omni-flash-1.1']) for (const mode of ['frames', 'reference']) {
        const selected = { ...config(id), videoMode: mode, videoSeconds: id === 'veo-3.1' ? '8' : config(id).videoSeconds };
        const body = buildVideoBridgeRequest(info(id), selected, id, 'fixture', { ...empty(), images: [image, image] }).body as FormData;
        const files = [...body.entries()].filter(([, value]) => value instanceof File);
        assert.deepEqual(files.map(([key]) => key), mode === 'frames' ? ['first_frame', 'last_frame'] : [id.startsWith('wan') ? 'reference_images' : 'images', id.startsWith('wan') ? 'reference_images' : 'images']);
        for (const [, file] of files) assert.deepEqual(await (file as File).arrayBuffer(), await image.arrayBuffer());
        assert.ok([...body.values()].every(value => typeof value !== 'string' || !value.includes('data:image/')));
        if (mode === 'frames') assert.throws(() => buildVideoBridgeRequest(info(id), selected, id, 'fixture', { ...empty(), images: [image], videos: ['https://cdn.example/video.mp4'] }), /不能.*混用/);
    }
});

test('MiniMax aggregates only encoded inline media at the exact decimal limit', async () => {
    const request = (extra: number) => ({ body: { model: 'minimax-h3', metadata: { referenceImages: ['data:image/png;base64,' + 'A'.repeat(16_000_000)], referenceAudios: ['data:audio/wav;base64,' + 'A'.repeat(16_000_000 + extra)] } }, contentType: 'application/json' });
    await encodeVideoBridgeRequest(request(0), info('minimax-h3'));
    await assert.rejects(encodeVideoBridgeRequest(request(1), info('minimax-h3')), /32,000,000 字节/);
});

test('Omni duration and material limits reject invalid combinations without rewriting selections', () => {
    for (const [id, max] of [['gemini-omni-flash-1.1', 10], ['gemini-omni-flash-1.2', 15]] as const) {
        for (const seconds of [3, max]) assert.equal((buildVideoBridgeRequest(info(id), { ...config(id), videoSeconds: String(seconds) }, id, 'fixture', empty()).body as Record<string, unknown>).duration, seconds);
        for (const seconds of [2, max + 1, 5.5]) assert.throws(() => buildVideoBridgeRequest(info(id), { ...config(id), videoSeconds: String(seconds) }, id, 'fixture', empty()), /支持.*秒/);
        const selected = { ...config(id), videoMode: 'reference' };
        assert.throws(() => buildVideoBridgeRequest(info(id), selected, id, 'fixture', { ...empty(), imageDataUrls: Array(11).fill(imageUrl) }), /最多支持 10.*图片/);
        assert.equal(selected.videoMode, 'reference');
    }
});
