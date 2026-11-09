import { directorNames, directorObject, readDirectorScene } from "./director-scene";
import { nanoid } from "nanoid";
import { createDirectorShot, directorFrame, shotScene } from "./director-sequence";
import { videoReverseAnalysis } from "./video-reverse-prompt";
import type { DirectorKind, DirectorScene, DirectorShot, DirectorVideoPrompt } from "@/types/director";

export type DirectorAiMode = "scene" | "animation";
export type DirectorDraft = { summary: string; scene: DirectorScene; preview: DirectorScene; source: string; added: DirectorShot[] };
const record = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("AI 草稿结构不完整，当前场景已保留，请调整描述后重试");
    return value as Record<string, unknown>;
};
const fields = (value: unknown, allowed: string[]) => {
    const object = record(value);
    if (Object.keys(object).some(key => !allowed.includes(key))) throw Error("AI 草稿包含不支持的场景字段，当前场景已保留，请重新生成");
    return object;
};
const json = (text: string) => {
    try { return record(JSON.parse(text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, ""))); }
    catch { throw Error("模型未返回完整 JSON 草稿，当前内容已保留，请调整描述后手动重试"); }
};
function stage(base: DirectorScene, value: unknown) {
    if (value === undefined) return structuredClone(base);
    const patch = fields(value,["objects","removeObjects","camera","light","background","floor","floorVisible","note"]), next = structuredClone(base);
    if (patch.camera !== undefined) next.camera = { ...next.camera, ...fields(patch.camera,["position","target","lens","roll"]) } as DirectorScene["camera"];
    if (patch.light !== undefined) next.light = { ...next.light, ...fields(patch.light,["azimuth","elevation","intensity","color","ambient","fill","rim","shadows"]) } as DirectorScene["light"];
    for (const key of ["background","floor","floorVisible","note"] as const) if (Object.hasOwn(patch,key)) Object.assign(next,{[key]:patch[key]});
    if (patch.removeObjects !== undefined) {
        if (!Array.isArray(patch.removeObjects) || patch.removeObjects.some(id=>typeof id !== "string" || !next.objects.some(object=>object.id===id))) throw Error("AI 草稿要移除的物体不存在，原场景已保留");
        if (next.objects.some(object=>object.locked && (patch.removeObjects as unknown[]).includes(object.id))) throw Error("AI 不能移除已锁定物体，请先手动解锁");
        next.objects = next.objects.filter(object=>!(patch.removeObjects as unknown[]).includes(object.id));
    }
    if (patch.objects !== undefined) {
        if (!Array.isArray(patch.objects)) throw Error("AI 物体列表无效，原场景已保留");
        const seen = new Set<string>();
        for (const value of patch.objects) {
            const object = fields(value,["id","name","kind","pose","position","rotation","scale","color","visible","joints","roughness","metalness","appearance"]);
            if (typeof object.id !== "string" || !object.id || seen.has(object.id)) throw Error("AI 物体编号缺失或重复，原场景已保留");
            seen.add(object.id);
            const existing = next.objects.find(item=>item.id===object.id);
            if (existing?.locked && Object.entries(object).some(([key,value])=>JSON.stringify(existing[key as keyof typeof existing])!==JSON.stringify(value))) throw Error("AI 不能修改已锁定物体，请先手动解锁");
            if (!existing && (typeof object.kind !== "string" || !Object.hasOwn(directorNames,object.kind))) throw Error("AI 新物体缺少有效类型，原场景已保留");
            const updated = { ...(existing || directorObject(object.kind as DirectorKind)), ...object, ...(object.joints !== undefined ? {joints:{...existing?.joints,...record(object.joints)}} : {}), ...(object.appearance !== undefined ? {appearance:{...existing?.appearance,...fields(object.appearance,["skin","hair","bottom","shoes","hairStyle"])}} : {}) } as DirectorScene["objects"][number];
            if (existing) next.objects = next.objects.map(item=>item.id===object.id?updated:item); else next.objects.push(updated);
        }
    }
    return readDirectorScene(next);
}
export function readDirectorDraft(text: string, source: DirectorScene, mode: DirectorAiMode): DirectorDraft {
    const plan = fields(json(text),["summary","scene","shots"]);
    if (typeof plan.summary !== "string" || !plan.summary.trim()) throw Error("AI 草稿缺少调整说明，请重新生成");
    let scene = stage(source,plan.scene);
    const added: DirectorShot[] = [];
    if (mode === "scene") {
        if (plan.scene === undefined || plan.shots !== undefined) throw Error("请使用场景调整草稿；制作分镜请选择「制作动画」");
    } else {
        if (!Array.isArray(plan.shots) || !plan.shots.length) throw Error("AI 未返回动画分镜，请描述人物动作、运镜和时长后重试");
        let previous = scene;
        for (const value of plan.shots) {
            const data = fields(value,["name","duration","easing","cameraPath","note","dialogue","sound","scene","keyframes"]);
            if (typeof data.name !== "string" || !data.name.trim() || typeof data.duration !== "number" || !Number.isFinite(data.duration) || data.duration <= 0) throw Error("AI 分镜缺少名称或有效时长，原场景已保留");
            const start = stage(previous,data.scene);
            let shot = { ...createDirectorShot(start), ...Object.fromEntries(Object.entries(data).filter(([key])=>!["scene","keyframes"].includes(key))) } as DirectorShot;
            if (data.keyframes !== undefined) {
                if (!Array.isArray(data.keyframes)) throw Error("AI 关键帧列表无效，原场景已保留");
                const keys = data.keyframes.map(value=>fields(value,["time","scene"]));
                const times = keys.map(key=>key.time);
                if (times.some(time=>typeof time!=="number"||!Number.isFinite(time)||time<=0||time>shot.duration!) || new Set(times).size!==times.length) throw Error("AI 关键帧时间须唯一且位于镜头时长内，原场景已保留");
                let frame = start;
                for (const key of keys.sort((a,b)=>(a.time as number)-(b.time as number))) {
                    if (key.scene === undefined) throw Error("AI 关键帧缺少场景变化，原场景已保留");
                    frame = stage(frame,key.scene); shot = {...shot,keyframes:[...(shot.keyframes || []),{id:nanoid(),time:key.time as number,frame:directorFrame(frame)}]};
                }
            }
            added.push(shot); previous = shotScene(start,shot,shot.duration);
        }
        if (!added.some(shot=>shot.keyframes?.length)) throw Error("AI 未制作运动关键帧，请补充动作与运镜要求后重试");
        scene = shotScene({ ...scene, shots:[...(source.shots || []),...added] },added[0]);
    }
    scene = readDirectorScene(scene);
    return { summary:plan.summary.trim(),scene,source:JSON.stringify(source),added,preview:{...scene,shots:added} };
}
export function directorAiRequest(scene: DirectorScene, instruction: string, mode: DirectorAiMode) {
    const { objects,camera,light,background,floor,floorVisible,note } = scene;
    return {
        prompt: JSON.stringify({要求:instruction,模式:mode,当前场景:{objects,camera,light,background,floor,floorVisible,note},固定输出画幅:{width:scene.width,height:scene.height}}),
        system: `你是 OneYes 三维导演台的分镜动画师，只返回 JSON，不执行代码。使用内置分色人物、家具、建筑框架和场景道具表达用户构图；这是三维布景预演，不承诺真实人像、贴图、口型或成片。单位米，Y 向上；所有旋转和关节用度，焦距用毫米。相机 position 与 target 必须不同，scale 每项必须正数，颜色为 #RRGGBB，数值有限。保留未要求改变的物体及 ID，禁止改变或移除 locked:true 的物体，禁止改变画幅。只输出用户要求的变更。
返回 {"summary":"中文调整说明","scene":场景补丁${mode==="animation"?',"shots":[{"name":"镜名","duration":秒数,"easing":"smooth","cameraPath":"linear","note":"动作和构图","dialogue":"台词","sound":"声音说明","scene":起始场景补丁,"keyframes":[{"time":秒数,"scene":场景补丁}]}]':""}}。
场景补丁只能含 objects,removeObjects,camera,light,background,floor,floorVisible,note。objects 是按 id 更新的物体补丁数组，新增物体自拟唯一 id 且需 kind；未列出的物体保留。可用物体字段 id,name,kind,pose,position:[x,y,z],rotation:[x,y,z],scale:[x,y,z],color,visible,joints,roughness,metalness,appearance。kind 仅 ${Object.keys(directorNames).join(",")}；pose 仅 stand,walk,sit,reach,wave,crouch。人物 appearance 可含 skin,hair,bottom,shoes（均 #RRGGBB）和 hairStyle（short/long/none），color 为上衣主色；未列外观字段保留。人物原点位于脚下、约 1.8m 高；人物朝 +Z、身高方向 +Y。椅子座面 0.47m、桌面 0.75m、沙发宽 2m、床 1.65×2.15m、门高 2.1m、窗高 1.2m、树高约 2.7m、汽车 1.75×4.1m；这些道具原点在地面，尺寸通过 scale 调整。基础几何体原点在中心；布景板为 2×2m。优先采用这些组合模型，不用重叠方块代替已有家具；安排前中后景、主体朝向、合理净空和接地，避免穿插。门窗只有框架，可真正透视穿过；窗户安装高度由 position.y 调整。joints 仅 torso,head,leftArm,leftElbow,leftWrist,rightArm,rightElbow,rightWrist,leftLeg,leftKnee,leftAnkle,rightLeg,rightKnee,rightAnkle，每项 [x,y,z] 度，关节相对预设姿态，未列出的关节保留。removeObjects 仅明确要求删除时使用 ID 数组。camera 可含 position,target,lens,roll。light 可含 azimuth,elevation,intensity,color,ambient,fill,rim,shadows；非负强度。roughness/metalness 为 0–1。
${mode==="scene"?"只调整当前场景，不返回 shots。":"制作能实际预演的动画：至少一镜有运动关键帧。每镜从上一镜末帧继承，scene 可覆盖起始状态；关键帧按时序累计补丁，time 必须大于 0、小于等于镜头 duration，不能重复。关键帧运动位置、旋转、缩放、相机焦距／横滚连续插值，同一 pose 下 joints 连续插值；材质、灯光、显隐、pose 在帧边界切换。需走路时用 walk 同姿态关节在多个时点交替摆动并移动人物。easing 为 linear/smooth/hold，cameraPath 为 linear/orbit（目标间最短圆弧，超过 180° 需多帧分段）。长运镜可分镜，台词和声音只记录文字，不生成音轨。"}`,
    };
}

export function readVideoPrompt(text: string, duration: number): DirectorVideoPrompt {
    if (!Number.isFinite(duration)||duration<=0) throw Error("视频时长无效，请重新读取原视频");
    const data = fields(json(text),["summary","prompt","negativePrompt","shots","uncertainties"]);
    if ([data.summary,data.prompt].some(text=>typeof text!=="string"||!text.trim()) || data.negativePrompt!==undefined&&typeof data.negativePrompt!=="string" || !Array.isArray(data.shots) || !data.shots.length || data.uncertainties!==undefined&&(!Array.isArray(data.uncertainties)||data.uncertainties.some(value=>typeof value!=="string"))) throw Error("视频反推结果不完整，请调整选帧或更换视觉模型后重试");
    let end = 0;
    for (const value of data.shots) {
        const shot = fields(value,["start","end","description","camera","action","prompt"]);
        if (typeof shot.start!=="number"||!Number.isFinite(shot.start)||typeof shot.end!=="number"||!Number.isFinite(shot.end)||shot.start<end||shot.end<=shot.start||shot.end>duration||[shot.description,shot.camera,shot.action,shot.prompt].some(value=>typeof value!=="string"||!value.trim())) throw Error("视频反推镜头时间或内容无效，请重新分析；原结果已保留");
        end = shot.end;
    }
    return data as DirectorVideoPrompt;
}
export const videoPromptSystem = `${videoReverseAnalysis}

只返回以下 JSON，不添加其他字段或 Markdown 代码块。各字段用中文，长文本可用换行分段，必须正确转义 JSON：
{"summary":"画面和叙事的简明概括","prompt":"可直接生成的详细整体正文：主体一致性、场景空间、镜头构图、光影色彩与材质、按时间组织的动作运镜和结束画面","negativePrompt":"针对原片的连续性约束和需要避免的画面问题","shots":[{"start":开始秒,"end":结束秒,"description":"详细的主体外观、空间层次、构图景别、光线色彩、材质和可见风格；注明参考帧时间","camera":"机位角度、焦点景深、起止构图及有依据的运镜方向与衔接；不确定的部分明确说明","action":"按参考帧时间写起始状态、可见动作变化、方向、互动及结束状态，保持主体 A／B 一致","prompt":"该镜可独立复用的完整视频提示词，不省略主体外观、场景光色和动作运镜细节"}],"uncertainties":["逐项列出采样不能确认的动作／切点／音轨／参数；切点只能估计时说明对应时间区间"]}。
shots 按时间排序、不重叠，0<=start<end<=提供的完整视频时长；可只覆盖有依据的区间，不把采样间隔直接当成切点。不得把待确认的推断写成已发生的事实。`;

export function formatVideoPrompt(value: DirectorVideoPrompt) {
    return [`【完整视频生成提示词】\n${value.prompt}`, value.negativePrompt && `【一致性与避免项】\n${value.negativePrompt}`,
        `【逐镜头详细提示词】\n${value.shots.map((shot,index)=>`${index+1}. ${shot.start}–${shot.end}s\n画面与构图：${shot.description}\n镜头与运镜：${shot.camera}\n动作与时间：${shot.action}\n本镜提示词：${shot.prompt}`).join("\n\n")}`,
        value.uncertainties?.length && `【待确认】\n${value.uncertainties.map(item=>`- ${item}`).join("\n")}`].filter(Boolean).join("\n\n");
}
