import { test } from "node:test";
import assert from "node:assert/strict";
import { imageSizeMismatch, resolveGeminiImageConfig, resolveImageRequestSize } from "./image-request-size";
import { inferMediaRatio, inferMediaScale, inferVideoRatio, selectImageSize } from "./media-size";

test("resolution and ratio choices survive auto ratio, saved node copies and explicit switching", () => {
    let size = selectImageSize("4k", "16:9");
    size = selectImageSize(inferMediaScale(size), "auto");
    size = JSON.parse(JSON.stringify({ metadata: { size } })).metadata.size;
    assert.equal(inferMediaScale(size), "4k");
    assert.equal(inferMediaRatio(size), "auto");
    assert.throws(() => resolveImageRequestSize(size), /选择图片比例/);
    assert.deepEqual(resolveGeminiImageConfig({ size }), { imageConfig: { imageSize: "4K" } });
    size = selectImageSize(inferMediaScale(size), "9:16");
    assert.equal(resolveImageRequestSize(size), "2160x3840");
    assert.equal(inferVideoRatio(size), "9:16", "shared preferences retain the video ratio");
});

test("OpenAI forwards exact selected pixels for all resolution/ratio presets and custom dimensions", () => {
    const fixtures = {
        "1k": ["1024x1024", "1024x1536", "1536x1024", "1024x768", "768x1024", "1536x864", "864x1536", "2016x864", "864x2016"],
        "2k": ["2048x2048", "1360x2048", "2048x1360", "2048x1536", "1536x2048", "2048x1152", "1152x2048", "2688x1152", "1152x2688"],
        "4k": ["2880x2880", "2336x3520", "3520x2336", "3312x2480", "2480x3312", "3840x2160", "2160x3840", "3840x1648", "1648x3840"],
    };
    const ratios = ["1:1", "2:3", "3:2", "4:3", "3:4", "16:9", "9:16", "21:9", "9:21"];
    for (const [scale, pixels] of Object.entries(fixtures)) for (const [i, ratio] of ratios.entries()) {
        assert.equal(resolveImageRequestSize(selectImageSize(scale, ratio)), pixels[i]);
        assert.equal(resolveImageRequestSize(pixels[i]), pixels[i]);
    }
    assert.equal(resolveImageRequestSize("2560x1440"), "2560x1440");
    assert.equal(resolveImageRequestSize("1:1"), "1024x1024");
    assert.equal(resolveImageRequestSize("auto@auto"), undefined);
    for (const size of ["0x1024", "1000x1024", "4096x4096", "3840x3840", "512x512", "4k@1:5", "bad"]) assert.throws(() => resolveImageRequestSize(size));
});

test("Gemini sends native tiers independently from ratio and never rounds custom pixels or ratios", () => {
    for (const scale of ["1k", "2k", "4k"]) {
        assert.deepEqual(resolveGeminiImageConfig({ size: selectImageSize(scale, "16:9") }), { imageConfig: { imageSize: scale.toUpperCase(), aspectRatio: "16:9" } });
        assert.deepEqual(resolveGeminiImageConfig({ size: selectImageSize(scale, "auto") }), { imageConfig: { imageSize: scale.toUpperCase() } });
    }
    assert.deepEqual(resolveGeminiImageConfig({ size: "2048x1536" }), { imageConfig: { imageSize: "2K", aspectRatio: "4:3" } });
    assert.deepEqual(resolveGeminiImageConfig({ size: "auto@16:9" }), { imageConfig: { aspectRatio: "16:9" } });
    for (const size of ["2k@9:21", "auto@7:5", "2560x1440", "3200x1600", "invalid"]) assert.throws(() => resolveGeminiImageConfig({ size }), /不支持/);
});

test("a lower resolution upstream image is retained and reported without interpolation", () => {
    assert.equal(imageSizeMismatch("3840x2160", { width: 3840, height: 2160 }), undefined);
    assert.equal(imageSizeMismatch(undefined, { width: 1024, height: 1024 }), undefined);
    assert.match(imageSizeMismatch("3840x2160", { width: 1536, height: 864 })!, /请求 3840×2160，上游返回 1536×864/);
});
