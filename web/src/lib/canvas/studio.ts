import type { CanvasNodeData } from "@/types/canvas";
import type { StoryShot, SubtitleCue, StudioTool } from "@/types/studio";

export const studioTools = {
    decision: { title: "JEV 决策", description: "判断文本、选择方案或按标准评分，查看概率与置信度", action: "运行决策" },
    storyboard: { title: "分镜脚本", description: "将故事拆成可编辑镜头，再连接生图与视频", action: "生成分镜" },
    reference: { title: "角色与风格参考", description: "统一角色、服装、场景与参考图片", action: "输出参考组" },
    batch: { title: "批量任务", description: "逐项生成图片，失败暂停，保留已有任务", action: "开始批量生成" },
    compare: { title: "结果对比与精选", description: "并排或滑动比较原图，选择结果传给下游", action: "输出精选图片" },
    subtitles: { title: "语音转字幕", description: "识别音视频，编辑时间轴，导出 SRT 或字幕视频", action: "识别字幕" },
    ocr: { title: "OCR 文字提取", description: "使用视觉模型提取图片文字，保留段落", action: "提取文字" },
    export: { title: "批量导出", description: "按顺序打包原始素材、提示词和参数", action: "导出 ZIP" },
};
export function studioAccepts(tool: StudioTool, type: string) {
    if (tool === "storyboard" || tool === "decision") return type === "text";
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
    return readShots(JSON.stringify(shots)).map(shot => [shot.picture, shot.camera && `运镜：${shot.camera}`, shot.dialogue && `台词：${shot.dialogue}`].filter(Boolean).join("；").replace(/\s*\r?\n\s*/g, " ")).join("\n");
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
