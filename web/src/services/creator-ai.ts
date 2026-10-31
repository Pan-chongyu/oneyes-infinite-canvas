import type { CreatorArtifact, CreatorProgress } from "@/types/creator-tools";

export function processLocalAi(operation: "cutout" | "superResolution", blob: Blob, signal: AbortSignal, progress: (value: CreatorProgress) => void): Promise<CreatorArtifact[]> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL("./creator-ai.worker.ts", import.meta.url), { type: "module" });
        const stop = () => { worker.terminate(); signal.removeEventListener("abort", abort); };
        const abort = () => { stop(); reject(new DOMException("已取消本地处理", "AbortError")); };
        signal.addEventListener("abort", abort, { once: true });
        worker.onmessage = ({ data }) => {
            if (data.stage) return progress(data);
            stop();
            if (data.blob instanceof Blob) resolve([{ kind: "image", name: operation === "cutout" ? "智能抠图.png" : "AI超分-ESPCN-3x.png", blob: data.blob }]);
            else reject(new Error(data.error || "本地 AI 处理未完成"));
        };
        worker.onerror = () => { stop(); reject(new Error("本地 AI 组件无法启动，请重新安装最新版")); };
        worker.postMessage({ operation, blob });
    });
}
