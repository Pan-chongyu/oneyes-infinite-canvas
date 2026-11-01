import { test } from "node:test";
import assert from "node:assert/strict";
import { editSources, editFingerprint, editInputSignature, validateEditAnalysis, validateEditClips, localEditPlan, readEditPlan, editDuration, editSubtitles } from "./smart-edit";
import type { CanvasNodeData } from "@/types/canvas";
import type { EditAnalysis } from "@/types/smart-edit";
const source = { id: "v", type: "video", title: "原片", position: { x: 0, y: 0 }, width: 300, height: 200, metadata: { storageKey: "original.mp4" } } as CanvasNodeData;
const analysis: EditAnalysis = {
    fingerprint: "test",
    sources: [
        {
            id: "v",
            kind: "video",
            title: "原片",
            duration: 10,
            width: 1920,
            height: 1080,
            fps: 30,
            audioTracks: 2,
            silence: [
                { start: 2, end: 4 },
                { start: 7, end: 9 },
            ],
            scenes: [0, 3, 6],
            cues: [
                { start: 0, end: 2, text: "开场" },
                { start: 4, end: 7, text: "产品介绍", speaker: "主持人" },
                { start: 9, end: 10, text: "结束" },
            ],
        },
    ],
};
test("silence, scene and text plans retain exact source timing and reject mute-video silence editing", () => {
    assert.deepEqual(
        localEditPlan(analysis, "silence", 0.1).map((c) => [c.start, c.end]),
        [
            [0, 2.1],
            [3.9, 7.1],
            [8.9, 10],
        ],
    );
    assert.deepEqual(
        localEditPlan(analysis, "scenes", 0).map((c) => [c.start, c.end]),
        [
            [0, 3],
            [3, 6],
            [6, 10],
        ],
    );
    assert.equal(localEditPlan(analysis, "text", 0)[1].label, "产品介绍");
    assert.throws(() => localEditPlan({ ...analysis, sources: [{ ...analysis.sources[0], audioTracks: 0 }] }, "silence", 0), /没有音轨/);
    assert.deepEqual(localEditPlan({ ...analysis, sources: [{ ...analysis.sources[0], silence: [{ start: 0, end: 10 }] }] }, "silence", 0), []);
    assert.equal(localEditPlan({ ...analysis, sources: [{ ...analysis.sources[0], kind: "image", cues: undefined }] }, "text", 0).length, 1);
    assert.throws(() => localEditPlan(analysis, "silence", NaN));
});
test("plans validate model output rather than clamp times, replace sources, or replay a request", () => {
    const valid = { rationale: "字幕编排", clips: [{ sourceId: "v", start: 4, end: 7, label: "重点" }] };
    const result = readEditPlan(JSON.stringify(valid), analysis);
    assert.equal(result.clips[0].enabled, true);
    for (const clip of [
        { sourceId: "missing", start: 0, end: 1, label: "x" },
        { sourceId: "v", start: 0, end: 11, label: "x" },
        { sourceId: "v", start: -1, end: 1, label: "x" },
        { sourceId: "v", start: 2, end: 1, label: "x" },
    ])
        assert.throws(() => readEditPlan(JSON.stringify({ ...valid, clips: [clip] }), analysis));
    assert.throws(() => readEditPlan("not json", analysis));
    assert.throws(() => readEditPlan('{"rationale":"a","clips":[]}', analysis));
    assert.throws(() => validateEditClips([result.clips[0], result.clips[0]], analysis));
    assert.throws(() => validateEditClips([{ ...result.clips[0], enabled: false }], analysis));
});
test("subtitle remapping follows selected order, repeated sources and dissolve midpoints", () => {
    const clips = localEditPlan(analysis, "text", 0);
    assert.equal(editDuration(clips, 0.2), 5.6);
    const reordered = [clips[2], { ...clips[0], enabled: false }, clips[1], { ...clips[2], id: "repeat" }];
    const srt = editSubtitles(reordered, analysis, 0.2);
    assert.match(srt, /00:00:00,000 --> 00:00:00,900\n结束/);
    assert.match(srt, /00:00:00,900 --> 00:00:03,700\n产品介绍/);
    assert.match(srt, /00:00:03,700 --> 00:00:04,600\n结束/);
    assert.throws(() => editDuration(clips, 0.5), /一半/);
});
test("source identity excludes movement while tracking original media, subtitles and explicit source links", () => {
    const subtitle = { ...source, id: "s", type: "studio:subtitles", metadata: { studio: { cues: analysis.sources[0].cues } } } as CanvasNodeData;
    const tool = { ...source, id: "tool", metadata: { smartEdit: { sourceIds: ["s", "v", "v"] } } };
    assert.deepEqual(
        editSources(tool, [source, subtitle], []).map((s) => s.id),
        ["s", "v"],
    );
    assert.throws(() => editSources(tool, [source], []), /删除/);
    const moved = { ...source, position: { x: 5, y: 8 }, metadata: { ...source.metadata, status: "success" as const } };
    assert.equal(editInputSignature([source]), editInputSignature([moved]));
    assert.notEqual(editFingerprint([source], {}), editFingerprint([{ ...source, metadata: { storageKey: "new.mp4" } }], {}));
    assert.notEqual(editFingerprint([source], {}), editFingerprint([source], { silenceDb: -20 }));
    assert.notEqual(editFingerprint([source, subtitle], {}, [{ fromNodeId: "v", toNodeId: "s" }]), editFingerprint([source, subtitle], {}, []));
    assert.throws(() => validateEditAnalysis([{ ...analysis.sources[0], scenes: [2] }], [source], "x"));
    assert.throws(() =>
        validateEditAnalysis(
            [
                {
                    ...analysis.sources[0],
                    silence: [
                        { start: 1, end: 3 },
                        { start: 2, end: 4 },
                    ],
                },
            ],
            [source],
            "x",
        ),
    );
});
