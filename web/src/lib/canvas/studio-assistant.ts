import type { CanvasPluginAi, PluginModelCapability } from "@/types/canvas-plugin";
import type { CanvasNodeData } from "@/types/canvas";
import type { StudioSettings, SubtitleCue } from "@/types/studio";
import { screenplayEpisodeText, validateCues } from "./studio";
import { nanoid } from "nanoid";
import type { CanvasAgentOp } from "./canvas-agent-ops";

export function studioModelChoice(ai: CanvasPluginAi, saved: string | undefined, capability: PluginModelCapability) {
    const value = saved || ai.defaultModel(capability);
    const options = ai.listModels(capability);
    const ready = Boolean(value && (ai.isModelReady ? ai.isModelReady(value, capability) : options.some(option => option.value === value)));
    return { value, ready, options: value && !options.some(option => option.value === value) ? [...options, { value, label: `${value}（未配置）` }] : options };
}

export function studioReferenceText(s: StudioSettings = {}) {
    return [s.role && `角色：${s.role}`, s.outfit && `服装与场景：${s.outfit}`, s.style && `风格：${s.style}`].filter(Boolean).join("\n");
}

export function studioSourceText(sources: CanvasNodeData[]) {
    return sources.map(node => node.type === "studio:screenplay" && node.metadata?.studio?.screenplay
        ? screenplayEpisodeText(node.metadata.studio.screenplay, node.metadata.studio.episodeIndex)
        : node.type === "studio:reference" ? studioReferenceText(node.metadata?.studio)
        : node.type === "text" ? node.metadata?.content || node.metadata?.prompt : "").filter(Boolean).join("\n\n");
}

export function studioInputFingerprint(inputs: CanvasNodeData[]) {
    return JSON.stringify(inputs.map(n => [n.id, n.type, n.metadata?.content, n.metadata?.prompt, n.metadata?.studio, n.metadata?.storageKey, n.metadata?.primaryImageId, n.metadata?.images]));
}

export async function studioAdviceFingerprint(input: string) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function json(text: string): Record<string, unknown> {
    try {
        const result = JSON.parse(text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, ""));
        if (result && typeof result === "object" && !Array.isArray(result)) return result;
    } catch { /* Keep the current content when a model returns an invalid draft. */ }
    throw Error("模型返回的内容不完整，原内容已保留；请调整要求后手动重试");
}

export function readReferenceDraft(text: string) {
    const value = json(text);
    if (typeof value.role !== "string" || !value.role.trim() || typeof value.outfit !== "string" || typeof value.style !== "string") throw Error("模型未返回完整角色设定，原内容已保留");
    return { role: value.role.trim(), outfit: value.outfit.trim(), style: value.style.trim() };
}

export function readPromptDraft(text: string): string[] {
    const value = json(text);
    if (!Array.isArray(value.prompts) || !value.prompts.length || value.prompts.some(item => typeof item !== "string" || !item.trim())) throw Error("模型未返回有效画面提示词，原内容已保留");
    return value.prompts.map(item => item.trim().replace(/\s*\r?\n\s*/g, " "));
}

export function readSelectionAdvice(text: string, sources: CanvasNodeData[]) {
    const value = json(text);
    if (!Number.isInteger(value.index) || (value.index as number) < 1 || (value.index as number) > sources.length || typeof value.reason !== "string" || !value.reason.trim()) throw Error("模型未返回有效精选建议，请手动选择图片");
    return { sourceId: sources[(value.index as number) - 1].id, reason: value.reason.trim() };
}

export function readSubtitleCorrections(text: string, cues: SubtitleCue[]): SubtitleCue[] {
    validateCues(cues);
    const value = json(text);
    if (!Array.isArray(value.texts) || value.texts.length !== cues.length || value.texts.some(item => typeof item !== "string" || !item.trim())) throw Error("模型返回的字幕条数或内容无效，原字幕和时间轴已保留");
    const texts = value.texts as string[];
    return cues.map((cue, index) => ({ ...cue, text: texts[index].trim() }));
}

export function prepareStoryboarding(node: CanvasNodeData, nodes: CanvasNodeData[], links: { fromNodeId: string; toNodeId: string }[]) {
    const screenplay = node.metadata?.studio?.screenplay;
    if (!screenplay) throw Error("请先生成漫剧剧本");
    const board = nodes.find(n => n.type === "studio:storyboard" && links.some(link => link.fromNodeId === node.id && link.toNodeId === n.id));
    const reference = board && nodes.find(n => n.type === "studio:reference" && links.some(link => link.fromNodeId === n.id && link.toNodeId === board.id));
    const boardId = board?.id || nanoid(), referenceId = reference?.id || nanoid();
    const x = node.position.x + node.width + 100;
    const ops: CanvasAgentOp[] = [];
    if (!reference) ops.push({ type: "add_node", id: referenceId, nodeType: "studio:reference", position: { x, y: node.position.y + 330 }, metadata: { studio: { role: screenplay.characters.map(character => `${character.name}：${character.appearance}；性格：${character.personality}；声音：${character.voice}`).join("\n"), style: screenplay.style } } });
    if (!board) ops.push({ type: "add_node", id: boardId, nodeType: "studio:storyboard", position: { x, y: node.position.y }, metadata: { studio: { model: node.metadata?.studio?.model } } });
    else if (board.metadata?.studio?.sourceIds) ops.push({ type: "update_node", id: boardId, metadata: { studio: { ...board.metadata.studio, sourceIds: [...new Set([...board.metadata.studio.sourceIds, node.id, referenceId])] } } });
    ops.push({ type: "connect_nodes", fromNodeId: node.id, toNodeId: referenceId }, { type: "connect_nodes", fromNodeId: node.id, toNodeId: boardId }, { type: "connect_nodes", fromNodeId: referenceId, toNodeId: boardId }, { type: "select_nodes", ids: [boardId] });
    return { ops, boardId };
}
