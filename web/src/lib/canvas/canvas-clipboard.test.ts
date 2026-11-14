import assert from "node:assert/strict";
import test from "node:test";
import { remapCopiedNodeReferences } from "./canvas-clipboard";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const source: CanvasNodeData = { id: "config-copy", type: CanvasNodeType.Config, title: "配置", position: { x: 0, y: 0 }, width: 600, height: 250, metadata: {
    composerContent: "参考 @[node:image-b]、@[node:image-a]、@[node:image-b] 和 @[node:external]，普通文字 image-a 不变",
    prompt: "@[node:image-a]，图片1，@[node:image-aa]",
    groupId: "group", storageKey: "image-a", references: ["image-a"], model: "default::image-a",
    videoPromptSourceId: "video", studio: { sourceIds: ["image-a", "external"], selectedId: "image-a", selectionAdvice: { sourceId: "image-a", reason: "清晰" } },
    directorAssistant: { sourceIds: ["image-a", "external"] },
} };

test("copied references use exact new node IDs while external references and media keys remain intact", () => {
    const before = structuredClone(source);
    const result = remapCopiedNodeReferences(source, new Map([["image-a", "new-a"], ["image-b", "new-b"], ["group", "new-group"], ["video", "new-video"]]));
    assert.equal(result.metadata!.composerContent, "参考 @[node:new-b]、@[node:new-a]、@[node:new-b] 和 @[node:external]，普通文字 image-a 不变");
    assert.equal(result.metadata!.prompt, "@[node:new-a]，图片1，@[node:image-aa]");
    assert.equal(result.metadata!.groupId, "new-group");
    assert.equal(result.metadata!.videoPromptSourceId, "new-video");
    assert.deepEqual(result.metadata!.studio, { sourceIds: ["new-a", "external"], selectedId: "new-a", selectionAdvice: { sourceId: "new-a", reason: "清晰" } });
    assert.deepEqual(result.metadata!.directorAssistant!.sourceIds, ["new-a", "external"]);
    assert.equal(result.metadata!.storageKey, "image-a");
    assert.deepEqual(result.metadata!.references, ["image-a"]);
    assert.equal(result.metadata!.model, "default::image-a");
    assert.deepEqual(source, before, "clipboard must stay immutable for repeated paste");
    assert.equal(remapCopiedNodeReferences(source, new Map([["image-a", "another-a"]])).metadata!.prompt, "@[node:another-a]，图片1，@[node:image-aa]");
});

test("config-only copies keep external references and detach from a group that was not copied", () => {
    const result = remapCopiedNodeReferences(source, new Map());
    assert.equal(result.metadata!.composerContent, source.metadata!.composerContent);
    assert.equal(result.metadata!.videoPromptSourceId, "video");
    assert.deepEqual(result.metadata!.studio, source.metadata!.studio);
    assert.equal(result.metadata!.groupId, undefined);
    assert.deepEqual(remapCopiedNodeReferences({ ...source, metadata: { composerContent: "", prompt: "" } }, new Map()).metadata, { composerContent: "", prompt: "" });
    const empty = { ...source, metadata: undefined };
    assert.equal(remapCopiedNodeReferences(empty, new Map()), empty);
});
