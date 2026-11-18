import type { AiConfig } from "@/stores/use-config-store";
import type { VideoModelInfo } from "@/lib/video-model-catalog";
import { inferVideoRatio, parseVideoResolution } from "@/lib/media-size";
import { videoModelParametersError } from '@/lib/video-model-info';
import { VIDEO_BRIDGE_BODY_MAX_BYTES, VIDEO_BRIDGE_TEXT_MAX_BYTES, MINIMAX_INLINE_MAX_BYTES, videoReferenceFileLimit } from '@/lib/video-material-policy';

type VideoParameters = Pick<AiConfig, "videoSeconds" | "vquality" | "size" | "videoMode" | "videoGenerateAudio" | "videoWatermark">;
export type VideoBridgeMedia = {
    images: File[];
    imageDataUrls: string[];
    videos: (File | string)[];
    audios: (File | string)[];
    audioFiles?: File[];
    referenceVideoDurationTotal?: number;
};
export type VideoBridgeRequest = { body: FormData | Record<string, unknown>; contentType?: string };
const probedVideoModels = new Set(["sd-2.5-fullblood-line3", "seedance-2.0-official", "seedance-2.0-fast-official", "seedance-2.5-official"]);

/** Only models identified by the audited OneYes routing catalog use this builder. */
export function usesVideoBridgeRequest(info: VideoModelInfo) {
    return Boolean(info);
}

// Serialize multipart exactly once so boundary, UTF-8 and file bytes counted
// here are the same bytes sent through browser and native transports.
export async function encodeVideoBridgeRequest(request: VideoBridgeRequest, info: VideoModelInfo) {
    if (request.body instanceof FormData) {
        let textBytes = 0;
        for (const value of request.body.values()) if (typeof value === 'string') textBytes += new Blob([value]).size;
        if (textBytes > VIDEO_BRIDGE_TEXT_MAX_BYTES) throw Error('multipart 普通文本字段合计超过 32 MiB，请改用二进制文件 part 或预上传素材，未提交生成；不会降低原图画质。');
    } else if (info.id === 'minimax-h3') {
        let inlineBytes = 0;
        const visit = (value: unknown) => {
            if (typeof value === 'string' && /^data:[^;,]+;base64,/i.test(value)) inlineBytes += value.slice(value.indexOf(',') + 1).length;
            else if (Array.isArray(value)) value.forEach(visit);
            else if (value && typeof value === 'object') Object.values(value).forEach(visit);
        };
        visit(request.body);
        if (inlineBytes > MINIMAX_INLINE_MAX_BYTES) throw Error('MiniMax Base64 内联素材合计超过 32,000,000 字节，请使用受支持的预上传 HTTPS 链接；未提交生成，不会降低画质。');
    }
    const response = new Response(request.body instanceof FormData ? request.body : JSON.stringify(request.body));
    const body = await response.blob();
    if (body.size > VIDEO_BRIDGE_BODY_MAX_BYTES) throw Error(`视频请求正文超过 128 MiB，本次 ${(body.size / 1024 / 1024).toFixed(2)} MiB（含封装开销），未提交生成。模型单文件和 CDN 限制另行生效，请减少素材或使用受支持的预上传入口；不会降低画质或更改站点地址。`);
    return { body, contentType: request.contentType || response.headers.get("Content-Type")! };
}

/** Reference video URLs stay URLs; never turn a local file into an unsupported inline video. */
export function videoBridgeMediaUrl(value: string | undefined, label: string) {
    try {
        const url = new URL(value || "");
        if (url.protocol === "https:" && !url.username && !url.password) return url.href;
    } catch { /* Local/blob media requires an upload capability exposed by the selected adapter. */ }
    throw new Error(`该模型的参考${label}需要公开 HTTPS 链接；该模型暂不支持直接提交本地${label}，请使用已上传的素材链接。`);
}

export function buildVideoBridgeRequest(info: VideoModelInfo, config: VideoParameters, model: string, prompt: string, media: VideoBridgeMedia): VideoBridgeRequest {
    const error = videoModelParametersError(info, config, { imageCount: Math.max(media.images.length, media.imageDataUrls.length), videoCount: media.videos.length, audioCount: media.audios.length });
    if (error) throw Error(error);
    for (const [kind, files, label] of [['image', media.images, '图片'], ['video', media.videos, '视频'], ['audio', media.audioFiles || media.audios, '音频']] as const) {
        const limit = videoReferenceFileLimit(info, kind);
        for (const [index, file] of files.entries()) if (file instanceof File && limit && file.size > limit) throw Error(`第 ${index + 1} 个参考${label}超过该模型单文件限制 ${limit} 字节；请更换素材或使用受支持的预上传入口，未提交生成，不会降低画质。`);
    }
    const resolution = parseVideoResolution(config.vquality).toLowerCase();
    const quality = /k$/.test(resolution) ? resolution : `${resolution}p`;
    const duration = Number(config.videoSeconds);
    const ratio = inferVideoRatio(config.size || "auto");
    const mode = config.videoMode === "reference" ? "reference" : "frames";
    const imageCount = Math.max(media.images.length, media.imageDataUrls.length);
    if (info.provider !== 'zhiying' && mode === 'frames' && imageCount > 2) throw Error('首尾帧模式最多使用两张图片，请主动切换参考模式或调整素材。');
    if (info.provider !== 'zhiying' && mode === 'frames' && (media.videos.length || media.audios.length)) throw Error('首尾帧不能与参考视频或音频混用，请主动切换参考模式或调整素材。');
    if (info.promptMax && Array.from(prompt).length > info.promptMax) throw Error(`该模型提示词最多 ${info.promptMax} 字符，请缩短后提交。`);
    if (info.provider === "zhiying") {
        const body = new FormData();
        Object.entries({ model, prompt, resolution: quality, duration: String(duration), aspect_ratio: ratio }).forEach(([key, value]) => body.append(key, value));
        for (const [role, files] of [["reference_images", media.images], ["reference_videos", media.videos], ["reference_audios", media.audios]] as const) {
            for (const file of files) {
                if (!(file instanceof File)) throw new Error("该模型的参考素材须使用本地文件，请重新选择素材。");
                body.append(role, file, file.name);
            }
        }
        if (media.videos.length && !probedVideoModels.has(info.id)) {
            if (!Number.isFinite(media.referenceVideoDurationTotal) || !(media.referenceVideoDurationTotal! > 0)) throw new Error("该模型需要参考视频的实际总时长，请重新读取视频素材后再提交。");
            body.append("reference_video_duration_total", String(media.referenceVideoDurationTotal));
        }
        return { body };
    }

    if (media.images.length && (info.id.startsWith('wan3.0-video') || /^(veo-|gemini-omni-)/.test(info.id))) {
        const body = new FormData();
        Object.entries({ model, prompt, resolution: quality, duration: String(duration), ratio: info.id.startsWith('wan') && ratio === 'auto' ? 'adaptive' : ratio }).forEach(([key, value]) => body.append(key, value));
        if (info.id.startsWith('wan')) body.append('watermark', String(config.videoWatermark === 'true'));
        else {
            if (info.id === 'veo-3.1' && media.images.some(image => !['image/png', 'image/jpeg'].includes(image.type))) throw Error('Veo 3.1 仅接受 PNG / JPEG，请重新读取图片；原图与画质不变。');
            if (info.id.startsWith('veo-') && media.videos.length) throw Error('Veo 通用生成不支持参考视频；不会自动切换视频扩展任务。');
            if (info.id.startsWith('veo-3.1') && mode === 'reference' && duration !== 8) throw Error('Veo 参考图片模式固定 8 秒，请主动调整。');
            body.append('metadata', JSON.stringify({ video_mode: mode }));
            if (info.id === 'veo-3.1') body.append('generate_audio', String(config.videoGenerateAudio !== 'false'));
        }
        for (const [index, file] of media.images.entries()) body.append(mode === 'frames' ? index === 0 ? 'first_frame' : 'last_frame' : info.id.startsWith('wan') ? 'reference_images' : 'images', file, file.name);
        if (media.videos.length) body.append(info.id.startsWith('wan') ? 'reference_videos' : 'videos', JSON.stringify(media.videos));
        if (media.audios.length) body.append('reference_audios', JSON.stringify(media.audios));
        return { body };
    }
    const body: Record<string, unknown> = { model, prompt, resolution: quality, duration };
    const images = media.imageDataUrls;
    if (info.id.startsWith("grok-")) {
        body.aspect_ratio = ratio;
        const urls = images.map(image => videoBridgeMediaUrl(image, "图片"));
        if (mode === "reference") { if (urls.length) body.reference_images = urls; }
        else { if (urls[0]) body.image = urls[0]; if (urls[1]) body.last_frame = urls[1]; }
    } else if (info.id.startsWith("kling-")) {
        const metadata: Record<string, unknown> = {};
        if (info.id === "kling-3.0-motion-control") {
            if (!Number.isFinite(media.referenceVideoDurationTotal) || media.referenceVideoDurationTotal! < 3 || media.referenceVideoDurationTotal! > 30) throw Error('动作参考视频需要实际时长 3–30 秒，请重新读取素材；不会截短或改动原视频。');
            delete body.duration; if (images[0]) metadata.firstFrame = images[0];
        }
        else {
            body.aspect_ratio = ratio; body.generateAudio = config.videoGenerateAudio !== "false";
            if (mode === "frames") { if (images[0]) metadata.firstFrame = images[0]; if (images[1]) metadata.lastFrame = images[1]; }
            else if (images.length) body.images = images;
        }
        if (media.videos.length) metadata.referenceVideos = media.videos;
        if (Object.keys(metadata).length) body.metadata = metadata;
    } else if (info.id.startsWith("wan3.0-video")) {
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
        if (info.id === "veo-3.1" && images.some(image => !/^data:image\/(?:png|jpeg);base64,/i.test(image))) throw new Error("Veo 3.1 仅接受 PNG / JPEG，请重新读取图片后提交；原图与画质不变。");
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
        throw new Error("该模型暂未适配，请刷新模型列表或选择其他模型。");
    }
    return { body, contentType: "application/json" };
}
