import { parseVideoResolution } from "@/lib/media-size";
import { modelOptionName, resolveModelChannel, resolveModelScript, type AiConfig } from "@/stores/use-config-store";

export type VideoReferenceSummary = { imageCount: number; audioCount: number; videoCount: number };
export const emptyVideoReferences: VideoReferenceSummary = { imageCount: 0, audioCount: 0, videoCount: 0 };

export function isGrokVideoModel(model: string) {
    return /^grok-imagine-video(?:$|-)/i.test(modelOptionName(model));
}

// Match the native request's reference_images/reference_audios branch, including
// automatic reference mode for more than two images. First/last frames differ.
export function usesGrokVideoReferences(config: AiConfig, inputs: VideoReferenceSummary) {
    const model = config.model || config.videoModel;
    return isGrokVideoModel(model) && resolveModelChannel(config, model).apiFormat === "openai" && !resolveModelScript(config, model)
        && !inputs.videoCount && Boolean(inputs.imageCount || inputs.audioCount)
        && (config.videoMode === "reference" || inputs.imageCount > 2 || inputs.audioCount > 0);
}

export function isUnsupportedGrokVideoResolution(config: AiConfig, inputs: VideoReferenceSummary) {
    return usesGrokVideoReferences(config, inputs) && parseVideoResolution(config.vquality) === "1080";
}
