import { zip } from "fflate";
import { creatorSourceBlob } from "./creator-media";
import { exportName } from "@/lib/canvas/studio";
import type { CanvasNodeData } from "@/types/canvas";

export async function exportStudioSources(sources: CanvasNodeData[], signal: AbortSignal) {
    if (!sources.length) throw Error("请先选择要导出的素材");
    const files: Record<string, Uint8Array> = {},
        manifest = [];
    for (const [index, node] of sources.entries()) {
        signal.throwIfAborted();
        const prefix = `${String(index + 1).padStart(3, "0")}-${exportName(node.title)}`;
        if (["image", "video", "audio"].includes(node.type)) {
            const blob = await creatorSourceBlob(node, signal);
            const extension =
                (
                    {
                        "image/png": "png",
                        "image/jpeg": "jpg",
                        "image/webp": "webp",
                        "image/gif": "gif",
                        "video/mp4": "mp4",
                        "video/webm": "webm",
                        "audio/mpeg": "mp3",
                        "audio/wav": "wav",
                        "audio/x-wav": "wav",
                        "audio/ogg": "ogg",
                        "audio/flac": "flac",
                    } as Record<string, string>
                )[blob.type] || "bin";
            files[`${prefix}.${extension}`] = new Uint8Array(await blob.arrayBuffer());
        } else files[`${prefix}.txt`] = new TextEncoder().encode(node.metadata?.content || node.metadata?.prompt || "");
        const metadata = node.metadata || {};
        // Explicit export fields only. Never serialize arbitrary node config or keys.
        manifest.push({ name: node.title, type: node.type, prompt: metadata.prompt, model: metadata.model, size: metadata.size, quality: metadata.quality, width: metadata.naturalWidth, height: metadata.naturalHeight });
    }
    files["素材参数.json"] = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
    signal.throwIfAborted();
    return new Promise<Blob>((resolve, reject) => {
        const cancel = zip(files, { level: 0 }, (error, data) => {
            signal.removeEventListener("abort", abort);
            error ? reject(error) : resolve(new Blob([data as Uint8Array<ArrayBuffer>], { type: "application/zip" }));
        });
        const abort = () => {
            cancel();
            reject(new DOMException("已取消导出", "AbortError"));
        };
        signal.addEventListener("abort", abort, { once: true });
    });
}
