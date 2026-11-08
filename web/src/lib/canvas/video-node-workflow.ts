import { nanoid } from "nanoid";
import i18n from "@/i18n";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { createCanvasNode } from "./canvas-node-factory";
import { buildGenerationConfig } from "./canvas-generation-helpers";
import { DEFAULT_VIDEO_FRAME_COUNT } from "@/services/director-video";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasConnection } from "@/types/canvas";

export function createVideoNodeWorkflow(source: CanvasNodeData, config: AiConfig, kind: "reverse" | "generate", nodes: CanvasNodeData[] = []) {
    if (source.type !== CanvasNodeType.Video || !source.metadata?.content) throw Error(i18n.t("canvas.videoWorkflow.empty"));
    const reverse = kind === "reverse", metadata = source.metadata;
    const prompt = reverse ? i18n.t("canvas.videoWorkflow.preset") : metadata.prompt || "";
    const gap = 96, left = source.position.x + source.width + gap, height = Math.max(NODE_DEFAULT_SIZE.text.height, NODE_DEFAULT_SIZE.config.height);
    let centerY = source.position.y + source.height / 2;
    while (true) {
        const occupied = nodes.filter(node => node.position.x < left + NODE_DEFAULT_SIZE.text.width + gap + NODE_DEFAULT_SIZE.config.width && node.position.x + node.width > left && node.position.y < centerY + height / 2 && node.position.y + node.height > centerY - height / 2);
        if (!occupied.length) break;
        centerY = Math.max(...occupied.map(node => node.position.y + node.height)) + gap + height / 2;
    }
    const textNode = createCanvasNode(CanvasNodeType.Text, { x: left + NODE_DEFAULT_SIZE.text.width / 2, y: centerY }, { content: prompt, prompt, status: "success", fontSize: 14 });
    textNode.title = i18n.t(reverse ? "canvas.videoWorkflow.taskTitle" : "canvas.videoWorkflow.promptTitle");
    const recipe = buildGenerationConfig(config, source, "video");
    // Reuse the saved input media, not the generated video as an accidental edit input.
    const references = reverse ? [source] : [...new Set(metadata.references || [])].map(key => {
        const node = nodes.find(item => item.id !== source.id && [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio].includes(item.type as CanvasNodeType) && (item.metadata?.storageKey === key || item.metadata?.content === key));
        if (!node) throw Error(i18n.t("canvas.videoWorkflow.missingReference"));
        return node;
    });
    const configNode = createCanvasNode(CanvasNodeType.Config, { x: textNode.position.x + textNode.width + gap + NODE_DEFAULT_SIZE.config.width / 2, y: centerY }, {
        generationMode: reverse ? "text" : "video",
        ...(reverse ? { model: config.textModel, textCount: 1, videoFrameCount: DEFAULT_VIDEO_FRAME_COUNT, videoPromptSourceId: source.id } : {
            model: recipe.model, size: metadata.size || recipe.size, seconds: recipe.videoSeconds,
            vquality: recipe.vquality, generateAudio: recipe.videoGenerateAudio, watermark: recipe.videoWatermark, videoMode: recipe.videoMode,
        }),
        composerContent: [...references.map(node => `@[node:${node.id}]`), `@[node:${textNode.id}]`].join("\n"),
    });
    configNode.title = i18n.t(reverse ? "canvas.videoWorkflow.configTitle" : "canvas.videoWorkflow.generate");
    const connections: CanvasConnection[] = [...references, textNode].map(node => ({ id: nanoid(), fromNodeId: node.id, toNodeId: configNode.id }));
    return { nodes: [textNode, configNode], connections, configNode };
}
