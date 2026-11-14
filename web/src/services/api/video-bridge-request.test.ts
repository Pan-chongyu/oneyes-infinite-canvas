import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { videoModelCatalog } from "@/lib/video-model-catalog";
import { buildVideoBridgeRequest, usesVideoBridgeRequest, videoBridgeMediaUrl, type VideoBridgeMedia } from "./video-bridge-request";

const empty = (): VideoBridgeMedia => ({ images: [], imageDataUrls: [], videos: [], audios: [] });
const info = (id: string) => videoModelCatalog.find(model => model.id === id)!;
const config = (id: string) => {
    const model = info(id);
    return { videoSeconds: String(model.defaultSeconds), vquality: model.defaultResolution, size: model.ratios.includes("16:9") ? "16:9" : model.ratios[0], videoMode: model.modes[0], videoGenerateAudio: "true", videoWatermark: "false" };
};
const image = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "reference.png", { type: "image/png" });
const imageUrl = "data:image/png;base64,iVBORw0KGgo=";
const video = new File([new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109])], "reference.mp4", { type: "video/mp4" });

test("only the 18 verified non-Grok/non-Kling adapters use the new request builder", () => {
    assert.equal(videoModelCatalog.filter(usesVideoBridgeRequest).length, 18);
    for (const model of videoModelCatalog.filter(model => /^(?:grok-|kling-)/.test(model.id))) assert.equal(usesVideoBridgeRequest(model), false, model.id);
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
    assert.throws(() => buildVideoBridgeRequest(wan, { ...config(wan.id), videoMode: "frames" }, wan.id, "fixture", media), /不能与参考视频或音频混用/);
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
    assert.throws(() => buildVideoBridgeRequest(veo, { ...config(veo.id), videoSeconds: "4", videoMode: "reference" }, veo.id, "fixture", { ...empty(), imageDataUrls: [imageUrl] }), /固定生成 8 秒/);
    const gemini = info("gemini-omni-flash-1.2");
    assert.throws(() => buildVideoBridgeRequest(gemini, { ...config(gemini.id), videoMode: "reference" }, gemini.id, "fixture", { ...empty(), videos: ["https://cdn.example.com/reference.mp4"] }), /不自动切换编辑方式/);
    const request = buildVideoBridgeRequest(gemini, { ...config(gemini.id), videoMode: "reference", videoSeconds: "3" }, gemini.id, "fixture", { ...empty(), imageDataUrls: [imageUrl], videos: ["https://cdn.example.com/reference.mp4"] });
    assert.deepEqual(request.body, { model: gemini.id, prompt: "fixture", resolution: "720p", duration: 3, ratio: "16:9", images: [imageUrl], metadata: { video_mode: "reference" }, videos: ["https://cdn.example.com/reference.mp4"] });
    assert.throws(() => buildVideoBridgeRequest(veo, config(veo.id), veo.id, "fixture", { ...empty(), imageDataUrls: ["data:image/webp;base64,AAAA"] }), /仅接受 PNG \/ JPEG/);
});

test("reference videos are never disguised as inline files or credential-bearing URLs", () => {
    for (const value of [undefined, "blob:local-video", "data:video/mp4;base64,AAAA", "file:///clip.mp4", "http://cdn.example/clip.mp4", "https://user:secret@cdn.example/clip.mp4"]) assert.throws(() => videoBridgeMediaUrl(value, "视频"), /公开 HTTPS/);
    assert.equal(videoBridgeMediaUrl("https://cdn.example/clip.mp4?signature=fixture", "视频"), "https://cdn.example/clip.mp4?signature=fixture");
});

test("verified request fixtures pass the actual deployed bridge normalizers when supplied", { skip: !process.env.ONEYES_BRIDGE_TEST_DIRECTORY }, async () => {
    const dir = process.env.ONEYES_BRIDGE_TEST_DIRECTORY!;
    const bridge88 = (await import(pathToFileURL(`${dir}/88api-request.mjs`).href)).default;
    const bridgeZY = (await import(pathToFileURL(`${dir}/zhiying-request.mjs`).href)).default;
    for (const model of videoModelCatalog.filter(usesVideoBridgeRequest)) {
        const request = buildVideoBridgeRequest(model, config(model.id), model.id, "offline fixture", empty());
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
});
