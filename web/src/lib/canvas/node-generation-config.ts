import { defaultConfig, resolveModelForCapability, type AiConfig } from "@/stores/use-config-store";
import type { CanvasGenerationMode, CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import { videoModelNodePatch } from "@/lib/video-model-defaults";

export function buildGenerationConfig(config: AiConfig, node: CanvasNodeData | undefined, mode: CanvasGenerationMode): AiConfig {
    return {
        ...config,
        model: resolveModelForCapability(config, node?.metadata?.model, mode),
        reasoningEffort: node?.metadata?.reasoningEffort || config.reasoningEffort || defaultConfig.reasoningEffort,
        quality: node?.metadata?.quality || config.quality || defaultConfig.quality,
        size: (node?.type === "config" && node.metadata?.generationMode && mode !== node.metadata.generationMode && (mode === "image" || mode === "video")
            ? node.metadata.generationSizes?.[mode]
            : node?.metadata?.size) || config.size || defaultConfig.size,
        background: node?.metadata?.background ?? config.background ?? defaultConfig.background,
        videoSeconds: node?.metadata?.seconds || config.videoSeconds || defaultConfig.videoSeconds,
        vquality: node?.metadata?.vquality || config.vquality || defaultConfig.vquality,
        videoGenerateAudio: node?.metadata?.generateAudio || config.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node?.metadata?.watermark || config.videoWatermark || defaultConfig.videoWatermark,
        videoMode: node?.metadata?.videoMode || config.videoMode || defaultConfig.videoMode,
        audioVoice: node?.metadata?.audioVoice || config.audioVoice || defaultConfig.audioVoice,
        audioFormat: node?.metadata?.audioFormat || config.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node?.metadata?.audioSpeed || config.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node?.metadata?.audioInstructions || config.audioInstructions || defaultConfig.audioInstructions,
        count: String(node?.metadata?.count || (mode === "image" ? config.canvasImageCount || config.count : config.count) || defaultConfig.count),
    };
}

/** Preserve each media mode's size; `size` remains the active request value. */
export function generationModePatch(config: AiConfig, node: CanvasNodeData, mode: CanvasGenerationMode): Partial<CanvasNodeMetadata> {
    const previous = node.metadata?.generationMode || "image";
    if (previous === mode) return {};
    const generationSizes = { ...node.metadata?.generationSizes };
    if (previous === "image" || previous === "video") generationSizes[previous] = buildGenerationConfig(config, node, previous).size;
    const video: Partial<CanvasNodeMetadata> = mode === "video" && !generationSizes.video ? videoModelNodePatch(config, resolveModelForCapability(config, node.metadata?.model, "video")) : {};
    const size = mode === "image" || mode === "video" ? generationSizes[mode] || (mode === "video" ? video.size : config.size) : node.metadata?.size;
    return { ...video, generationMode: mode, generationSizes, ...(size ? { size } : {}) };
}
