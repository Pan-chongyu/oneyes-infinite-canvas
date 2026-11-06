import { getImageBlob, fetchImageBlob } from "@/services/image-storage";
import { getMediaBlob } from "@/services/file-storage";
import type { CanvasNodeData } from "@/types/canvas";
import type { CreatorArtifact, CreatorProgress, CreatorSettings } from "@/types/creator-tools";
import { createCreatorAiWorker } from "@/services/creator-ai";

export async function creatorSourceBlob(node: CanvasNodeData, signal: AbortSignal): Promise<Blob> {
    signal.throwIfAborted();
    const metadata = node.metadata;
    const source = node.type === "image" ? metadata?.images?.find(image => image.id === (metadata.primaryImageId || metadata.images?.[0]?.id)) || metadata : metadata;
    const key = source?.storageKey;
    if (key) {
        const blob = await (key.startsWith("image:") ? getImageBlob(key) : getMediaBlob(key));
        if (blob?.size) { signal.throwIfAborted(); return blob; }
    }
    // Read the selected full original, never its thumbnail. Desktop HTTPS images
    // use the existing anonymous native download channel, including non-CORS storage.
    const content = source?.content;
    if (!content || !/^(blob:|data:|https:\/\/)/i.test(content) || /^https:/i.test(content) && node.type !== "image") throw new Error(`「${node.title}」的原始素材缺失，请重新导入原图后运行`);
    if (/^https:/i.test(content)) { const url = new URL(content); if (url.username || url.password) throw new Error("图片地址包含登录凭据，请使用不带账号密码的原图地址"); }
    let blob: Blob;
    try {
        if (node.type === "image") blob = await fetchImageBlob(content, { signal });
        else { const response = await fetch(content, { signal, credentials: "omit" }); if (!response.ok) throw new Error("无法读取本机原始素材，请重新导入"); blob = await response.blob(); }
    } catch (error) {
        if (signal.aborted || !/^https:/i.test(content)) throw error;
        const status = Number((error as { status?: number }).status) || 0;
        throw Object.assign(new Error([401,403,404,410].includes(status) ? "原图链接已失效或无权访问，请重新导入原图后运行；不会重新提交生图请求" : "无法下载原图，请检查网络或代理后重新运行；不会重新提交生图请求"), { status });
    }
    signal.throwIfAborted();
    if (!blob.size) throw new Error(`「${node.title}」的原始素材为空，请重新导入`);
    return blob;
}

export async function processNativeVideo(operation: "analyze" | "concat" | "mix" | "extract" | "subtitles" | "videoSuperResolution" | "editAnalyze" | "editRender", sources: CanvasNodeData[], settings: CreatorSettings & { srt?: string; edit?: Record<string, unknown> }, signal: AbortSignal, progress: (state: CreatorProgress) => void): Promise<CreatorArtifact[]> {
    const media = window.oneYesDesktop?.media;
    if (!media) throw new Error("本地音视频处理需要桌面版内置的媒体组件，请在 OneYes Canvas 桌面版中使用");
    const id = await media.create(operation, sources.length, operation.startsWith("edit") ? settings.edit : operation === "analyze" ? { threshold: settings.threshold ?? 0.3, clips: Boolean(settings.clips), audio: Boolean(settings.audio) } : operation==='mix' ? {volume:settings.volume??1,originalVolume:settings.originalVolume??1,fadeIn:settings.fadeIn??0,fadeOut:settings.fadeOut??0} : operation==='subtitles' ? {srt:settings.srt} : operation === "videoSuperResolution" ? { scale: settings.videoScale ?? 3 } : { trims: sources.map(node => settings.trims?.[node.id] || {}) });
    const stop = media.subscribe(state => { if (state.id === id) progress(state); });
    const abort = () => { void media.release(id).catch(() => {}); };
    signal.addEventListener("abort", abort, { once: true });
    try {
        signal.throwIfAborted();
        for (const [index, source] of sources.entries()) {
            progress({ stage: `正在读取素材 ${index + 1} / ${sources.length}` });
            const blob = await creatorSourceBlob(source, signal);
            const response = await fetch(`oneyes-canvas://app/media-tools/${id}/input/${index}`, { method: "PUT", body: blob, signal });
            if (!response.ok) throw new Error("无法准备本地视频素材");
        }
        let result = await media.start(id);
        signal.throwIfAborted();
        if (!result.data) throw new Error(result.error || "本地视频处理失败");
        if (operation === "videoSuperResolution") {
            const frames = result.data;
            if (!frames.length || frames.some(item => item.kind !== "image" || !Number.isFinite(item.time))) throw new Error("原视频帧时间表无效，已停止增强");
            let currentFrame = 0;
            const ai = createCreatorAiWorker(signal, state => progress({ stage: `第 ${currentFrame + 1} / ${frames.length} 帧 · ${state.stage}`, progress: (currentFrame + (state.progress ?? 0) / 100) / frames.length * 100 }));
            try {
                for (const [index, frame] of frames.entries()) {
                    currentFrame = index;
                    signal.throwIfAborted();
                    const response = await fetch(`oneyes-canvas://app/media-tools/${id}/output/${encodeURIComponent(frame.name)}`, { signal });
                    if (!response.ok) throw new Error("无法读取视频原始帧");
                    const original = await response.blob();
                    if (original.size !== frame.bytes) throw new Error("视频原始帧不完整，请重试");
                    const enhanced = await ai.run("superResolution", original);
                    signal.throwIfAborted();
                    const upload = await fetch(`oneyes-canvas://app/media-tools/${id}/enhanced/${index}`, { method: "PUT", body: enhanced, signal });
                    if (!upload.ok) throw new Error("无法提交 AI 增强帧");
                    progress({ stage: `AI 超采样帧 ${index + 1} / ${frames.length}`, progress: (index + 1) / frames.length * 100 });
                }
            } finally { ai.close(); }
            result = await media.finish(id);
            if (!result.data) throw new Error(result.error || "无法封装超采样视频");
        }
        const artifacts: CreatorArtifact[] = [];
        for (const item of result.data) {
            const response = await fetch(`oneyes-canvas://app/media-tools/${id}/output/${encodeURIComponent(item.name)}`, { signal });
            if (!response.ok) throw new Error("无法取回处理结果");
            const blob = await response.blob();
            if (blob.size !== item.bytes) throw new Error("处理结果不完整，请重试");
            artifacts.push({ ...item, blob });
        }
        return artifacts;
    } finally { signal.removeEventListener("abort", abort); stop(); await media.release(id); }
}

export async function composeImages(sources: CanvasNodeData[], settings: CreatorSettings, signal: AbortSignal): Promise<CreatorArtifact[]> {
    if (!sources.length) throw new Error("请先选择图片图层");
    const blobs: Blob[] = [];
    for (const source of sources) blobs.push(await creatorSourceBlob(source, signal));
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL("./creator-compose.worker.ts", import.meta.url), { type: "module" });
        const stop = () => { worker.terminate(); signal.removeEventListener("abort", abort); };
        const abort = () => { stop(); reject(new DOMException("已取消图层合成", "AbortError")); };
        signal.addEventListener("abort", abort, { once: true });
        worker.onmessage = ({ data }) => { stop(); if (data.blob instanceof Blob) resolve([{ name: "图层合成.png", kind: "image", blob: data.blob }]); else reject(new Error(data.error || "图层合成失败")); };
        worker.onerror = () => { stop(); reject(new Error("无法启动图层合成组件")); };
        worker.postMessage({ blobs, layers: sources.map(source => settings.layers?.[source.id] || {}) });
    });
}
