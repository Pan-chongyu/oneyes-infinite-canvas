import { getImageBlob } from "@/services/image-storage";
import { getMediaBlob } from "@/services/file-storage";
import type { CanvasNodeData } from "@/types/canvas";
import type { CreatorArtifact, CreatorProgress, CreatorSettings } from "@/types/creator-tools";

export async function creatorSourceBlob(node: CanvasNodeData, signal: AbortSignal): Promise<Blob> {
    signal.throwIfAborted();
    const key = node.metadata?.storageKey;
    if (key) {
        const blob = await (key.startsWith("image:") ? getImageBlob(key) : getMediaBlob(key));
        if (!blob?.size) throw new Error(`找不到「${node.title}」的原始素材，请重新导入`);
        return blob;
    }
    // Local pasted data is allowed. Never forward credentials to arbitrary media URLs.
    const content = node.metadata?.content;
    if (!content || !/^(blob:|data:)/.test(content)) throw new Error(`请先将「${node.title}」下载或导入为本机素材`);
    const response = await fetch(content, { signal });
    if (!response.ok) throw new Error(`无法读取「${node.title}」`);
    return response.blob();
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
