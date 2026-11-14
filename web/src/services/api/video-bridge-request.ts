import type { AiConfig } from "@/stores/use-config-store";
import type { VideoModelInfo } from "@/lib/video-model-catalog";
import { inferVideoRatio, parseVideoResolution } from "@/lib/media-size";

type VideoParameters = Pick<AiConfig, "videoSeconds" | "vquality" | "size" | "videoMode" | "videoGenerateAudio" | "videoWatermark">;
export type VideoBridgeMedia = {
    images: File[];
    imageDataUrls: string[];
    videos: (File | string)[];
    audios: (File | string)[];
    referenceVideoDurationTotal?: number;
};
export type VideoBridgeRequest = { body: FormData | Record<string, unknown>; contentType?: string };
const probedVideoModels = new Set(["sd-2.5-fullblood-line3", "seedance-2.0-official", "seedance-2.0-fast-official", "seedance-2.5-official"]);

/** Grok and Kling retain their existing native paths; only verified adapters use this builder. */
export function usesVideoBridgeRequest(info: VideoModelInfo) {
    return info.provider === "zhiying" || /^(?:wan3\.0-video(?:-prime)?|doubao-seedance-2\.[05]|minimax-h3|veo-3\.1(?:-fast)?|gemini-omni-flash-1\.[12])$/.test(info.id);
}

/** Reference video URLs stay URLs; never turn a local file into an unsupported inline video. */
export function videoBridgeMediaUrl(value: string | undefined, label: string) {
    try {
        const url = new URL(value || "");
        if (url.protocol === "https:" && !url.username && !url.password) return url.href;
    } catch { /* Local/blob media requires an upload capability exposed by the selected adapter. */ }
    throw new Error(`该模型的参考${label}需要公开 HTTPS 链接；当前协议桥不支持直接提交本地${label}，请使用已上传的素材链接。`);
}

export function buildVideoBridgeRequest(info: VideoModelInfo, config: VideoParameters, model: string, prompt: string, media: VideoBridgeMedia): VideoBridgeRequest {
    const resolution = parseVideoResolution(config.vquality).toLowerCase();
    const quality = /k$/.test(resolution) ? resolution : `${resolution}p`;
    const duration = Number(config.videoSeconds);
    const ratio = inferVideoRatio(config.size || "auto");
    const mode = config.videoMode === "reference" ? "reference" : "frames";
    if (info.provider === "zhiying") {
        const body = new FormData();
        Object.entries({ model, prompt, resolution: quality, duration: String(duration), aspect_ratio: ratio }).forEach(([key, value]) => body.append(key, value));
        for (const [role, files] of [["reference_images", media.images], ["reference_videos", media.videos], ["reference_audios", media.audios]] as const) {
            for (const file of files) {
                if (!(file instanceof File)) throw new Error("智赢参考素材必须提交本地文件，不能把公开链接当作素材 ID。");
                body.append(role, file, file.name);
            }
        }
        if (media.videos.length && !probedVideoModels.has(info.id)) {
            if (!Number.isFinite(media.referenceVideoDurationTotal) || !(media.referenceVideoDurationTotal! > 0)) throw new Error("该智赢模型需要参考视频的实际总时长，请重新读取视频素材后再提交。");
            body.append("reference_video_duration_total", String(media.referenceVideoDurationTotal));
        }
        return { body };
    }

    const body: Record<string, unknown> = { model, prompt, resolution: quality, duration };
    const images = media.imageDataUrls;
    if (mode === "frames" && images.length > 2) throw new Error("首尾帧模式最多使用两张图片，请主动切换参考模式或调整素材。");
    if (mode === "frames" && (images.length || media.videos.length || media.audios.length) && (media.videos.length || media.audios.length)) throw new Error("首尾帧不能与参考视频或音频混用，请主动切换参考模式或调整素材。");
    if (info.id.startsWith("wan3.0-video")) {
        body.ratio = ratio === "auto" ? "adaptive" : ratio;
        body.watermark = config.videoWatermark === "true";
        if (mode === "frames") {
            if (images[0]) body.first_frame = images[0];
            if (images[1]) body.last_frame = images[1];
        } else if (images.length) body.reference_images = images;
        if (media.videos.length) body.reference_videos = media.videos;
        if (media.audios.length) body.reference_audios = media.audios;
    } else if (info.id.startsWith("doubao-seedance-")) {
        body.ratio = ratio === "auto" ? "adaptive" : ratio;
        body.watermark = config.videoWatermark === "true";
        body.generate_audio = config.videoGenerateAudio !== "false";
        if (mode === "frames") {
            if (images[0]) body.first_frame = images[0];
            if (images[1]) body.last_frame = images[1];
        } else if (images.length) body.reference_images = images;
        if (media.videos.length) body.reference_videos = media.videos;
        if (media.audios.length) body.reference_audios = media.audios;
        if (media.audios.length && !images.length && !media.videos.length) throw new Error("Seedance 参考音频需要同时提供参考图片或视频。");
    } else if (info.id === "minimax-h3") {
        if (media.videos.length) throw new Error("MiniMax H3 不支持参考视频，请调整参考素材。");
        if (media.audios.length && !images.length) throw new Error("MiniMax H3 参考音频需要同时提供参考图片。");
        if (mode === "frames" && images.length && resolution !== "768") throw new Error("MiniMax H3 首尾帧仅支持 768p，请主动选择分辨率或参考模式；已保留原设置。");
        body.ratio = ratio;
        const metadata: Record<string, unknown> = {};
        if (mode === "frames") {
            if (images[0]) metadata.firstFrame = images[0];
            if (images[1]) metadata.lastFrame = images[1];
        } else if (images.length) metadata.referenceImages = images;
        if (media.audios.length) metadata.referenceAudios = media.audios;
        if (Object.keys(metadata).length) body.metadata = metadata;
    } else if (/^(?:veo-3\.1(?:-fast)?|gemini-omni-flash-1\.[12])$/.test(info.id)) {
        if (media.audios.length) throw new Error("该 Google 视频模型不支持参考音频。");
        const veo = info.id.startsWith("veo-");
        if (info.id === "veo-3.1" && images.some(image => !/^data:image\/(?:png|jpeg);base64,/i.test(image))) throw new Error("Veo 3.1 仅接受 PNG / JPEG；当前安全素材处理输出的格式不受该模型支持，请使用支持此格式的模型请求脚本，不会静默更换格式或模型。");
        if (veo && media.videos.length) throw new Error("Veo 通用生成不支持参考视频；当前面板不会自动切换为视频扩展任务。");
        if (veo && mode === "reference" && images.length && duration !== 8) throw new Error("Veo 参考图片模式固定生成 8 秒，请在参数面板中主动选择 8 秒。");
        if (!veo && media.videos.length === 1 && !images.length) throw new Error("Gemini 单视频且没有图片会进入视频编辑；当前生成面板不自动切换编辑方式，请添加参考图片或使用专用请求脚本。");
        body.ratio = ratio;
        if (images.length) {
            body.images = images;
            body.metadata = { video_mode: mode };
        }
        if (media.videos.length) body.videos = media.videos;
        if (info.id === "veo-3.1") body.generate_audio = config.videoGenerateAudio !== "false";
    } else {
        throw new Error("该模型未配置已验证的协议桥请求方式。");
    }
    return { body, contentType: "application/json" };
}
