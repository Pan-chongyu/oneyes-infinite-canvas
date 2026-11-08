import { nanoid } from "nanoid";
import type { DirectorCamera, DirectorJoint, DirectorKind, DirectorObject, DirectorOutput, DirectorScene, DirectorVector } from "@/types/director";

export const directorNames: Record<DirectorKind, string> = { person: "人物", box: "方块", sphere: "球体", cylinder: "圆柱", cone: "圆锥", torus: "圆环", plane: "布景板" };
export const directorJoints: Record<DirectorJoint, string> = { torso: "上身", head: "头部", leftArm: "左肩", leftElbow: "左肘", rightArm: "右肩", rightElbow: "右肘", leftLeg: "左髋", leftKnee: "左膝", rightLeg: "右髋", rightKnee: "右膝" };
export const directorOutputs: Record<DirectorOutput, string> = { color: "取景图", depth: "深度图", outline: "轮廓图", mask: "物体蒙版", normal: "法线图", transparent: "透明背景图" };
export const directorLighting = {
    studio: { label: "柔和影棚", light: { azimuth: -35, elevation: 45, intensity: 3, ambient: 2, fill: 1, rim: 0.8, color: "#ffffff", shadows: true } },
    sunset: { label: "日落侧光", light: { azimuth: -70, elevation: 15, intensity: 4, ambient: 0.6, fill: 0.3, rim: 1, color: "#ffb878", shadows: true } },
    dramatic: { label: "戏剧逆光", light: { azimuth: 140, elevation: 35, intensity: 5, ambient: 0.3, fill: 0.4, rim: 3, color: "#d0deff", shadows: true } },
};
export const directorPoses = [{ value: "stand", label: "站立" }, { value: "walk", label: "迈步" }, { value: "sit", label: "坐姿" }, { value: "reach", label: "伸手" }];
export function directorObject(kind: DirectorKind): DirectorObject {
    return { id: nanoid(), kind, name: directorNames[kind], pose: "stand", position: [0, kind === "person" ? 0 : kind === "plane" ? 1 : 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: kind === "person" ? "#d1b198" : "#7e9da4" };
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
    const camera = (v: DirectorCamera) => v && vector(v.position) && vector(v.target) && v.position.some((n, i) => n !== v.target[i]) && finite(v.lens) && v.lens > 0 && (v.roll === undefined || finite(v.roll));
    const dimensions = (width: number, height: number) => [width, height].every(v => Number.isSafeInteger(v) && v > 0);
    if (!scene || scene.schema !== 1 || !Array.isArray(scene.objects) || !camera(scene.camera) || !scene.light || ![scene.light.azimuth, scene.light.elevation, scene.light.intensity].every(finite) || scene.light.intensity < 0 || !color(scene.background) || !color(scene.floor) || !dimensions(scene.width, scene.height) || typeof scene.grid !== "boolean" || (scene.guide !== undefined && !["none", "thirds", "center"].includes(scene.guide)) || (scene.note !== undefined && typeof scene.note !== "string") || [scene.floorVisible, scene.light.shadows].some(v => v !== undefined && typeof v !== "boolean") || (scene.light.color !== undefined && !color(scene.light.color)) || [scene.light.ambient, scene.light.fill, scene.light.rim].some(v => v !== undefined && (!finite(v) || v < 0))) throw new Error("导演台场景数据无效，请从有效的画布备份恢复；原场景未被覆盖");
    const ids = new Set<string>();
    if ([scene.safeFrame, scene.motionPaths].some(value => value !== undefined && typeof value !== "boolean")) throw new Error("导演台辅助线设置无效，原场景未被覆盖");
    for (const object of scene.objects) {
        if (!object || typeof object.id !== "string" || !object.id || ids.has(object.id) || typeof object.name !== "string" || !Object.hasOwn(directorNames, object.kind) || !directorPoses.some(pose => pose.value === object.pose) || !vector(object.position) || !vector(object.rotation) || !vector(object.scale) || object.scale.some(v => v <= 0) || !color(object.color) || [object.visible, object.locked].some(v => v !== undefined && typeof v !== "boolean")) throw new Error("导演台物体数据无效，请从有效的画布备份恢复；原场景未被覆盖");
        ids.add(object.id);
        if ([object.roughness, object.metalness].some(v => v !== undefined && (!finite(v) || v < 0 || v > 1)) || (object.joints !== undefined && (!object.joints || typeof object.joints !== "object" || Array.isArray(object.joints) || Object.entries(object.joints).some(([key, value]) => !Object.hasOwn(directorJoints, key) || !vector(value))))) throw new Error("导演台姿态或材质数据无效，原场景未被覆盖");
    }
    if (scene.shots !== undefined) {
        if (!Array.isArray(scene.shots)) throw new Error("导演台机位数据无效，原场景未被覆盖");
        const shots = new Set<string>();
        for (const shot of scene.shots) {
            if (!shot || typeof shot.id !== "string" || !shot.id || shots.has(shot.id) || typeof shot.name !== "string" || (shot.note !== undefined && typeof shot.note !== "string") || !camera(shot.camera) || !dimensions(shot.width, shot.height)) throw new Error("导演台机位数据无效，原场景未被覆盖");
            shots.add(shot.id);
            if ((shot.duration !== undefined && (!finite(shot.duration) || shot.duration <= 0)) || [shot.dialogue, shot.sound].some(value => value !== undefined && typeof value !== "string") || (shot.easing !== undefined && !["linear", "smooth", "hold"].includes(shot.easing)) || (shot.cameraPath !== undefined && !["linear", "orbit"].includes(shot.cameraPath))) throw new Error("导演台分镜时长、运镜或描述无效，原场景未被覆盖");
            const validateFrame = (frame: unknown, view: DirectorCamera) => {
                if (!frame || typeof frame !== "object" || Array.isArray(frame)) throw new Error("导演台分镜快照无效，原场景未被覆盖");
                const stage = frame as DirectorScene;
                // Select data fields explicitly; never recurse into nested shot lists from imported JSON.
                readDirectorScene({ schema: 1, objects: stage.objects, light: stage.light, background: stage.background, floor: stage.floor, floorVisible: stage.floorVisible, camera: view, width: shot.width, height: shot.height, grid: false });
            };
            if (shot.stage !== undefined) validateFrame(shot.stage, shot.camera);
            if (shot.keyframes !== undefined) {
                if (!Array.isArray(shot.keyframes)) throw new Error("导演台关键帧无效，原场景未被覆盖");
                const keys = new Set<string>(), times = new Set<number>();
                for (const key of shot.keyframes) {
                    if (!key || typeof key.id !== "string" || !key.id || keys.has(key.id) || !finite(key.time) || key.time <= 0 || key.time > (shot.duration ?? 5) || times.has(key.time) || !key.frame || !camera(key.frame.camera)) throw new Error("导演台关键帧时间或镜头无效，原场景未被覆盖");
                    keys.add(key.id); times.add(key.time); validateFrame(key.frame, key.frame.camera);
                }
            }
        }
    }
    return scene;
}

export function directorSceneFile(scene: DirectorScene) {
    return JSON.stringify({ format: "oneyes-director", version: 1, scene: readDirectorScene(scene) }, null, 2);
}
export function parseDirectorSceneFile(text: string) {
    const data = JSON.parse(text);
    if (data?.format !== "oneyes-director" || data.version !== 1 || !data.scene) throw new Error("请选择 OneYes 导演台导出的场景 JSON 文件；当前场景未被覆盖");
    return readDirectorScene(data.scene);
}
export function directorPrompt(scene: DirectorScene, note?: string) {
    const visible = scene.objects.filter(item => item.visible !== false);
    return ["请参考构图图像创作，保持人物位置、镜头方向与画面比例。", scene.note, note,
        `镜头：${scene.camera.lens}mm，画幅 ${scene.width} × ${scene.height}。`,
        `可见物体：${visible.map(item => `${item.name}（${directorNames[item.kind]}${item.kind === "person" ? `，${directorPoses.find(pose => pose.value === item.pose)?.label}` : ""}）`).join("、") || "无"}。`,
        "保留参考图中的空间关系；人物细节、材质与风格按创作描述处理。"].filter(Boolean).join("\n");
}

/** Session-only undo stack; a continuous field edit is one action, with no hidden history cap. */
export function directorHistory(initial: DirectorScene) {
    let present = structuredClone(initial), past: DirectorScene[] = [], future: DirectorScene[] = [], editing: string | undefined;
    return {
        commit(next: DirectorScene, group?: string) {
            if (JSON.stringify(next) === JSON.stringify(present)) return false;
            if (!group || group !== editing) past.push(present);
            present = structuredClone(next); future = []; editing = group;
            return true;
        },
        end() { editing = undefined; },
        sync(next: DirectorScene) { if (JSON.stringify(next) === JSON.stringify(present)) return false; present = structuredClone(next); past = []; future = []; editing = undefined; return true; },
        undo() { const previous = past.pop(); if (!previous) return; future.push(present); present = previous; editing = undefined; return structuredClone(present); },
        redo() { const next = future.pop(); if (!next) return; past.push(present); present = next; editing = undefined; return structuredClone(present); },
        get canUndo() { return past.length > 0; }, get canRedo() { return future.length > 0; },
    };
}
