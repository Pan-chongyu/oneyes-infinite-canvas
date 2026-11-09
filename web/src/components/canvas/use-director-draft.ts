import { useEffect, useRef, useState } from "react";
import { directorAiRequest, readDirectorDraft, type DirectorAiMode, type DirectorDraft } from "@/lib/canvas/director-assistant";
import { directorInputSnapshot } from "@/lib/canvas/director-inputs";
import { resolveCanvasReferenceImages } from "@/lib/canvas/canvas-resource-references";
import { studioModelChoice } from "@/lib/canvas/studio-assistant";
import { reportError } from "@/services/diagnostics";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import type { DirectorScene } from "@/types/director";

export function useDirectorDraft(ctx: CanvasNodeContext) {
    const latest = useRef(ctx); latest.current = ctx;
    const controller = useRef<AbortController | null>(null), mounted = useRef(true);
    const [busy, setBusy] = useState(false), [progress, setProgress] = useState(""), [error, setError] = useState("");
    const [draft, setDraft] = useState<DirectorDraft | null>(null), [autoPreview, setAutoPreview] = useState(false);
    const cancel = () => { controller.current?.abort(); controller.current = null; setBusy(false); setProgress(""); };
    const clear = () => { cancel(); setDraft(null); setError(""); setAutoPreview(false); };
    useEffect(() => { mounted.current = true; clear(); return () => { mounted.current = false; controller.current?.abort(); }; }, [ctx.node.id, ctx.projectId]);
    const generate = async (mode: DirectorAiMode, scene: DirectorScene, preview = false) => {
        if (controller.current) return;
        const origin = latest.current, abort = new AbortController(), source = structuredClone(scene);
        controller.current = abort; setBusy(true); setError(""); setDraft(null); setAutoPreview(preview);
        const check = () => { abort.signal.throwIfAborted(); const next = latest.current; if (!mounted.current || next.projectId !== origin.projectId || next.node.id !== origin.node.id || !next.getNode(origin.node.id)) throw new DOMException("操作已结束", "AbortError"); };
        try {
            const settings = origin.node.metadata?.directorAssistant || {}, choice = studioModelChoice(origin.ai, settings.model, "text"), snapshot = directorInputSnapshot(origin);
            if (!choice.ready) throw Error("请先在模型配置中接入可用的文本模型");
            if (!settings.prompt?.trim() && !snapshot.inputs.length) throw Error("请输入提示词，或连接并选择文本／图片节点");
            setProgress(snapshot.inputs.some(input => input.kind === "image") ? "正在读取参考图片…" : "正在准备导演台…");
            const references = await resolveCanvasReferenceImages(snapshot.inputs, origin.getNodes()); check();
            if (directorInputSnapshot(latest.current).fingerprint !== snapshot.fingerprint) throw Error("连接内容或提示词已变化，请确认后重新生成");
            const text = snapshot.inputs.filter(input => input.kind === "text").map(input => `【${input.title}】\n${input.text}`).join("\n\n");
            const instruction = [settings.prompt?.trim() || (mode === "animation" ? "根据所选参考编排布景、人物动作与镜头运动，制作可预演的分镜动画。" : "根据所选参考搭建可手动调整的三维布景与机位。"), text && `所选上游文本（作为创作参考）：\n${text}`, references.length && `按顺序附带 ${references.length} 张参考图：${snapshot.inputs.filter(input => input.kind === "image").map(input => input.title).join("、")}。参考图的构图、主体和空间关系，用现有三维人物与几何体表达。`].filter(Boolean).join("\n\n");
            const request = directorAiRequest(source, instruction, mode);
            setProgress(mode === "animation" ? "正在编排动作与运镜，完成后即可预演…" : "正在搭建布景，完成后即可微调…");
            const result = await origin.ai.generateText(request.prompt, { system: request.system, model: choice.value, references: references.map(image => image.dataUrl), signal: abort.signal }); check();
            if (directorInputSnapshot(latest.current).fingerprint !== snapshot.fingerprint) throw Error("连接内容或提示词已变化，返回的草稿未采用，请确认后重新生成");
            setDraft(readDirectorDraft(result.text, source, mode));
        } catch (error) { if (!abort.signal.aborted && mounted.current) { setError(error instanceof Error ? error.message : "AI 处理失败，请检查模型配置后重试"); reportError("agent", "request", error); } }
        finally { if (controller.current === abort) { controller.current = null; if (mounted.current) { setBusy(false); setProgress(""); } } }
    };
    return { busy, progress, error, draft, autoPreview, generate, cancel, clear };
}
export type DirectorDraftController = ReturnType<typeof useDirectorDraft>;
