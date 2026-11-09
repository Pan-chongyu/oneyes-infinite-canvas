import { buildCanvasResourceReferences, getGroupResourceNodes, type CanvasResourceReference } from "./canvas-resource-references";
import { studioSourceText } from "./studio-assistant";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

export function directorInputs(ctx: CanvasNodeContext): CanvasResourceReference[] {
    const nodes = ctx.getNodes(), connections = ctx.getConnections();
    const upstream = ctx.getUpstream().flatMap(node => node.type === "group" || node.type === "studio:reference" ? getGroupResourceNodes(node.id, nodes, connections) : [node]);
    return [...new Map(upstream.map(node => [node.id, node])).values()].flatMap(node => {
        const text = (studioSourceText([node]) || (node.type === "config" ? node.metadata?.composerContent || node.metadata?.prompt : "") || "").trim();
        const resource = buildCanvasResourceReferences([node.type === "image" && !node.metadata?.content ? { ...node, metadata: { ...node.metadata, content: node.metadata?.storageKey } } : node])[0];
        if (resource?.kind === "image") return [resource];
        if (text || resource?.kind === "text" && resource.text?.trim()) return [{ id: node.id, nodeId: node.id, kind: "text", label: "文本", title: node.title || "参考文本", text: text || resource?.text, active: true }];
        return [];
    });
}

export function directorInputSnapshot(ctx: CanvasNodeContext) {
    const settings = ctx.node.metadata?.directorAssistant || {}, inputs = directorInputs(ctx).filter(input => !settings.sourceIds || settings.sourceIds.includes(input.nodeId));
    return { inputs, fingerprint: JSON.stringify([settings.prompt || "", settings.model, settings.sourceIds, inputs.map(input => [input.nodeId, input.kind, input.text, input.previewUrl, ctx.getNode(input.nodeId)?.metadata])]) };
}
