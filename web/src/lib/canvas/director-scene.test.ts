import test from "node:test";
import assert from "node:assert/strict";
import { directorHistory, directorPreset, readDirectorScene } from "./director-scene";

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
