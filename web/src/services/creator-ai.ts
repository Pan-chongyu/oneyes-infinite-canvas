import type { CreatorArtifact, CreatorProgress } from "@/types/creator-tools";

export function processLocalAi(operation: "cutout" | "superResolution", blob: Blob, signal: AbortSignal, progress: (value: CreatorProgress) => void): Promise<CreatorArtifact[]> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const ai = createCreatorAiWorker(signal, progress);
        void ai.run(operation, blob).then(result => { ai.close(); resolve([{ kind: "image", name: operation === "cutout" ? "智能抠图.png" : "AI超分-ESPCN-3x.png", blob: result }]); }, error => { ai.close(); reject(error); });
    });
}

export function createCreatorAiWorker(signal: AbortSignal, progress: (value: CreatorProgress) => void) {
    const worker = new Worker(new URL("./creator-ai.worker.ts", import.meta.url), { type: "module" });
    let sequence = 0;
    const pending = new Map<number, { resolve(blob: Blob): void; reject(error: Error): void }>();
    const close = () => { worker.terminate(); signal.removeEventListener("abort", abort); pending.forEach(item => item.reject(new DOMException("已取消本地处理", "AbortError"))); pending.clear(); };
    const abort = () => close();
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }) => {
        if (data.stage) return progress(data);
        const item = pending.get(data.id);
        if (!item) return;
        pending.delete(data.id);
        if (data.blob instanceof Blob) item.resolve(data.blob); else item.reject(new Error(data.error || "本地 AI 处理未完成"));
    };
    worker.onerror = () => { pending.forEach(item => item.reject(new Error("本地 AI 组件无法启动，请重新安装最新版"))); pending.clear(); };
    return {
        run(operation: "cutout" | "superResolution", blob: Blob) {
            signal.throwIfAborted();
            const id = ++sequence;
            return new Promise<Blob>((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ id, operation, blob }); });
        },
        close,
    };
}
