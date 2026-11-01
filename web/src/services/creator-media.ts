import { getImageBlob, fetchImageBlob } from "@/services/image-storage";
import { getMediaBlob } from "@/services/file-storage";
import type { CanvasNodeData } from "@/types/canvas";
import type { CreatorArtifact, CreatorProgress, CreatorSettings } from "@/types/creator-tools";

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

export async function processNativeVideo(operation: "analyze" | "concat", sources: CanvasNodeData[], settings: CreatorSettings, signal: AbortSignal, progress: (state: CreatorProgress) => void): Promise<CreatorArtifact[]> {
    const media = window.oneYesDesktop?.media;
    if (!media) throw new Error("视频拉片与拼接需要桌面版内置的媒体组件，请在 OneYes Canvas 桌面版中使用");
    const id = await media.create(operation, sources.length, operation === "analyze" ? { threshold: settings.threshold ?? 0.3, clips: Boolean(settings.clips), audio: Boolean(settings.audio) } : { trims: sources.map(node => settings.trims?.[node.id] || {}) });
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
        const result = await media.start(id);
        signal.throwIfAborted();
        if (!result.data) throw new Error(result.error || "本地视频处理失败");
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
