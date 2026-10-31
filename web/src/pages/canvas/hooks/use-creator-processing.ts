import { useEffect, useMemo, useRef, useState } from "react";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { creatorTool, creatorSources, creatorTools } from "@/lib/canvas/creator-tools";
import { createCanvasNode, imageMetadata, videoMetadata, audioMetadata } from "@/lib/canvas/canvas-node-factory";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { creatorSourceBlob, composeImages, processNativeVideo } from "@/services/creator-media";
import { processLocalAi } from "@/services/creator-ai";
import { uploadImage, deleteStoredImages } from "@/services/image-storage";
import { uploadMediaFile, deleteStoredMedia } from "@/services/file-storage";
import { reportError } from "@/services/diagnostics";
import type { CanvasNodeData, CanvasConnection, CanvasNodeMetadata } from "@/types/canvas";
import type { CreatorProcessor, CreatorProgress } from "@/types/creator-tools";

type Params = {
    projectId: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    updateMetadata: (id: string, patch: CanvasNodeMetadata) => void;
    applyOps: (ops: CanvasAgentOp[]) => unknown;
};
type Task = { projectId: string; type: string; controller: AbortController; promise: Promise<void>; sources?: string[]; settings: string };

export function useCreatorProcessing(params: Params): CreatorProcessor {
    const current = useRef(params);
    current.current = params;
    const jobs = useRef(new Map<string, Task>());
    const mounted = useRef(true);
    const [states, setStates] = useState<Record<string, CreatorProgress>>({});
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; jobs.current.forEach(job => job.controller.abort()); };
    }, []);
    useEffect(() => {
        jobs.current.forEach((job, id) => {
            const node = params.nodes.find(node => node.id === id);
            if (job.projectId !== params.projectId || !node || node.type !== job.type || JSON.stringify(node.metadata?.creatorSettings || {}) !== job.settings || job.sources?.some(source => !params.nodes.some(node => node.id === source))) job.controller.abort();
        });
        // Native/local jobs cannot survive process exit. Never leave a restored node spinning forever.
        params.nodes.forEach(node => {
            if (creatorTool(node.type) && node.metadata?.status === "loading" && jobs.current.get(node.id)?.projectId !== params.projectId) params.updateMetadata(node.id, { status: "error", errorDetails: "上次本地处理已中断，可重新运行；源素材保持不变" });
        });
    }, [params.projectId, params.nodes]);

    return useMemo(() => ({
        state: id => {
            const job = jobs.current.get(id);
            return job?.projectId === current.current.projectId && job.type === current.current.nodes.find(node => node.id === id)?.type ? (job.controller.signal.aborted ? { stage: "正在取消并清理" } : states[id]) : undefined;
        },
        cancel: id => { const job = jobs.current.get(id); if (job) { job.controller.abort(); setStates(old => ({ ...old, [id]: { stage: "正在取消并清理" } })); } },
        start: id => {
            const previous = jobs.current.get(id);
            if (previous?.projectId === current.current.projectId && previous.type === current.current.nodes.find(node => node.id === id)?.type) return previous.promise;
            if (previous) { previous.controller.abort(); jobs.current.delete(id); }
            const snapshot = current.current;
            const node = snapshot.nodes.find(item => item.id === id);
            const tool = node && creatorTool(node.type);
            if (!node || !tool) return Promise.reject(new Error("创作工具节点不存在"));
            const controller = new AbortController(), signal = controller.signal;
            const settings = structuredClone(node.metadata?.creatorSettings || {});
            const imageKeys: string[] = [], mediaKeys: string[] = [];
            let committed = false;
            const active = () => mounted.current && jobs.current.get(id) === task && current.current.projectId === snapshot.projectId && current.current.nodes.some(item => item.id === id && item.type === node.type);
            const check = () => { signal.throwIfAborted(); if (!active()) throw new DOMException("画布已切换或节点已删除", "AbortError"); };
            const update = (patch: CanvasNodeMetadata) => { if (active()) current.current.updateMetadata(id, patch); };
            const progress = (value: CreatorProgress) => { if (active() && !signal.aborted) setStates(old => ({ ...old, [id]: value })); };
            const task: Task = { projectId: snapshot.projectId, type: node.type, controller, promise: Promise.resolve(), settings: JSON.stringify(settings) };
            jobs.current.set(id, task);
            update({ status: "loading", errorDetails: undefined });
            progress({ stage: "正在准备本地处理" });
            task.promise = (async () => {
                try {
                    const sources = creatorSources(node, snapshot.nodes, snapshot.connections);
                    task.sources = sources.map(source => source.id);
                    const results = tool === "compose" ? await composeImages(sources, settings, signal)
                        : tool === "analyze" || tool === "concat" ? await processNativeVideo(tool, sources, settings, signal, progress)
                        : await processLocalAi(tool, await creatorSourceBlob(sources[0], signal), signal, progress);
                    check();
                    progress({ stage: "正在保存处理结果" });
                    const ops: CanvasAgentOp[] = [];
                    let y = node.position.y;
                    for (const artifact of results) {
                        let metadata: CanvasNodeMetadata;
                        if (artifact.kind === "image") {
                            const image = await uploadImage(artifact.blob, { signal });
                            if (image.storageKey) imageKeys.push(image.storageKey);
                            metadata = imageMetadata(image);
                        } else if (artifact.kind === "text") metadata = { content: await artifact.blob.text(), status: "success" };
                        else {
                            const media = await uploadMediaFile(artifact.blob, artifact.kind);
                            mediaKeys.push(media.storageKey);
                            metadata = artifact.kind === "video" ? videoMetadata(media) : audioMetadata(media);
                        }
                        check();
                        const output = createCanvasNode(artifact.kind, { x: 0, y: 0 }, metadata);
                        const size = metadata.naturalWidth && metadata.naturalHeight ? fitNodeSize(metadata.naturalWidth, metadata.naturalHeight, 400, 400) : { width: 360, height: 220 };
                        output.position = { x: node.position.x + node.width + 100, y };
                        output.title = `${creatorTools[tool].title} · ${artifact.time !== undefined ? `${artifact.time.toFixed(2)}s · ` : ""}${artifact.name}`;
                        Object.assign(output, size);
                        y += size.height + 70;
                        ops.push({ type: "add_node", id: output.id, nodeType: output.type, title: output.title, position: output.position, ...size, metadata });
                        ops.push({ type: "connect_nodes", fromNodeId: id, toNodeId: output.id });
                    }
                    check();
                    current.current.applyOps(ops);
                    committed = true;
                    update({ status: "success", creatorSettings: { ...settings, resultCount: results.length } });
                } catch (error) {
                    update({ status: signal.aborted ? "idle" : "error", errorDetails: signal.aborted ? undefined : error instanceof Error ? error.message : "本地处理失败，请重试" });
                    if (!signal.aborted) { reportError(tool === "concat" || tool === "analyze" ? "video" : "image", "save", error); throw error; }
                } finally {
                    if (!committed) await Promise.allSettled([deleteStoredImages(imageKeys), deleteStoredMedia(mediaKeys)]);
                    if (jobs.current.get(id) === task) {
                        jobs.current.delete(id);
                        if (mounted.current) setStates(old => { const next = { ...old }; delete next[id]; return next; });
                    }
                }
            })();
            return task.promise;
        },
    }), [states]);
}
