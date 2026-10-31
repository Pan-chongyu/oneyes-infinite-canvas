import { parseVideoResolution } from "@/lib/media-size";
import { modelOptionName, resolveModelChannel, resolveModelScript, type AiConfig } from "@/stores/use-config-store";

export type VideoReferenceSummary = { imageCount: number; audioCount: number; videoCount: number };
export const emptyVideoReferences: VideoReferenceSummary = { imageCount: 0, audioCount: 0, videoCount: 0 };

export const miniMaxVideoResolutionOptions = [
    { value: "768", label: "768P" },
    { value: "1080", label: "1080P" },
    { value: "2K", label: "2K" },
] as const;

export function isMiniMaxVideoModel(model: string) {
    return /^minimax-h/i.test(modelOptionName(model));
}

export function videoResolutionOptionsForModel(model: string | undefined) {
    return isMiniMaxVideoModel(model || "")
        ? miniMaxVideoResolutionOptions.map((item) => ({ ...item }))
        : [
            { value: "480", label: "480p" },
            { value: "720", label: "720p" },
            { value: "1080", label: "1080p" },
        ];
}

export function isSupportedMiniMaxVideoResolution(value: string | undefined) {
    const normalized = parseVideoResolution(value);
    return miniMaxVideoResolutionOptions.some((item) => item.value === normalized);
}

export function isUnsupportedMiniMaxVideoResolution(config: AiConfig) {
    const model = config.model || config.videoModel;
    return isMiniMaxVideoModel(model) && !isSupportedMiniMaxVideoResolution(config.vquality);
}

export function normalizeVideoResolutionForModel(value: string | undefined, model: string | undefined) {
    const normalized = parseVideoResolution(value);
    if (isMiniMaxVideoModel(model || "")) return normalized === "2K" ? "2K" : `${normalized}P`;
    return normalized === "2K" ? "2Kp" : `${normalized}p`;
}

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
