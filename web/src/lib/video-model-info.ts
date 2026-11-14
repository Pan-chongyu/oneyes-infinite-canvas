import type { AiConfig } from "@/stores/use-config-store";
import { inferVideoRatio, parseVideoResolution } from "./media-size";
import { videoModelCatalog, type VideoModelInfo } from "./video-model-catalog";

/** The audited OneYes bridge prices must not label another provider or a script. */
export function getVideoModelInfo(config: AiConfig, value = config.model || config.videoModel): VideoModelInfo | undefined {
    const separator = value.indexOf("::");
    const model = separator < 0 ? value : value.slice(separator + 2);
    const channel = separator < 0
        ? config.channels.find((entry) => entry.models.some((item) => item.name === model))
        : config.channels.find((entry) => entry.id === value.slice(0, separator));
    if (separator >= 0 && !channel) return undefined;
    if (channel?.models.find((entry) => entry.name === model)?.script?.trim()) return undefined;
    try {
        const url = new URL(channel?.baseUrl || config.baseUrl);
        if (!["https:", "http:"].includes(url.protocol) || !["api.oneyes.ai", "oneyes.ai"].includes(url.hostname)) return undefined;
    } catch { return undefined; }
    return videoModelCatalog.find((entry) => model === entry.id || model.startsWith(`${entry.id} [`));
}

export function videoModelOptionName(config: AiConfig, value: string) {
    const info = getVideoModelInfo(config, value);
    if (!info) return value.includes("::") ? value.slice(value.indexOf("::") + 2) : value;
    return `${info.id} [${info.summary}]`;
}

/** Display one entry per channel/model while preserving the exact selected ID. */
export function videoModelOptions(config: AiConfig, options: string[], current?: string) {
    return options.filter((value) => {
        const info = getVideoModelInfo(config, value);
        if (!info) return true;
        const channel = value.includes("::") ? value.slice(0, value.indexOf("::") + 2) : "";
        const candidates = options.filter(item => item.startsWith(channel) && getVideoModelInfo(config, item)?.id === info.id);
        const preferred = candidates.includes(current || "") ? current : candidates.find(item => item === `${channel}${info.id}`) || candidates[0];
        return value === preferred;
    });
}

/** Reject unsupported selections before a paid POST; never mutate saved choices. */
export function videoModelConfigError(config: AiConfig, value = config.model || config.videoModel, inputs?: { imageCount: number; videoCount: number; audioCount: number }) {
    const info = getVideoModelInfo(config, value);
    if (!info) return undefined;
    const resolution = parseVideoResolution(config.vquality).toLowerCase();
    if (!info.resolutions.includes(resolution)) return `该模型支持 ${info.resolutions.map(tierLabel).join(" / ")}，请主动选择支持的分辨率；已保留原设置。`;
    const seconds = Number(config.videoSeconds);
    if (!Number.isInteger(seconds) || seconds < info.duration.min || seconds > info.duration.max || info.duration.values && !info.duration.values.includes(seconds)) {
        return `该模型支持 ${info.duration.values?.join(" / ") || `${info.duration.min}–${info.duration.max}`} 秒，请选择支持的时长。`;
    }
    const ratio = inferVideoRatio(config.size || "auto");
    if (!info.ratios.includes(ratio)) return `该模型支持 ${info.ratios.map(item => item === "auto" ? "自动比例" : item).join(" / ")}，请调整画幅比例。`;
    const mode = config.videoMode === "reference" ? "reference" : "frames";
    if (!info.modes.includes(mode)) return "该模型仅支持参考模式，请在参数面板中主动切换；已保留原设置。";
    if (info.audio === "required" && config.videoGenerateAudio === "false") return "该模型固定生成音频，请在参数面板中开启生成音频。";
    if (!inputs) return undefined;
    const limits = info.referenceLimits;
    for (const [kind, count, label] of [["images", inputs.imageCount, "图片"], ["videos", inputs.videoCount, "视频"], ["audios", inputs.audioCount, "音频"]] as const) {
        if (limits[kind] !== undefined && count > limits[kind]) return `该模型最多支持 ${limits[kind]} 个参考${label}，请调整参考素材。`;
    }
    if (limits.total !== undefined && inputs.imageCount + inputs.videoCount + inputs.audioCount > limits.total) return `该模型参考素材合计最多 ${limits.total} 个。`;
    if (info.id === "minimax-h3" && resolution !== "768") {
        if (inputs.imageCount > 6) return "MiniMax 1080p / 2K 最多支持 6 张参考图片，请调整素材。";
        if (!["16:9", "9:16"].includes(ratio)) return "MiniMax 1080p / 2K 仅支持 16:9 或 9:16，请调整比例。";
        if (mode === "frames" && inputs.imageCount > 0) return "MiniMax 首尾帧仅支持 768p，请主动选择分辨率或参考模式。";
    }
    if (info.id === "grok-imagine-video" && mode === "reference" && inputs.imageCount && seconds > 10) return "Grok 参考图片模式最多支持 10 秒，请调整时长。";
    if (info.id === "grok-imagine-video-1.5" && (mode === "reference" && inputs.imageCount || inputs.audioCount || inputs.imageCount > 2) && resolution === "1080") return "Grok 1.5 多参考素材仅支持 480p / 720p，请主动调整分辨率。";
    if (info.id === "doubao-seedance-2.5" && mode === "frames" && inputs.imageCount && ratio !== "auto") return "Seedance 2.5 首尾帧仅支持自动比例，请主动选择自动比例。";
    return undefined;
}

export function tierLabel(value: string) {
    return /k$/i.test(value) ? value.toUpperCase() : `${value}p`;
}
