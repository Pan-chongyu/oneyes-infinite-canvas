import { test } from "node:test";
import assert from "node:assert/strict";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData } from "@/types/canvas";
Object.assign(globalThis, { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, window: {} });
const { defaultConfig } = await import("@/stores/use-config-store");
const { buildGenerationConfig, generationModePatch } = await import("./node-generation-config");

test("image resolution and video ratio survive mode switches, copies and serialization independently", () => {
    const config = { ...defaultConfig, size: "2k@1:1" };
    let node: CanvasNodeData = { id: "config", type: CanvasNodeType.Config, title: "生成配置", position: { x: 0, y: 0 }, width: 400, height: 260, metadata: { generationMode: "image", size: "4k@16:9" } };
    const select = (mode: CanvasGenerationMode) => { node = { ...node, metadata: { ...node.metadata, ...generationModePatch(config, node, mode) } }; };
    select("video");
    node.metadata = { ...node.metadata, size: "9:16", vquality: "1080" };
    assert.equal(buildGenerationConfig(config, node, "image").size, "4k@16:9", "an explicit image action cannot inherit active video size");
    select("text"); select("audio");
    node = JSON.parse(JSON.stringify(node));
    select("image");
    assert.equal(buildGenerationConfig(config, node, "image").size, "4k@16:9");
    // A subsequent edit of active `size` remains authoritative for agents and existing callers.
    node.metadata = { ...node.metadata, size: "2560x1440" };
    select("video");
    assert.equal(buildGenerationConfig(config, node, "video").size, "9:16");
    assert.equal(buildGenerationConfig(config, node, "video").vquality, "1080");
    select("image");
    assert.equal(buildGenerationConfig(config, node, "image").size, "2560x1440");
    assert.deepEqual(generationModePatch(config, node, "image"), {});
});

test("an existing video config never becomes the image resolution when no image settings were saved", () => {
    const config = { ...defaultConfig, size: "4k@1:1" };
    const node: CanvasNodeData = { id: "old-video", type: CanvasNodeType.Config, title: "视频配置", position: { x: 0, y: 0 }, width: 400, height: 260, metadata: { generationMode: "video", size: "9:16", vquality: "720" } };
    const patch = generationModePatch(config, node, "image");
    assert.equal(patch.size, "4k@1:1");
    assert.equal(patch.generationSizes?.video, "9:16");
    assert.equal(node.metadata?.size, "9:16", "source metadata must not be mutated");
});
