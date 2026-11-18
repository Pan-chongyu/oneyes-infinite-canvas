import type { AiConfig } from "@/stores/use-config-store";
import { inferVideoRatio, parseVideoResolution, parsePixelSize, parseAspectRatio } from "./media-size";
import { videoModelCatalog, type VideoModelInfo } from "./video-model-catalog";
import { modelInformationPriority, splitModelInformation } from './model-information';
import { videoDisplayText } from './video-display-text';
import displaySnapshot from './video-model-display-catalog.json';
const displayCatalog = displaySnapshot.data;

/** The audited OneYes bridge prices must not label another provider or a script. */
export function getVideoModelInfo(config: AiConfig, value = config.model || config.videoModel): VideoModelInfo | undefined {
    const separator = value.indexOf("::");
    const model = separator < 0 ? value : value.slice(separator + 2);
    const channel = separator < 0
        ? config.channels.find((entry) => entry.models.some((item) => item.name === model))
        : config.channels.find((entry) => entry.id === value.slice(0, separator));
    if (separator >= 0 && !channel) return undefined;
    if (channel && !["default", "oneyes-minimax"].includes(channel.id) && channel.oneYes?.platform !== "grok") return undefined;
    if (channel?.models.find((entry) => entry.name === model)?.script?.trim()) return undefined;
    try {
        const url = new URL(channel?.baseUrl || config.baseUrl);
        if (!["https:", "http:"].includes(url.protocol) || !["api.oneyes.ai", "oneyes.ai"].includes(url.hostname)) return undefined;
    } catch { return undefined; }
    // Bare Grok IDs may address the native account pool. Only the audited,
    // exact priced aliases identify the bridge until /models exposes routing.
    const info = videoModelCatalog.find((entry) => entry.aliases.includes(model) || !entry.id.startsWith("grok-") && model === entry.id);
    if (!info) return;
    const limits = channel?.models.find(entry => entry.name === model)?.referenceFileMaxBytes;
    return limits === undefined ? info : { ...info, referenceFileMaxBytes: limits };
}

export function videoModelOptionName(config: AiConfig, value: string) {
    const name = value.includes('::') ? value.slice(value.indexOf('::') + 2) : value;
    if (splitModelInformation(name).information) return name;
    const info = getVideoModelInfo(config, value);
    if (!info) return name;
    return `${info.id} [${info.summary}]`;
}

/** Display one entry per channel/model while preserving the exact selected ID. */
export function videoModelOptions(config: AiConfig, options: string[], current?: string) {
    return modelPickerOptions(config, options, current).map(option => option.value);
}

export function modelPickerOptions(config: AiConfig, options: string[], _current?: string) {
    const groups = new Map<string, string[]>();
    const raw = (value: string) => value.includes('::') ? value.slice(value.indexOf('::') + 2) : value;
    for (const value of options) {
        const channel = value.includes('::') ? value.slice(0, value.indexOf('::') + 2) : '';
        const model = config.channels.find(entry => channel === entry.id + '::')?.models.find(entry => entry.name === raw(value));
        const key = model && model.capability !== 'video' ? value : channel + (getVideoModelInfo(config, value)?.id || splitModelInformation(raw(value)).name);
        groups.set(key, [...groups.get(key) || [], value]);
    }
    return [...groups.values()].flatMap(candidates => {
        const channel = config.channels.find(channel => candidates[0].startsWith(channel.id + '::'));
        const model = channel?.models.find(model => model.name === raw(candidates[0]));
        if (model && model.capability !== 'video') {
            const label = raw(candidates[0]) + (channel ? `（${channel.name}）` : '');
            return [{ value: candidates[0], label, name: label, information: '' }];
        }
        let oneYesEndpoint = false;
        try { oneYesEndpoint = ['oneyes.ai', 'api.oneyes.ai'].includes(new URL(channel?.baseUrl || config.baseUrl).hostname); } catch { /* No site metadata for an invalid endpoint. */ }
        const videoGroup = oneYesEndpoint && (channel?.id === 'oneyes-minimax' || channel?.oneYes?.platform === 'grok');
        const priced = candidates.filter(candidate => modelInformationPriority(raw(candidate)) === 2);
        if (videoGroup && !priced.length) return [];
        // Only recommend an audited ID actually returned by this Key. Unknown
        // prices retain server order, never infer the cheapest or a request ID.
        const canonical = splitModelInformation(raw(candidates[0])).name;
        const recommended = oneYesEndpoint && displayCatalog.find(model => model.id === canonical)?.request_id;
        const preferred = priced.find(candidate => raw(candidate) === recommended) || candidates.reduce((best, candidate) => modelInformationPriority(raw(candidate)) > modelInformationPriority(raw(best)) ? candidate : best);
        const value = preferred;
        const label = videoDisplayText(videoModelOptionName(config, preferred))
            .replace(/https?:\/\/[^\s\]】,，;；]+/gi, '')
            .replace(/(?:余额|剩余额度|balance|quota|credits?)\s*[:：=]?\s*[¥￥$]?\s*\d+(?:\.\d+)?\s*元?/gi, '').replace(/\s{2,}/g, ' ').trim();
        return [{ value, label, ...splitModelInformation(label) }];
    });
}

/** Reject unsupported selections before a paid POST; never mutate saved choices. */
export function videoModelConfigError(config: AiConfig, value = config.model || config.videoModel, inputs?: { imageCount: number; videoCount: number; audioCount: number }) {
    const info = getVideoModelInfo(config, value);
    if (!info) return undefined;
    return videoModelParametersError(info, config, inputs);
}

export function videoModelParametersError(info: VideoModelInfo, config: Pick<AiConfig, 'vquality' | 'videoSeconds' | 'size' | 'videoMode' | 'videoGenerateAudio'>, inputs?: { imageCount: number; videoCount: number; audioCount: number }) {
    const resolution = parseVideoResolution(config.vquality).toLowerCase();
    if (!/^(?:\d+p?|[24]k)$/i.test(config.vquality) || !info.resolutions.includes(resolution)) return `该模型支持 ${info.resolutions.map(tierLabel).join(" / ")}，请主动选择支持的分辨率；已保留原设置。`;
    const seconds = Number(config.videoSeconds);
    if (!Number.isInteger(seconds) || seconds < info.duration.min || seconds > info.duration.max || info.duration.values && !info.duration.values.includes(seconds)) {
        return `该模型支持 ${info.duration.values?.join(" / ") || `${info.duration.min}–${info.duration.max}`} 秒，请选择支持的时长。`;
    }
    const ratio = inferVideoRatio(config.size || "auto");
    const pixels = parsePixelSize(config.size), aspect = parseAspectRatio(ratio);
    if (pixels && aspect && pixels.width * aspect.height !== pixels.height * aspect.width) return '当前像素尺寸不能准确对应该模型的画幅比例，请主动选择比例；已保留原设置，不会自动裁切或缩放。';
    if (!info.ratios.includes(ratio)) return `该模型支持 ${info.ratios.map(item => item === "auto" ? "自动比例" : item).join(" / ")}，请调整画幅比例。`;
    const mode = config.videoMode === "reference" ? "reference" : "frames";
    if (!info.modes.includes(mode)) return "该模型仅支持参考模式，请在参数面板中主动切换；已保留原设置。";
    if (info.audio === "required" && config.videoGenerateAudio === "false") return "该模型固定生成音频，请在参数面板中开启生成音频。";
    if (!inputs) return undefined;
    if (info.id === 'grok-imagine-video-1.5' && !inputs.imageCount) return 'Grok 1.5 需要至少一张参考图片，请先添加图片。';
    if (mode === "frames" && inputs.imageCount > 2) return "首尾帧最多两张图片；请主动选择参考素材模式，不会自动丢弃图片。";
    if (mode === "frames" && (inputs.videoCount || inputs.audioCount)) return "首尾帧不能混用参考视频或音频，请主动切换参考素材模式。";
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
    if (info.id === "grok-imagine-video" && mode === "frames" && inputs.imageCount > 1) return "该 Grok 模型不支持尾帧，请选择参考模式或移除尾帧。";
    if (info.id === "grok-imagine-video-1.5" && mode === "frames" && inputs.imageCount > 1 && resolution === "1080") return "Grok 1.5 尾帧仅支持 480p / 720p，请主动调整。";
    if (info.id.startsWith('veo-3.1') && mode === "reference" && inputs.imageCount && seconds !== 8) return "Veo 参考图片模式固定 8 秒，请主动调整时长。";
    if (info.id === "kling-3.0-motion-control" && (inputs.imageCount !== 1 || inputs.videoCount !== 1)) return "动作控制需要一张人物图片与一段 3–30 秒动作视频；成片时长跟随动作视频。";
    if (info.id === "kling-3.0-omni" && inputs.videoCount && config.videoGenerateAudio !== "false") return "Kling 参考视频模式仅支持无声，请主动关闭生成音频。";
    if (info.id === "grok-imagine-video-1.5" && (mode === "reference" && inputs.imageCount || inputs.audioCount || inputs.imageCount > 2) && resolution === "1080") return "Grok 1.5 多参考素材仅支持 480p / 720p，请主动调整分辨率。";
    if (info.id === "doubao-seedance-2.5" && mode === "frames" && inputs.imageCount && ratio !== "auto") return "Seedance 2.5 首尾帧仅支持自动比例，请主动选择自动比例。";
    return undefined;
}

export function tierLabel(value: string) {
    return /k$/i.test(value) ? value.toUpperCase() : `${value}p`;
}
