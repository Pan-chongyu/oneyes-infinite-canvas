import { creatorSourceBlob } from "./creator-media";
import type { CanvasNodeData } from "@/types/canvas";
import type { CreatorArtifact, CreatorSettings } from "@/types/creator-tools";

export async function studioImages(tool: "board" | "color", sources: CanvasNodeData[], settings: CreatorSettings, signal: AbortSignal, reference?: CanvasNodeData): Promise<CreatorArtifact[]> {
    const blobs: Blob[] = [];
    for (const source of [...sources, ...(reference ? [reference] : [])]) blobs.push(await creatorSourceBlob(source, signal));
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL("./studio-images.worker.ts", import.meta.url), { type: "module" });
        const stop = () => {
            worker.terminate();
            signal.removeEventListener("abort", abort);
        };
        const abort = () => {
            stop();
            reject(new DOMException("已取消处理", "AbortError"));
        };
        signal.addEventListener("abort", abort, { once: true });
        worker.onmessage = ({ data }) => {
            stop();
            data.blob instanceof Blob ? resolve([{ name: tool === "board" ? "分镜板.png" : "调色.png", kind: "image", blob: data.blob }]) : reject(Error(data.error || "图像处理失败"));
        };
        worker.onerror = () => {
            stop();
            reject(Error("图像组件无法启动，请重试"));
        };
        worker.postMessage({ tool, blobs, settings, titles: sources.map((node) => node.title) });
    });
}
