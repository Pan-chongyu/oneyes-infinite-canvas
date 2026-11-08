import { Euler, MathUtils, Matrix4, Quaternion, Vector3 } from "three";
import { nanoid } from "nanoid";
import { directorJoints } from "./director-scene";
import type { DirectorCamera, DirectorFrame, DirectorObject, DirectorScene, DirectorShot, DirectorVector } from "@/types/director";

export const shotDuration = (shot: DirectorShot) => shot.duration ?? 5;
export const sequenceDuration = (shots: DirectorShot[]) => shots.reduce((sum, shot) => sum + shotDuration(shot), 0);
export function directorFrame(scene: DirectorFrame): DirectorFrame {
    const { objects, camera, light, background, floor, floorVisible } = scene;
    return structuredClone({ objects, camera, light, background, floor, floorVisible: floorVisible !== false });
}
export function createDirectorShot(scene: DirectorScene): DirectorShot {
    const { camera, ...stage } = directorFrame(scene);
    return { id: nanoid(), name: `镜头 ${(scene.shots?.length || 0) + 1}`, camera, stage, width: scene.width, height: scene.height, duration: 5, easing: "smooth" };
}
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const vector = (a: DirectorVector, b: DirectorVector, t: number): DirectorVector => a.map((n, i) => mix(n, b[i], t)) as DirectorVector;
const rotation = (a: DirectorVector, b: DirectorVector, t: number): DirectorVector => {
    const quaternion = (v: DirectorVector) => new Quaternion().setFromEuler(new Euler(...v.map(MathUtils.degToRad) as DirectorVector));
    const euler = new Euler().setFromQuaternion(quaternion(a).slerp(quaternion(b), t));
    return [euler.x, euler.y, euler.z].map(MathUtils.radToDeg) as DirectorVector;
};
function cameraBetween(a: DirectorCamera, b: DirectorCamera, t: number, orbit = false): DirectorCamera {
    if (orbit) {
        const start = new Vector3(...a.position).sub(new Vector3(...a.target)), end = new Vector3(...b.position).sub(new Vector3(...b.target));
        const arc = new Quaternion().setFromUnitVectors(start.clone().normalize(),end.clone().normalize());
        const target = vector(a.target,b.target,t), distance = mix(start.length(),end.length(),t);
        const position = start.normalize().applyQuaternion(new Quaternion().slerp(arc,t)).multiplyScalar(distance).add(new Vector3(...target)).toArray();
        return {position,target,lens:mix(a.lens,b.lens,t),roll:mix(a.roll ?? 0,b.roll ?? 0,t)};
    }
    const orientation = (camera: DirectorCamera) => new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(...camera.position), new Vector3(...camera.target), new Vector3(0, 1, 0)));
    const position = vector(a.position, b.position, t), facing = orientation(a).slerp(orientation(b), t);
    const distance = mix(new Vector3(...a.position).distanceTo(new Vector3(...a.target)), new Vector3(...b.position).distanceTo(new Vector3(...b.target)), t);
    const target = new Vector3(0, 0, -distance).applyQuaternion(facing).add(new Vector3(...position)).toArray();
    return { position, target, lens: mix(a.lens, b.lens, t), roll: mix(a.roll ?? 0, b.roll ?? 0, t) };
}
function objectBetween(a: DirectorObject, b: DirectorObject, t: number): DirectorObject {
    if (a.kind !== b.kind) return structuredClone(a);
    const joints = a.kind === "person" && a.pose === b.pose ? Object.fromEntries(Object.keys(directorJoints).map(name => {
        const key = name as keyof typeof directorJoints;
        return [key, rotation(a.joints?.[key] || [0, 0, 0], b.joints?.[key] || [0, 0, 0], t)];
    })) : a.joints;
    return { ...structuredClone(a), position: vector(a.position, b.position, t), rotation: rotation(a.rotation, b.rotation, t), scale: vector(a.scale, b.scale, t), joints };
}
export function shotScene(source: DirectorScene, shot: DirectorShot, time = 0): DirectorScene {
    const first: DirectorFrame = { ...(shot.stage || directorFrame(source)), camera: shot.camera };
    const frames = [{ time: 0, frame: first }, ...(shot.keyframes || []).slice().sort((a, b) => a.time - b.time)];
    const cursor = Math.max(0, Math.min(shotDuration(shot), time));
    let left = frames[0], right = frames[0];
    for (const frame of frames) { if (frame.time <= cursor) left = frame; else { right = frame; break; } right = left; }
    let value = directorFrame(left.frame);
    if (right.time > left.time && shot.easing !== "hold") {
        let t = (cursor - left.time) / (right.time - left.time);
        if (shot.easing !== "linear") t = t * t * (3 - 2 * t);
        value.camera = cameraBetween(left.frame.camera, right.frame.camera, t, shot.cameraPath === "orbit");
        const targets = new Map(right.frame.objects.map(object => [object.id, object]));
        value.objects = left.frame.objects.map(object => targets.has(object.id) ? objectBetween(object, targets.get(object.id)!, t) : structuredClone(object));
    }
    return { ...source, ...value, width: shot.width, height: shot.height };
}
export function recordDirectorFrame(shot: DirectorShot, scene: DirectorScene, time: number): DirectorShot {
    const frame = directorFrame(scene), cursor = Math.min(shotDuration(shot), Math.round(Math.max(0, Math.min(shotDuration(shot), time)) * 1000) / 1000);
    if (cursor === 0) { const { camera, ...stage } = frame; return { ...shot, camera, stage, width: scene.width, height: scene.height }; }
    const existing = shot.keyframes?.find(key => key.time === cursor);
    return { ...shot, keyframes: [...(shot.keyframes || []).filter(key => key.time !== cursor), { id: existing?.id || nanoid(), time: cursor, frame }].sort((a, b) => a.time - b.time) };
}
export function sequenceAt(shots: DirectorShot[], time: number) {
    let offset = 0;
    for (let index = 0; index < shots.length; index++) {
        const shot = shots[index], duration = shotDuration(shot);
        if (time < offset + duration || index === shots.length - 1) return { shot, index, offset, time: Math.max(0, Math.min(duration, time - offset)) };
        offset += duration;
    }
    return null;
}
export function directorCameraMove(source: DirectorScene, shot: DirectorShot, kind: "dolly" | "truck" | "crane" | "orbit", amount: number) {
    if (!Number.isFinite(amount)) throw Error("请输入有效的运镜幅度");
    if (kind === "orbit" && Math.abs(amount) > 180) throw Error("环绕预设采用最短圆弧；超过 180° 的运镜请分段记录关键帧");
    const start = shotScene(source,shot), end = shotScene(source,shot,shotDuration(shot));
    const position = new Vector3(...start.camera.position), target = new Vector3(...start.camera.target), direction = target.clone().sub(position).normalize();
    if (kind === "dolly") {
        if (amount >= position.distanceTo(target)) throw Error("推进距离不能越过取景目标，请减小幅度或调整取景目标");
        position.addScaledVector(direction,amount);
    } else if (kind === "truck") {
        let right = new Vector3().crossVectors(direction,new Vector3(0,1,0));
        if (right.lengthSq() === 0) right = new Vector3(1,0,0);
        right.normalize().multiplyScalar(amount); position.add(right); target.add(right);
    } else if (kind === "crane") { position.y += amount; target.y += amount; }
    else position.sub(target).applyAxisAngle(new Vector3(0,1,0),MathUtils.degToRad(amount)).add(target);
    end.camera = { ...start.camera, position: position.toArray(), target: target.toArray() };
    const { camera: _camera, ...stage } = directorFrame(start);
    const base = { ...shot, stage: shot.stage || stage, cameraPath: kind === "orbit" ? "orbit" as const : "linear" as const };
    return recordDirectorFrame(base,end,shotDuration(shot));
}
export function directorMotionPrompt(scene: DirectorScene, shot: DirectorShot) {
    const point = (value: DirectorVector) => value.map(n => Number(n.toFixed(3))).join(", ");
    return [`镜头时长 ${shotDuration(shot)} 秒，${shot.easing === "hold" ? "保持后切换" : shot.easing === "linear" ? "匀速" : "缓入缓出"}运镜，${shot.cameraPath === "orbit" ? "围绕目标沿最短圆弧移动" : "相机沿机位间的直线路径移动"}。`,
        "以下为三维构图参考，单位米；按时间顺序演绎人物走位与镜头运动：",
        ...[0,...(shot.keyframes || []).map(key=>key.time).sort((a,b)=>a-b)].map(time => {
            const frame = shotScene(scene,shot,time);
            return `${time}s：相机 [${point(frame.camera.position)}]，朝向 [${point(frame.camera.target)}]，${frame.camera.lens}mm，横滚 ${frame.camera.roll ?? 0}°；${frame.objects.filter(object=>object.visible !== false).map(object=>`${object.name} 位于 [${point(object.position)}]，朝向 [${point(object.rotation)}]°`).join("；")}`;
        })].join("\n");
}
export function shotListCsv(scene: DirectorScene) {
    const cell = (value: unknown) => { const text = String(value ?? ""); return `"${/^[\s]*[=+@-]/.test(text) ? "'" : ""}${text.replaceAll('"', '""')}"`; };
    let offset = 0;
    return "\uFEFF" + [["镜号", "名称", "起点（秒）", "时长（秒）", "焦距（mm）", "画幅", "关键帧数", "画面与动作", "台词", "声音"], ...(scene.shots || []).map((shot, i) => {
        const row = [i + 1, shot.name, offset, shotDuration(shot), shot.camera.lens, `${shot.width} × ${shot.height}`, (shot.keyframes?.length || 0) + 1, shot.note, shot.dialogue, shot.sound];
        offset += shotDuration(shot); return row;
    })].map(row => row.map(cell).join(",")).join("\r\n");
}
