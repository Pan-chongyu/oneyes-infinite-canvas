import test from "node:test";
import assert from "node:assert/strict";
import { videoModelCatalog } from "./video-model-catalog";
import { getVideoModelInfo, videoModelConfigError, videoModelOptionName, videoModelOptions } from "./video-model-info";
import type { AiConfig } from "@/stores/use-config-store";

const config = {
    baseUrl: "https://api.oneyes.ai", channels: [{ id: "video", name: "Video", baseUrl: "https://api.oneyes.ai", models: [] }],
    model: "video::wan3.0-video", videoModel: "video::wan3.0-video", vquality: "720", size: "16:9", videoSeconds: "5", videoMode: "reference", videoGenerateAudio: "true",
} as unknown as AiConfig;

test("all 23 models have valid priced options and accept their published client defaults", () => {
    assert.equal(videoModelCatalog.length, 23);
    assert.equal(new Set(videoModelCatalog.map(item => item.id)).size, 23);
    for (const info of videoModelCatalog) {
        const model = `video::${info.id}`;
        const selected = { ...config, model, vquality: info.defaultResolution, size: info.ratios[0], videoSeconds: String(info.defaultSeconds), videoMode: info.modes[0] };
        assert.equal(getVideoModelInfo(selected)?.id, info.id);
        assert.equal(videoModelConfigError(selected), undefined, info.id);
        assert.ok(info.priceLines.length);
        assert.match(videoModelOptionName(selected, model), /¥/);
    }
});

test("labels never change submitted IDs and collapse only a model's aliases in the same channel", () => {
    const canonical = config.model;
    const alias = `${canonical} [480-1080p 2-30s ¥0.385/秒起]`;
    const options = [canonical, alias, "other::wan3.0-video"];
    assert.deepEqual(videoModelOptions(config, options, alias), [alias, options[2]]);
    assert.deepEqual(videoModelOptions(config, options), [canonical, options[2]]);
    assert.match(videoModelOptionName(config, alias), /^wan3.0-video \[/);
    assert.equal(config.model, canonical);
});

test("foreign endpoints and request scripts do not inherit OneYes prices or validation", () => {
    const foreign = { ...config, channels: [{ ...config.channels[0], baseUrl: "https://other.example" }] };
    assert.equal(getVideoModelInfo(foreign), undefined);
    const scripted = { ...config, channels: [{ ...config.channels[0], models: [{ name: "wan3.0-video", capability: "video" as const, script: "return result" }] }] };
    assert.equal(getVideoModelInfo(scripted), undefined);
    assert.equal(getVideoModelInfo(config, "deleted::wan3.0-video"), undefined);
    assert.equal(getVideoModelInfo(config, "video::wan3.0-video-fake"), undefined);
});

test("invalid parameters are reported without silently changing saved settings", () => {
    const saved = { ...config, model: "video::veo-3.1-fast", vquality: "1080", videoSeconds: "6" };
    const before = JSON.stringify(saved);
    assert.match(videoModelConfigError(saved)!, /720p/);
    assert.equal(JSON.stringify(saved), before);
    assert.match(videoModelConfigError({ ...saved, vquality: "720" })!, /8/);
    assert.equal(videoModelConfigError({ ...config, model: "video::wan3.0-video", videoSeconds: "2" }), undefined);
    assert.match(videoModelConfigError({ ...config, model: "video::veo-3.1", videoSeconds: "5" })!, /4 \/ 6 \/ 8/);
    assert.equal(videoModelConfigError({ ...config, model: "video::doubao-seedance-2.0", vquality: "4k" }), undefined);
});
