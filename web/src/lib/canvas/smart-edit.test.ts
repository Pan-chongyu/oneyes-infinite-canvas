import { test } from "node:test";
import assert from "node:assert/strict";
import {
    editSources,
    editFingerprint,
    editInputSignature,
    validateEditAnalysis,
    validateEditClips,
    localEditPlan,
    readEditPlan,
    editDuration,
    editSubtitles,
    splitEditClip,
    trimEditClip,
    resolveEditTextModel,
    editTimeline,
    editAtTime,
    moveEditClip,
    removeEditRange,
    applyEditDraft,
    editTranscript,
    editTranscriptPlan,
} from "./smart-edit";
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
test("transcript selection keeps source order and identity through filters, merges adjacent sentences and never changes originals", () => {
    const multi: EditAnalysis = {
        ...analysis,
        sources: [
            ...analysis.sources,
            {
                ...analysis.sources[0],
                id: "second",
                cues: [
                    { start: 0, end: 1, text: "另一原片" },
                    { start: 1, end: 2, text: "相邻句" },
                ],
            },
        ],
    };
    const original = structuredClone(multi),
        entries = editTranscript(multi);
    const selected = [entries[4].id, entries[1].id, entries[3].id, entries[3].id];
    const next = editTranscriptPlan([], multi, selected, "keep");
    assert.deepEqual(
        next.map((clip) => [clip.sourceId, clip.start, clip.end]),
        [
            ["v", 4, 7],
            ["second", 0, 2],
        ],
    );
    assert.equal(next[1].label, "另一原片 相邻句");
    assert.equal(new Set(next.map((clip) => clip.id)).size, 2);
    assert.deepEqual(multi, original);
    const existing = localEditPlan(multi, "manual", 0);
    const appended = editTranscriptPlan(existing, multi, selected, "append");
    assert.deepEqual(appended.slice(0, 2), existing);
    assert.equal(appended.length, 4);
    assert.throws(() => editTranscriptPlan(existing, multi, ["missing:0"], "keep"), /失效/);
    assert.throws(() => editTranscriptPlan(existing, multi, [], "remove"), /失效/);
    assert.equal(entries.filter((cue) => cue.text.includes("产品"))[0].id, "v:1");
});
test("batch transcript deletion removes all repeated occurrences in one plan and permits an empty undoable edit", () => {
    const original = localEditPlan(analysis, "manual", 0),
        repeated = [...original, { ...original[0], id: "repeat", enabled: false }];
    const before = structuredClone(repeated),
        entries = editTranscript(analysis);
    const next = editTranscriptPlan(repeated, analysis, [entries[0].id, entries[1].id], "remove");
    assert.deepEqual(
        next.map((clip) => [clip.start, clip.end, clip.enabled]),
        [
            [2, 4, true],
            [7, 10, true],
            [2, 4, false],
            [7, 10, false],
        ],
    );
    assert.equal(new Set(next.map((clip) => clip.id)).size, next.length);
    assert.deepEqual(repeated, before);
    const all = { ...analysis, sources: [{ ...analysis.sources[0], cues: [{ start: 0, end: 10, text: "整片" }] }] };
    assert.deepEqual(editTranscriptPlan(original, all, ["v:0"], "remove"), []);
    assert.throws(() => editTranscriptPlan(original, { ...all, sources: [{ ...all.sources[0], cues: [{ start: 0, end: 11, text: "越界" }] }] }, ["v:0"], "keep"), /起止时间无效/);
});
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
test("manual editing keeps full mute media, splits exactly and rejects invalid trims without mutating originals", () => {
    const manual = localEditPlan({ ...analysis, sources: [{ ...analysis.sources[0], audioTracks: 0 }] }, "manual", 0);
    assert.deepEqual(
        manual.map((c) => [c.start, c.end]),
        [[0, 10]],
    );
    const original = manual[0],
        trimmed = trimEditClip(original, 1, 9, analysis.sources[0]);
    const pair = splitEditClip(trimmed, 4);
    assert.deepEqual(
        pair.map((c) => [c.start, c.end]),
        [
            [1, 4],
            [4, 9],
        ],
    );
    assert.equal(pair[0].id, original.id);
    assert.notEqual(pair[1].id, original.id);
    assert.equal(pair[1].sourceId, original.sourceId);
    assert.equal(pair[1].label, original.label);
    assert.equal(editDuration(pair, 0), 8);
    assert.equal(original.start, 0);
    assert.equal(original.end, 10);
    assert.equal(editSubtitles(pair, analysis, 0), editSubtitles([trimmed], analysis, 0));
    for (const time of [1, 9, NaN, Infinity, -1]) assert.throws(() => splitEditClip(trimmed, time), /片段内部/);
    for (const [start, end] of [
        [-1, 2],
        [1, 1],
        [5, 2],
        [0, 11],
        [NaN, 2],
    ])
        assert.throws(() => trimEditClip(original, start, end, analysis.sources[0]), /入点/);
    assert.equal(splitEditClip({ ...trimmed, enabled: false }, 5)[1].enabled, false);
});
test("AI editing resolves the exact configured text channel and blocks missing selections without falling back", () => {
    const models = [
        { value: "vip::model", label: "VIP / model" },
        { value: "svip::model", label: "SVIP / model" },
        { value: "claude::configured", label: "Claude / configured" },
    ];
    const ai = { listModels: (capability?: string) => (capability === "text" ? models : []), defaultModel: () => models[0].value, isModelReady: (model: string) => model !== "svip::model" };
    assert.equal(resolveEditTextModel(ai).value, "vip::model");
    assert.equal(resolveEditTextModel(ai, "claude::configured").value, "claude::configured");
    assert.throws(() => resolveEditTextModel(ai, "svip::model"), /API Key/);
    assert.throws(() => resolveEditTextModel(ai, "removed::model"), /已移除/);
    assert.throws(() => resolveEditTextModel({ ...ai, defaultModel: () => "image::only" }), /默认文本模型/);
    assert.throws(() => resolveEditTextModel({ ...ai, listModels: () => [] }), /没有文本模型/);
});

test("timeline uses renderer overlap, resolves source time and reorders without dropping disabled clips", () => {
    const clips = localEditPlan(analysis, "scenes", 0);
    const timeline = editTimeline(clips, 0.2);
    assert.deepEqual(
        timeline.map(({ start, end }) => [Number(start.toFixed(6)), Number(end.toFixed(6))]),
        [
            [0, 3],
            [2.8, 5.8],
            [5.6, 9.6],
        ],
    );
    assert.equal(editAtTime(clips, 0.2, 3)?.time, 3.2);
    assert.equal(editAtTime(clips, 0.2, 100)?.time, 10);
    assert.equal(editAtTime(clips, 0.2, -1)?.time, 0);
    assert.equal(editAtTime([], 0, 0), undefined);
    assert.equal(editAtTime(clips, 0, NaN), undefined);
    const withDisabled = clips.map((c, i) => ({ ...c, enabled: i !== 1 }));
    const reordered = moveEditClip(withDisabled, clips[2].id, clips[0].id);
    assert.deepEqual(
        reordered.map((c) => c.id),
        [clips[2].id, clips[0].id, clips[1].id],
    );
    assert.equal(reordered[2].enabled, false);
    assert.deepEqual(
        moveEditClip(clips, clips[0].id, clips[1].id, true).map((c) => c.id),
        [clips[1].id, clips[0].id, clips[2].id],
    );
    assert.equal(moveEditClip(clips, "missing", clips[0].id), clips);
    assert.equal(clips[0].start, 0);
});

test("transcript deletion cuts repeated ranges with unique identities and leaves other media intact", () => {
    const full = localEditPlan(analysis, "manual", 0)[0];
    const clips = [full, { ...full, id: "repeat", enabled: false }, { ...full, id: "other", sourceId: "other" }];
    const result = removeEditRange(clips, "v", 4, 7);
    assert.deepEqual(
        result.map((c) => [c.sourceId, c.start, c.end, c.enabled]),
        [
            ["v", 0, 4, true],
            ["v", 7, 10, true],
            ["v", 0, 4, false],
            ["v", 7, 10, false],
            ["other", 0, 10, true],
        ],
    );
    assert.equal(new Set(result.map((c) => c.id)).size, 5);
    assert.equal(result.at(-1), clips.at(-1));
    assert.equal(removeEditRange([full], "v", 0, 10).length, 0);
    assert.equal(removeEditRange([full], "v", 0, 2)[0].id, full.id);
    assert.equal(full.end, 10);
    assert.throws(() => removeEditRange(clips, "v", 3, 2));
});

test("AI drafts apply only to their exact source and base plan, including persisted round trips", () => {
    const clips = localEditPlan(analysis, "manual", 0),
        proposed = localEditPlan(analysis, "text", 0);
    const settings = { analysis, clips, draft: { clips: proposed, rationale: "精剪", model: "claude::configured", fingerprint: "test", baseClips: JSON.stringify(clips) } };
    const next = applyEditDraft(JSON.parse(JSON.stringify(settings)), "test");
    assert.deepEqual(next.clips, proposed);
    assert.equal(next.draft, undefined);
    assert.equal(next.model, "claude::configured");
    assert.deepEqual(settings.clips, clips);
    assert.throws(() => applyEditDraft(settings, "changed"), /已改变/);
    assert.throws(() => applyEditDraft({ ...settings, clips: [{ ...clips[0], end: 8 }] }, "test"), /已改变/);
    assert.throws(() => applyEditDraft({ ...settings, draft: { ...settings.draft, clips: [{ ...clips[0], end: 20 }] } }, "test"));
});
