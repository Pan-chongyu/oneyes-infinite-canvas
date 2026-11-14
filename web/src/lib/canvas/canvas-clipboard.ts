import type { CanvasNodeData } from "@/types/canvas";

export function remapCopiedNodeReferences(node: CanvasNodeData, ids: ReadonlyMap<string, string>): CanvasNodeData {
    const metadata = node.metadata;
    if (!metadata) return node;
    const sourceId = (id: string) => ids.get(id) ?? id;
    const mentions = (text: string) => text.replace(/@\[node:([^\]]+)\]/g, (_token, id: string) => `@[node:${sourceId(id)}]`);
    return { ...node, metadata: {
        ...metadata,
        ...(metadata.groupId && { groupId: ids.get(metadata.groupId) }),
        ...(metadata.composerContent !== undefined && { composerContent: mentions(metadata.composerContent) }),
        ...(metadata.prompt !== undefined && { prompt: mentions(metadata.prompt) }),
        ...(metadata.videoPromptSourceId && { videoPromptSourceId: sourceId(metadata.videoPromptSourceId) }),
        ...(metadata.studio && { studio: { ...metadata.studio,
            ...(metadata.studio.sourceIds && { sourceIds: metadata.studio.sourceIds.map(sourceId) }),
            ...(metadata.studio.selectedId && { selectedId: sourceId(metadata.studio.selectedId) }),
            ...(metadata.studio.selectionAdvice && { selectionAdvice: { ...metadata.studio.selectionAdvice, sourceId: sourceId(metadata.studio.selectionAdvice.sourceId) } }),
        } }),
        ...(metadata.directorAssistant?.sourceIds && { directorAssistant: { ...metadata.directorAssistant, sourceIds: metadata.directorAssistant.sourceIds.map(sourceId) } }),
    } };
}
