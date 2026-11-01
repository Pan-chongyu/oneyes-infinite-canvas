import type { CanvasNodeData, CanvasConnection } from "@/types/canvas";
import type { EditAnalysis, SmartEditSettings } from "@/types/smart-edit";
import type { CanvasPluginAi } from "@/types/canvas-plugin";
import type { CreatorProgress } from "@/types/creator-tools";
import { editFingerprint, validateEditAnalysis, smartEditDefaults, readEditPlan, smartEditSystem, validateEditClips, editSubtitles, editDuration } from "@/lib/canvas/smart-edit";
import { validateCues } from "@/lib/canvas/studio";
import { processNativeVideo } from "./creator-media";

export async function analyzeEdit(sources: CanvasNodeData[], settings: SmartEditSettings, links: CanvasConnection[], signal: AbortSignal, progress: (p: CreatorProgress) => void) {
    const media = sources.filter((s) => s.type === "video" || s.type === "image");
    if (!media.length) throw Error("请先连接视频或图片素材");
    const result = await processNativeVideo(
        "editAnalyze",
        media,
        { edit: { ...smartEditDefaults, ...Object.fromEntries(Object.entries(settings).filter(([k]) => ["silenceDb", "silenceSeconds", "sceneThreshold", "imageSeconds"].includes(k))), kinds: media.map((s) => s.type) } },
        signal,
        progress,
    );
    const analysis = validateEditAnalysis(JSON.parse(await result[0].blob.text()), sources, editFingerprint(sources, settings, links));
    for (const node of sources.filter((n) => n.type === "studio:subtitles" && n.metadata?.studio?.cues?.length)) {
        const ids = node.metadata!.studio!.sourceIds ?? links.filter((l) => l.toNodeId === node.id).map((l) => l.fromNodeId);
        if (ids.length !== 1) throw Error(`请在「${node.title}」中明确选择一个字幕来源`);
        const target = analysis.sources.find((s) => s.id === ids[0]);
        if (!target) throw Error(`「${node.title}」的字幕来源未加入剪辑素材`);
        const cues = validateCues(node.metadata!.studio!.cues!);
        if (cues.some((c) => c.end > target.duration)) throw Error(`「${node.title}」的字幕超出视频时长，请检查对应素材`);
        if (target.cues) throw Error(`「${target.title}」关联了多份字幕，请保留一份`);
        target.cues = cues;
    }
    return analysis;
}
export async function proposeEdit(ai: CanvasPluginAi, sources: CanvasNodeData[], settings: SmartEditSettings, analysis: EditAnalysis, signal: AbortSignal) {
    const instruction = [
        settings.instruction,
        ...sources.filter((n) => n.type === "text").map((n) => n.metadata?.content || n.metadata?.prompt),
        ...sources.filter((n) => n.type === "studio:storyboard").map((n) => JSON.stringify(n.metadata?.studio?.shots || [])),
    ]
        .filter(Boolean)
        .join("\n");
    if (!instruction.trim()) throw Error("请填写剪辑要求，或连接脚本／文本节点");
    const input = { instruction, sources: analysis.sources };
    const result = await ai.generateText(JSON.stringify(input), { signal, model: settings.model, system: smartEditSystem });
    signal.throwIfAborted();
    return readEditPlan(result.text, analysis);
}
export async function renderEdit(sources: CanvasNodeData[], settings: SmartEditSettings, signal: AbortSignal, progress: (p: CreatorProgress) => void, links: CanvasConnection[] = []) {
    const analysis = settings.analysis;
    if (!analysis || analysis.fingerprint !== editFingerprint(sources, settings, links)) throw Error("素材或分析参数已改变，请先重新分析");
    const clips = validateEditClips(settings.clips || [], analysis),
        transition = settings.transition ?? smartEditDefaults.transition;
    editDuration(clips, transition);
    const srt = editSubtitles(clips, analysis, transition);
    if (settings.burnSubtitles && !srt) throw Error("没有可烧录的字幕，请先识别字幕或取消烧录");
    const media = sources.filter((n) => ["video", "image", "audio"].includes(n.type));
    const result = await processNativeVideo(
        "editRender",
        media,
        {
            edit: {
                kinds: media.map((n) => n.type),
                imageSeconds: settings.imageSeconds ?? smartEditDefaults.imageSeconds,
                clips: clips.map((c) => ({ sourceIndex: media.findIndex((n) => n.id === c.sourceId), start: c.start, end: c.end })),
                color: settings.color || "original",
                transition,
                audioFade: settings.audioFade ?? smartEditDefaults.audioFade,
                originalVolume: settings.originalVolume ?? smartEditDefaults.originalVolume,
                musicVolume: settings.musicVolume ?? smartEditDefaults.musicVolume,
                title: settings.title || "",
                srt: settings.burnSubtitles ? srt : "",
            },
        },
        signal,
        progress,
    );
    return { video: result[0], srt };
}
