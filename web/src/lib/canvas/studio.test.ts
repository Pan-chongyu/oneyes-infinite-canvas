import { test } from "node:test";
import assert from "node:assert/strict";
import { readShots, subtitleSrt, studioSources, exportName } from "./studio";
import type { CanvasNodeData } from "@/types/canvas";
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
