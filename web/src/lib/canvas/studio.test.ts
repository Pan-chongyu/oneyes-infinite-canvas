import { test } from "node:test";
import assert from "node:assert/strict";
import { readShots, readScreenplay, screenplayEpisodeText, shotVideoPrompt, subtitleSrt, studioSources, exportName, shotsToBatchText, batchPrompts } from "./studio";
import { filterLibraryNodes, createWorkflowOps, workflowTemplates } from "./node-library";
import type { CanvasNodeDefinition } from "@/types/canvas-plugin";
import type { CanvasNodeData } from "@/types/canvas";
import { studioModelChoice, readReferenceDraft, readPromptDraft, readSelectionAdvice, readSubtitleCorrections, prepareStoryboarding } from "./studio-assistant";
import type { CanvasPluginAi } from "@/types/canvas-plugin";
test("storyboards require real shot content and positive durations; subtitles preserve Unicode and reject invalid timing", () => {
    assert.equal(readShots('```json\n[{"picture":"雨夜","seconds":5}]\n```')[0].title, "镜头 1");
    assert.throws(() => readShots('[{"picture":"雨夜","seconds":0}]'));
    assert.throws(() => readShots("{}"));
    assert.equal(subtitleSrt([{ start: 0.125, end: 3661.987, text: "中文\n第二行" }]), "1\n00:00:00,125 --> 01:01:01,987\n中文\n第二行\n");
    assert.throws(() =>
        subtitleSrt([
            { start: 2, end: 3, text: "a" },
            { start: 1, end: 4, text: "b" },
        ]),
    );
    assert.throws(() => subtitleSrt([{ start: 0, end: NaN, text: "a" }]));
    assert.throws(() => subtitleSrt([{ start: 0, end: 1, text: "" }]));
});
test("screenplays validate episode and character data and expose the selected episode as reusable text", () => {
    const screenplay = readScreenplay(JSON.stringify({
        logline: "山海异闻",
        style: "国风水墨",
        characters: [{ name: "阿宁", appearance: "白衣少女，银簪", personality: "沉着", voice: "清亮" }],
        episodes: [{ title: "第一集", synopsis: "入山", script: "阿宁踏入雨雾。", cliffhanger: "山门无声合上。" }],
    }));
    const text = screenplayEpisodeText(screenplay, 99);
    assert.match(text, /第一集/); assert.match(text, /白衣少女/); assert.match(text, /山门无声合上/);
    assert.throws(() => readScreenplay('{"characters":[],"episodes":[]}'));
    assert.throws(() => readScreenplay('{"characters":[{"name":"阿宁"}],"episodes":[{"title":"第一集","script":""}]}'));
    assert.throws(() => readScreenplay('{"characters":[null],"episodes":[null]}'));
    assert.throws(() => readScreenplay('[]'));
});
test("node library searches uses and input/output labels; templates create unique, connected drafts without paid execution", () => {
    const defs = [
        { type: "studio:ocr", title: "OCR 文字提取" },
        { type: "studio:subtitles", title: "语音转字幕" },
        { type: "third:custom", title: "外部扩展", description: "自定义后期" },
    ] as CanvasNodeDefinition[];
    assert.equal(filterLibraryNodes(defs, "图片 文字", "图片")[0].type, "studio:ocr");
    assert.equal(filterLibraryNodes(defs, "SrT", "全部")[0].type, "studio:subtitles");
    assert.equal(filterLibraryNodes(defs, "后期", "扩展")[0].type, "third:custom");
    assert.equal(filterLibraryNodes([{ type: "studio:screenplay", title: "漫剧剧本" }] as CanvasNodeDefinition[], "剧本", "漫剧")[0].type, "studio:screenplay");
    assert.equal(filterLibraryNodes(defs, "OCR", "音视频").length, 0);
    const ids = new Set<string>();
    for (const template of workflowTemplates) {
        const ops = createWorkflowOps(template.id, { x: 200, y: 300 });
        const nodes = ops.filter(op => op.type === "add_node");
        assert.equal(nodes.length, template.types.length);
        nodes.forEach(node => { assert.ok(!ids.has(node.id!)); ids.add(node.id!); });
        const localIds = new Set(nodes.map(node => node.id));
        for (const op of ops) {
            if (op.type === "connect_nodes") { assert.ok(localIds.has(op.fromNodeId)); assert.ok(localIds.has(op.toNodeId)); }
            assert.notEqual(op.type, "run_generation");
        }
    }
    assert.throws(() => createWorkflowOps("missing", { x: 0, y: 0 }));
});
test("studio rejects incompatible links before execution; batch consumes connected text and keeps one shot per line", () => {
    const node = (id: string, type: string, content?: string) => ({ id, type, title: id, metadata: { content }, position: { x: 0, y: 0 }, width: 1, height: 1 }) as CanvasNodeData;
    const tool = { ...node("tool", "studio:ocr"), metadata: { studio: { sourceIds: ["video"] } } };
    assert.throws(() => studioSources(tool, [node("video", "video")], []), /类型不匹配/);
    tool.type = "studio:storyboard";
    assert.throws(() => studioSources(tool, [node("video", "image")], []), /类型不匹配/);
    const batch = { ...node("batch", "studio:batch"), metadata: { studio: { text: "面板提示词" } } };
    assert.deepEqual(batchPrompts(batch, [node("text", "text", "第一张\n第二张"), node("img", "image", "not-a-prompt")]), ["面板提示词", "第一张", "第二张"]);
    const shots = [{ title: "一", picture: "雨夜\n街道", camera: "跟拍", dialogue: "出发", seconds: 5, scene: "山门", characters: "白衣阿宁", framing: "近景", continuity: "银簪不变" }, { title: "二", picture: "晴天", camera: "", dialogue: "", seconds: 3 }];
    const text = shotsToBatchText(shots);
    assert.deepEqual(text.split("\n"), ["场景：山门；人物：白衣阿宁；景别：近景；雨夜 街道；连续性：银簪不变；运镜：跟拍", "晴天"]);
    assert.match(shotVideoPrompt(shots[0]), /台词：出发/);
    assert.match(shotVideoPrompt(shots[0]), /参考时长：5 秒/);
    assert.throws(() => shotsToBatchText([{ title: "空", picture: "", camera: "", dialogue: "", seconds: 5 }]));
});
test("studio sources retain order and reject deleted references; exported names cannot escape ZIP paths", () => {
    const node = (id: string) => ({ id, type: "image", title: id, position: { x: 0, y: 0 }, width: 1, height: 1 }) as CanvasNodeData;
    const tool = { ...node("tool"), metadata: { studio: { sourceIds: ["b", "a", "b"] } } };
    assert.deepEqual(
        studioSources(tool, [node("a"), node("b")], []).map((n) => n.id),
        ["b", "a"],
    );
    assert.throws(() => studioSources(tool, [node("a")], []));
    assert.equal(exportName("../../坏:文件\\x"), "_.._坏_文件_x");
});

test("studio assistants validate model drafts without changing timeline or accepting a fabricated image", () => {
    assert.deepEqual(readReferenceDraft('```json\n{"role":"白衣少女", "outfit":"银簪", "style":"水墨"}\n```'), { role: "白衣少女", outfit: "银簪", style: "水墨" });
    assert.throws(() => readReferenceDraft('{"role":{},"outfit":"","style":""}'));
    assert.deepEqual(readPromptDraft('{"prompts":["雨夜\\n街道","同一角色"]}'), ["雨夜 街道", "同一角色"]);
    assert.throws(() => readPromptDraft('{"prompts":["有效",null]}'));
    assert.throws(() => readPromptDraft('{"prompts":[]}'));
    const sources = [{ id: "a" }, { id: "b" }] as CanvasNodeData[];
    assert.deepEqual(readSelectionAdvice('{"index":2,"reason":"主体完整"}', sources), { sourceId: "b", reason: "主体完整" });
    assert.throws(() => readSelectionAdvice('{"index":3,"reason":"不存在"}', sources));
    const cues = [{ start: 0.125, end: 3.9, text: "原字", speaker: "甲" }];
    assert.deepEqual(readSubtitleCorrections('{"texts":["文字"],"start":99}', cues), [{ ...cues[0], text: "文字" }]);
    assert.equal(cues[0].text, "原字");
    assert.throws(() => readSubtitleCorrections('{"texts":["一","二"]}', cues));
    assert.throws(() => readSubtitleCorrections('{"texts":[""]}', cues));
});

test("studio preserves exact selected channel and never switches an unavailable model", () => {
    const ai = { defaultModel: () => "group-a/model", listModels: () => [{ value: "group-a/model", label: "A" }, { value: "group-b/model", label: "B" }], isModelReady: (model: string) => model !== "removed/model" } as unknown as CanvasPluginAi;
    assert.equal(studioModelChoice(ai, undefined, "text").value, "group-a/model");
    assert.equal(studioModelChoice(ai, "group-b/model", "text").value, "group-b/model");
    const removed = studioModelChoice(ai, "removed/model", "text");
    assert.equal(removed.value, "removed/model"); assert.equal(removed.ready, false);
    assert.match(removed.options.at(-1)!.label, /未配置/);
    const tool = { metadata: { studio: { text: "不要重复追加", preparedPrompts: ["第一镜", "第二镜"] } } } as CanvasNodeData;
    assert.deepEqual(batchPrompts(tool, [{ type: "text", metadata: { content: "上游整篇故事" } }] as CanvasNodeData[]), ["第一镜", "第二镜"]);
});

test("screenplay next step reuses connected storyboard without changing edited shots or paying for generation", () => {
    const source = { id: "script", position: { x: 0, y: 0 }, width: 320, metadata: { studio: { screenplay: readScreenplay('{"characters":[{"name":"阿宁","appearance":"白衣"}],"episodes":[{"script":"走入山门"}]}'), model: "group-b/model" } } } as CanvasNodeData;
    const first = prepareStoryboarding(source, [source], []);
    assert.equal(first.ops.filter(op => op.type === "add_node").length, 2);
    const reference = first.ops.find(op => op.type === "add_node" && op.nodeType === "studio:reference")!;
    assert.ok(reference.type === "add_node"); assert.match(reference.metadata!.studio!.role!, /白衣/);
    assert.ok(first.ops.every(op => op.type !== "run_generation"));
    const edited = { id: "board", type: "studio:storyboard", metadata: { studio: { sourceIds: ["existing"], shots: [{ title: "保留", picture: "雨夜", seconds: 5, camera: "", dialogue: "" }] } } } as CanvasNodeData;
    const next = prepareStoryboarding(source, [source, edited], [{ fromNodeId: "script", toNodeId: "board" }]);
    assert.equal(next.boardId, "board");
    const patch = next.ops.find(op => op.type === "update_node");
    assert.deepEqual(patch?.metadata?.studio?.shots, edited.metadata?.studio?.shots);
    assert.ok(patch?.metadata?.studio?.sourceIds?.includes("script"));
});
