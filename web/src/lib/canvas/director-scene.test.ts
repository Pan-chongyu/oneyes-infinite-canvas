import test from "node:test";
import assert from "node:assert/strict";
import { directorHistory, directorObject, directorPreset, directorPrompt, directorSceneFile, parseDirectorSceneFile, readDirectorScene } from "./director-scene";

test("director history groups a field edit, keeps independent snapshots and invalidates redo only on new work", () => {
    const original = directorPreset(), history = directorHistory(original);
    const first = structuredClone(original); first.objects[0].name = "新名称";
    history.commit(first, "name");
    const second = structuredClone(first); second.objects[0].name = "完整名称";
    history.commit(second, "name");
    assert.deepEqual(history.undo(), original);
    assert.deepEqual(history.redo(), second);
    history.end();
    const hidden = structuredClone(second); hidden.objects[0].visible = false; history.commit(hidden);
    assert.deepEqual(history.undo(), second);
    assert.equal(history.commit(second), false); assert.equal(history.canRedo, true);
    const locked = structuredClone(second); locked.objects[0].locked = true; history.commit(locked);
    assert.equal(history.canRedo, false);
    locked.objects[0].name = "caller mutated";
    assert.deepEqual(history.undo(), second);
    assert.notEqual(history.redo()!.objects[0].name, locked.objects[0].name);
});

test("director scene exchange preserves articulation, materials, lights and ordered shot notes as independent data", () => {
    const scene = directorPreset();
    scene.objects[0].name = "主角 A"; scene.objects[0].joints = { head: [0, 45, 0], leftArm: [40, 0, 30], leftElbow: [-90, 0, 0] };
    scene.objects[0].roughness = 0.2; scene.objects[0].metalness = 0.8;
    scene.objects.push(directorObject("torus"), directorObject("plane"), directorObject("cone"));
    scene.light = { ...scene.light, color: "#ffd9b8", fill: 2, rim: 1, ambient: 0.5, shadows: false };
    scene.floorVisible = false; scene.note = "电影感对话";
    scene.shots = ["反打", "主镜头"].map((name,id) => ({ id: String(id), name, note: "情绪克制", camera: structuredClone(scene.camera), width: 864, height: 1536 }));
    const restored = parseDirectorSceneFile(directorSceneFile(scene));
    assert.deepEqual(restored, scene); restored.objects[0].joints!.head![1] = 90;
    assert.equal(scene.objects[0].joints.head![1], 45);
    assert.match(directorPrompt(scene, scene.shots[0].note), /电影感对话\n情绪克制/);
    scene.objects[0].visible = false;
    assert.doesNotMatch(directorPrompt(scene), /主角 A/);
    for (const text of ['{', '{}', JSON.stringify({ format: "oneyes-director", version: 2, scene }), JSON.stringify({ format: "oneyes-director", version: 1, scene: { ...scene, width: 0 } })]) assert.throws(() => parseDirectorSceneFile(text));
    for (const patch of [ { joints: { unknown: [0,0,0] } }, { joints: { head: [NaN,0,0] } }, { joints: [] }, { roughness: -1 }, { metalness: 1.1 } ]) assert.throws(() => readDirectorScene({ ...scene, objects: [{ ...scene.objects[0], ...patch }] }), /无效/);
    for (const patch of [{ floorVisible: "false" }, { note: {} }, { light: { ...scene.light, fill: -1 } }, { light: { ...scene.light, color: "url(external)" } }, { light: { ...scene.light, shadows: 1 } }]) assert.throws(() => readDirectorScene({ ...scene, ...patch }), /无效/);
});

test("scene validates shot identities, camera/dimensions and visibility/locking without changing saved metadata", () => {
    const scene = directorPreset(); scene.guide = "thirds";
    scene.objects[0].visible = false; scene.objects[0].locked = true;
    scene.shots = [{ id: "portrait", name: "竖幅特写", camera: structuredClone(scene.camera), width: 864, height: 1536 }];
    assert.deepEqual(readDirectorScene(scene), scene);
    const copy = readDirectorScene(scene); copy.shots![0].camera.position[0] = 999;
    assert.notEqual(scene.shots[0].camera.position[0], 999);
    for (const patch of [
        { guide: "invalid" }, { shots: "bad" }, { shots: [scene.shots[0], scene.shots[0]] },
        { shots: [{ ...scene.shots[0], height: 0 }] }, { shots: [{ ...scene.shots[0], camera: { ...scene.camera, lens: NaN } }] },
        { shots: [{ ...scene.shots[0], camera: { ...scene.camera, target: scene.camera.position } }] },
        { objects: [{ ...scene.objects[0], visible: "false" }] }, { objects: [{ ...scene.objects[0], locked: 1 }] },
    ]) assert.throws(() => readDirectorScene({ ...scene, ...patch }), /无效/);
    assert.deepEqual(readDirectorScene(directorPreset()).shots, undefined);
});
