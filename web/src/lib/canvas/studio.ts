import type { CanvasNodeData } from "@/types/canvas";
import type { Screenplay, StoryShot, SubtitleCue, StudioTool } from "@/types/studio";

export const studioTools = {
    decision: { title: "JEV 决策", description: "判断文本、选择方案或按标准评分，查看概率与置信度", action: "运行决策" },
    screenplay: { title: "漫剧剧本", description: "故事梗概 → 分集、角色设定与结尾钩子", action: "拆解漫剧剧本" },
    storyboard: { title: "漫剧分镜", description: "分集剧本 → 场景、人物、景别和连续性分镜", action: "生成分镜" },
    reference: { title: "角色与风格参考", description: "统一角色、服装、场景与参考图片", action: "保存角色设定" },
    batch: { title: "分镜批量生图", description: "逐项生成画面，失败暂停，保留已有任务", action: "开始批量生成" },
    compare: { title: "结果对比与精选", description: "并排或滑动比较原图，选择结果传给下游", action: "输出精选图片" },
    subtitles: { title: "语音转字幕", description: "识别音视频，编辑时间轴，导出 SRT 或字幕视频", action: "识别字幕" },
    ocr: { title: "OCR 文字提取", description: "使用视觉模型提取图片文字，保留段落", action: "提取文字" },
    export: { title: "批量导出", description: "按顺序打包原始素材、提示词和参数", action: "导出 ZIP" },
};
export function studioAccepts(tool: StudioTool, type: string) {
    if (tool === "screenplay" || tool === "decision") return type === "text";
    if (tool === "storyboard") return ["text", "studio:screenplay", "studio:reference"].includes(type);
    if (tool === "batch") return ["image", "text", "studio:reference"].includes(type);
    if (tool === "subtitles") return ["audio", "video"].includes(type);
    if (tool === "export") return ["image", "video", "audio", "text"].includes(type);
    return type === "image";
}
export function studioSources(node: CanvasNodeData, nodes: CanvasNodeData[], links: { fromNodeId: string; toNodeId: string }[]) {
    const ids = node.metadata?.studio?.sourceIds ?? links.filter((link) => link.toNodeId === node.id).map((link) => link.fromNodeId);
    return [...new Set(ids)].map((id) => {
        const source = nodes.find((item) => item.id === id);
        if (!source) throw Error("所选素材已删除，请重新选择");
        if (source.id === node.id || (node.type.startsWith("studio:") && !studioAccepts(node.type.slice(7) as StudioTool, source.type))) throw Error(`「${source.title}」类型不匹配，请移除该连线或重新选择素材`);
        return source;
    });
}
export function shotsToBatchText(shots: StoryShot[]) {
    return readShots(JSON.stringify(shots)).map(shot => shotVisualPrompt(shot)).join("\n");
}
export function shotVisualPrompt(shot: StoryShot) {
    return [shot.scene && `场景：${shot.scene}`, shot.characters && `人物：${shot.characters}`, shot.framing && `景别：${shot.framing}`, shot.picture, shot.continuity && `连续性：${shot.continuity}`, shot.camera && `运镜：${shot.camera}`].filter(Boolean).join("；").replace(/\s*\r?\n\s*/g, " ");
}
export function shotVideoPrompt(shot: StoryShot) {
    return [shotVisualPrompt(shot), shot.dialogue && `台词：${shot.dialogue}`, `参考时长：${shot.seconds} 秒`].filter(Boolean).join("\n");
}
export function readScreenplay(text: string): Screenplay {
    let raw: unknown;
    try { raw = JSON.parse(text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")); }
    catch { throw Error("模型未返回有效剧本 JSON，请调整故事后重试"); }
    const parsed = asRecord(raw);
    const source = asRecord(parsed?.screenplay) || parsed;
    if (!source || !Array.isArray(source.episodes) || !source.episodes.length || !Array.isArray(source.characters)) throw Error("剧本缺少分集或角色设定，请重新生成");
    const characters = source.characters.map((value: unknown) => {
        const item = asRecord(value);
        return { name: String(item?.name || "").trim(), appearance: String(item?.appearance || "").trim(), personality: String(item?.personality || "").trim(), voice: String(item?.voice || "").trim() };
    });
    if (characters.some((item: Screenplay["characters"][number]) => !item.name || !item.appearance)) throw Error("角色姓名或外形设定为空，请重新生成");
    const episodes = source.episodes.map((value: unknown, index: number) => {
        const item = asRecord(value);
        return { title: String(item?.title || `第${index + 1}集`).trim(), synopsis: String(item?.synopsis || "").trim(), script: String(item?.script || "").trim(), cliffhanger: String(item?.cliffhanger || "").trim() };
    });
    if (episodes.some((item: Screenplay["episodes"][number]) => !item.title || !item.script)) throw Error("分集标题或剧本内容为空，请重新生成");
    return { logline: String(source.logline || "").trim(), style: String(source.style || "").trim(), characters, episodes };
}
function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
export function screenplayEpisodeText(screenplay: Screenplay, episodeIndex = 0) {
    const episode = screenplay.episodes[Math.min(Math.max(0, episodeIndex), screenplay.episodes.length - 1)];
    return [screenplay.logline && `全剧梗概：${screenplay.logline}`, screenplay.style && `视觉风格：${screenplay.style}`, screenplay.characters.length && `角色设定：\n${screenplay.characters.map(item => `${item.name}：${item.appearance}${item.personality ? `；性格：${item.personality}` : ""}${item.voice ? `；声音：${item.voice}` : ""}`).join("\n")}`, `${episode.title}${episode.synopsis ? `：${episode.synopsis}` : ""}`, episode.script, episode.cliffhanger && `本集结尾钩子：${episode.cliffhanger}`].filter(Boolean).join("\n\n");
}
export function batchPrompts(node: CanvasNodeData, sources: CanvasNodeData[]) {
    return [node.metadata?.studio?.text, ...sources.filter(n => n.type === "text").map(n => n.metadata?.content || n.metadata?.prompt)].filter(Boolean).join("\n").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}
export function readShots(text: string): StoryShot[] {
    let raw;
    try { raw = JSON.parse(text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")); }
    catch { throw Error('模型未返回有效分镜 JSON，请调整故事后重试'); }
    const shots = Array.isArray(raw) ? raw : raw?.shots;
    if (!Array.isArray(shots) || !shots.length) throw Error("模型未返回有效分镜，请调整故事后重试");
    return shots.map((shot, index) => {
        if (!shot || typeof shot.picture !== "string" || !shot.picture.trim() || !Number.isFinite(shot.seconds) || shot.seconds <= 0) throw Error(`镜头 ${index + 1} 的画面或时长无效`);
        return {
            title: typeof shot.title === "string" ? shot.title : `镜头 ${index + 1}`,
            picture: shot.picture,
            dialogue: typeof shot.dialogue === "string" ? shot.dialogue : "",
            seconds: shot.seconds,
            camera: typeof shot.camera === "string" ? shot.camera : "",
            scene: typeof shot.scene === "string" ? shot.scene : "",
            characters: typeof shot.characters === "string" ? shot.characters : "",
            framing: typeof shot.framing === "string" ? shot.framing : "",
            continuity: typeof shot.continuity === "string" ? shot.continuity : "",
        };
    });
}
export function validateCues(cues: SubtitleCue[]) {
    if (!Array.isArray(cues) || !cues.length) throw Error("字幕为空，请先识别或填写字幕");
    let previous = 0;
    for (const cue of cues) {
        if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < previous || cue.end <= cue.start || typeof cue.text !== "string" || !cue.text.trim()) throw Error("字幕时间无效或重叠，请检查起止时间和内容");
        previous = cue.end;
    }
    return cues;
}
export function subtitleSrt(cues: SubtitleCue[]) {
    const stamp = (seconds: number) => {
        const ms = Math.round(seconds * 1000);
        return [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60].map((n) => String(n).padStart(2, "0")).join(":") + "," + String(ms % 1000).padStart(3, "0");
    };
    return (
        validateCues(cues)
            .map((cue, index) => `${index + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text.replace(/\r/g, "").replace(/\n\s*\n/g, "\n")}`)
            .join("\n\n") + "\n"
    );
}
export const exportName = (value: string) => value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/^\.+|[. ]+$/g, "") || "素材";
