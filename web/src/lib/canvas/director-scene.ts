import { nanoid } from "nanoid";
import type { DirectorKind, DirectorObject, DirectorScene, DirectorVector } from "@/types/director";

export const directorNames: Record<DirectorKind, string> = { person: "人物", box: "方块", sphere: "球体", cylinder: "圆柱" };
export const directorPoses = [{ value: "stand", label: "站立" }, { value: "walk", label: "迈步" }, { value: "sit", label: "坐姿" }, { value: "reach", label: "伸手" }];
export function directorObject(kind: DirectorKind): DirectorObject {
    return { id: nanoid(), kind, name: directorNames[kind], pose: "stand", position: [0, kind === "person" ? 0 : 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: kind === "person" ? "#d1b198" : "#7e9da4" };
}
export function directorPreset(kind: "portrait" | "dialogue" | "product" = "portrait"): DirectorScene {
    const first = directorObject(kind === "product" ? "cylinder" : "person");
    const objects = [first];
    if (kind === "dialogue") {
        first.position = [-0.8, 0, 0]; first.rotation[1] = 35;
        const second = directorObject("person"); second.position = [0.8, 0, 0]; second.rotation[1] = -35; second.color = "#8fa8b2"; second.name = "人物 2"; objects.push(second);
    }
    return { schema: 1, objects, camera: { position: kind === "product" ? [3, 2.1, 4] : [3.8, 2.5, 5.5], target: [0, kind === "product" ? 0.5 : 0.95, 0], lens: 50 }, light: { azimuth: -35, elevation: 45, intensity: 3 }, background: "#e8e5de", floor: "#c4c0b7", width: 1536, height: 864, grid: true };
}

// Imported project metadata is data, never executable scene code or external assets.
export function readDirectorScene(value: unknown): DirectorScene {
    if (value === undefined) return directorPreset();
    const scene = structuredClone(value) as DirectorScene;
    const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
    const vector = (v: unknown): v is DirectorVector => Array.isArray(v) && v.length === 3 && v.every(finite);
    const color = (v: unknown) => typeof v === "string" && /^#[a-f\d]{6}$/i.test(v);
    if (!scene || scene.schema !== 1 || !Array.isArray(scene.objects) || !scene.camera || !scene.light || !vector(scene.camera.position) || !vector(scene.camera.target) || scene.camera.position.every((v, i) => v === scene.camera.target[i]) || !finite(scene.camera.lens) || scene.camera.lens <= 0 || ![scene.light.azimuth, scene.light.elevation, scene.light.intensity].every(finite) || scene.light.intensity < 0 || !color(scene.background) || !color(scene.floor) || ![scene.width, scene.height].every(v => Number.isSafeInteger(v) && v > 0) || typeof scene.grid !== "boolean") throw new Error("导演台场景数据无效，请从有效的画布备份恢复；原场景未被覆盖");
    const ids = new Set<string>();
    for (const object of scene.objects) {
        if (!object || typeof object.id !== "string" || !object.id || ids.has(object.id) || typeof object.name !== "string" || !Object.hasOwn(directorNames, object.kind) || !directorPoses.some(pose => pose.value === object.pose) || !vector(object.position) || !vector(object.rotation) || !vector(object.scale) || object.scale.some(v => v <= 0) || !color(object.color)) throw new Error("导演台物体数据无效，请从有效的画布备份恢复；原场景未被覆盖");
        ids.add(object.id);
    }
    return scene;
}
