import { test } from "node:test";
import assert from "node:assert/strict";
import { imageUpscalePrompt, reflectPixel, restoreLuminance, validateUpscaleSize } from "./image-upscale";

test("super resolution reflects borders and preserves a one-pixel source", () => {
    assert.deepEqual(Array.from({ length: 9 }, (_, i) => reflectPixel(i - 3, 4)), [3, 2, 1, 0, 1, 2, 3, 2, 1]);
    assert.equal(reflectPixel(-300, 1), 0);
    assert.equal(reflectPixel(300, 1), 0);
});

test("luminance enhancement fits saturated colors without hue clipping or alpha changes", () => {
    const pixels = new Uint8ClampedArray([0, 0, 0, 91]);
    restoreLuminance(200, 255, 0, 0, pixels, 0);
    assert.equal(pixels[0], 255);
    assert.equal(pixels[1], pixels[2]);
    assert.ok(Math.abs(.299 * pixels[0] + .587 * pixels[1] + .114 * pixels[2] - 200) < .5);
    assert.equal(pixels[3], 91);
    restoreLuminance(128, 128, 128, 128, pixels, 0);
    assert.deepEqual([...pixels], [128, 128, 128, 91]);
    assert.throws(() => restoreLuminance(NaN, 0, 0, 0, pixels, 0), /无效像素/);
});

test("model upscale keeps explicit dimensions and rejects automatic, lower or unsupported sizes", () => {
    assert.deepEqual(validateUpscaleSize("2048x1536", "openai", { width: 1024, height: 768 }), { width: 2048, height: 1536 });
    assert.throws(() => validateUpscaleSize("auto", "openai", { width: 10, height: 10 }), /明确/);
    assert.throws(() => validateUpscaleSize("1024x1024", "openai", { width: 1200, height: 1200 }), /小于原图/);
    assert.throws(() => validateUpscaleSize("1001x1001", "openai", { width: 200, height: 200 }), /16/);
    assert.throws(() => validateUpscaleSize("4096x4096", "openai", { width: 200, height: 200 }), /不支持/);
    assert.throws(() => validateUpscaleSize("2048x1024", "gemini", { width: 200, height: 200 }), /任意像素/);
    assert.match(imageUpscalePrompt({ width: 2048, height: 1536 }, "保持文字"), /2048×1536/);
    assert.match(imageUpscalePrompt({ width: 2048, height: 1536 }, "保持文字"), /用户的细节要求：保持文字/);
});
