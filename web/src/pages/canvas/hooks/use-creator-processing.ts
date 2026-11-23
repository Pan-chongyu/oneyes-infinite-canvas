import { useEffect, useMemo, useRef, useState } from "react";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { creatorTool, creatorSources, creatorTools } from "@/lib/canvas/creator-tools";
import { createCanvasNode, imageMetadata, videoMetadata, audioMetadata, buildImageGenerationMetadata } from "@/lib/canvas/canvas-node-factory";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { creatorSourceBlob, composeImages, processNativeVideo } from "@/services/creator-media";
import { processLocalAi } from "@/services/creator-ai";
import { studioImages } from '@/services/studio-images';
import { uploadImage, deleteStoredImages } from "@/services/image-storage";
import { imageTasks, storeGeneratedImage } from "@/stores/use-image-task-store";
import { prepareModelUpscale } from "@/services/api/image-upscale";
import { requestEdit } from "@/services/api/image";
import type { AiConfig } from "@/stores/use-config-store";
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
    imageConfig?: AiConfig;
    readNodes?: () => CanvasNodeData[];
    flush?: () => Promise<void>;
};
type Task = { projectId: string; type: string; controller: AbortController; promise: Promise<void>; sources?: string[]; outputId?: string; settings: string };

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
            if (job.projectId !== params.projectId || !node || node.type !== job.type || JSON.stringify(node.metadata?.creatorSettings || {}) !== job.settings || job.sources?.some(source => !params.nodes.some(node => node.id === source)) || job.outputId && !params.nodes.some(node => node.id === job.outputId)) job.controller.abort();
        });
        // Native/local jobs cannot survive process exit. Never leave a restored node spinning forever.
        params.nodes.forEach(node => {
            if (!creatorTool(node.type) || jobs.current.get(node.id)?.projectId === params.projectId) return;
            const outputId = node.metadata?.creatorSettings?.modelOutputId;
            if (outputId && node.metadata?.creatorSettings?.upscaleMethod === "model") {
                const output = params.nodes.find(item => item.id === outputId);
                const status = output?.metadata?.status || "error";
                const errorDetails = !output ? "结果节点已删除，请检查生成记录与用量后新建超分任务。" : status === "error" ? "请在右侧结果节点查看任务详情或继续取回，不会重新提交付费请求。" : undefined;
                if (node.metadata?.status !== status || node.metadata?.errorDetails !== errorDetails) params.updateMetadata(node.id, { status, errorDetails });
            } else if (node.metadata?.status === "loading") params.updateMetadata(node.id, { status: "error", errorDetails: "上次本地处理已中断，可重新运行；源素材保持不变" });
        });
    }, [params.projectId, params.nodes]);

    return useMemo(() => ({
        state: id => {
            const job = jobs.current.get(id);
            const node = current.current.nodes.find(node => node.id === id);
            if (job?.projectId === current.current.projectId && job.type === node?.type) return job.controller.signal.aborted ? { stage: "正在取消并清理" } : states[id];
            const output = node?.metadata?.creatorSettings?.upscaleMethod === "model" && current.current.nodes.find(item => item.id === node.metadata?.creatorSettings?.modelOutputId);
            return output && output.metadata?.status === "loading" ? { stage: output.metadata.loadingMessage || "模型正在增强 · 在右侧结果节点查看进度" } : undefined;
        },
        cancel: id => {
            const job = jobs.current.get(id);
            if (job) { job.controller.abort(); setStates(old => ({ ...old, [id]: { stage: "正在取消并清理" } })); }
            else {
                const settings = current.current.nodes.find(node => node.id === id)?.metadata?.creatorSettings;
                const output = settings?.upscaleMethod === "model" ? current.current.nodes.find(node => node.id === settings.modelOutputId) : undefined;
                if (output?.metadata?.imageTaskId) void imageTasks.pause(output.metadata.imageTaskId).catch(error => reportError("image", "pause", error));
                if (output) current.current.updateMetadata(output.id, { status: "error", loadingMessage: undefined, errorDetails: "已停止等待，可从生成记录继续取回原任务。" });
            }
        },
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
            let stage = "request";
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
                    task.sources = [...sources.map(source => source.id), ...(settings.matchId ? [settings.matchId] : [])];
                    if (tool === "superResolution" && settings.upscaleMethod === "model") {
                        if (!snapshot.imageConfig || !snapshot.flush || !snapshot.readNodes) throw new Error("模型增强服务尚未就绪，请重新打开画布。");
                        if (settings.modelOutputId) {
                            const previousOutput = snapshot.readNodes().find(item => item.id === settings.modelOutputId);
                            if (previousOutput?.metadata?.status !== "success") throw new Error("已有增强任务，请先在结果节点查看进度或生成记录；不会重复提交。需要新任务时请在设置中点击「新建增强任务」。");
                        }
                        progress({ stage: "正在准备参考原图与输出参数" });
                        const prepared = await prepareModelUpscale(snapshot.imageConfig, settings, await creatorSourceBlob(sources[0], signal), signal);
                        check();
                        const output = createCanvasNode("image", { x: 0, y: 0 }, { ...buildImageGenerationMetadata("edit", prepared.config, 1, prepared.references), prompt: prepared.prompt, status: "loading", loadingMessage: "正在提交模型超分请求" });
                        output.position = { x: node.position.x + node.width + 100, y: node.position.y };
                        output.title = "AI 超分 · 模型增强";
                        settings.modelOutputId = output.id;
                        task.outputId = output.id;
                        task.settings = JSON.stringify(settings);
                        current.current.applyOps([
                            { type: "add_node", id: output.id, nodeType: "image", title: output.title, position: output.position, width: output.width, height: output.height, metadata: output.metadata },
                            { type: "connect_nodes", fromNodeId: id, toNodeId: output.id },
                            { type: "update_node", id, metadata: { creatorSettings: settings, status: "loading", errorDetails: undefined } },
                        ]);
                        const checkOutput = () => { check(); if (!current.current.readNodes?.().some(item => item.id === output.id)) throw new DOMException("结果节点已删除", "AbortError"); };
                        try {
                            await snapshot.flush();
                            checkOutput();
                            progress({ stage: "模型正在增强 · 可在右侧结果节点查看和取回" });
                            const [image] = await requestEdit(prepared.config, prepared.prompt, prepared.references, {
                                signal, taskTarget: { projectId: snapshot.projectId, nodeId: output.id },
                                onTask: async taskId => {
                                    checkOutput();
                                    current.current.applyOps([{ type: "update_node", id: output.id, metadata: { imageTaskId: taskId } }]);
                                    await snapshot.flush!();
                                    checkOutput();
                                },
                            });
                            if (!image) throw new Error("模型未返回图片，请检查结果节点与用量。");
                            const uploaded = await storeGeneratedImage(image, { signal });
                            checkOutput();
                            current.current.applyOps([{ type: "update_node", id: output.id, patch: fitNodeSize(uploaded.width, uploaded.height, 400, 400), metadata: { ...imageMetadata(uploaded), loadingMessage: undefined, errorDetails: undefined } }]);
                            committed = true;
                            update({ status: "success", creatorSettings: { ...settings, resultCount: 1 } });
                            await snapshot.flush();
                        } catch (error) {
                            if (active() && current.current.readNodes?.().some(item => item.id === output.id)) {
                                current.current.applyOps([{ type: "update_node", id: output.id, metadata: { status: "error", loadingMessage: undefined, errorDetails: signal.aborted ? "已停止等待。已提交的任务可从生成记录继续取回；不会自动重新生成。" : error instanceof Error ? error.message : "模型增强失败，请查看任务记录。" } }]);
                                await snapshot.flush().catch(() => {});
                            }
                            throw error;
                        }
                        return;
                    }
                    const reference=settings.matchId?snapshot.nodes.find(node=>node.id===settings.matchId):undefined;
                    if(settings.matchId&&!reference)throw Error('调色参考图已删除，请重新选择');
                    const results = tool === 'board'||tool==='color' ? await studioImages(tool,sources,settings,signal,reference)
                        : tool === "compose" ? await composeImages(sources, settings, signal)
                        : tool === "analyze" || tool === "concat" || tool==='mix' || tool === "videoSuperResolution" ? await processNativeVideo(tool, sources, settings, signal, progress)
                        : await processLocalAi(tool, await creatorSourceBlob(sources[0], signal), signal, progress);
                    check();
                    stage = "save";
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
                    if (!signal.aborted) { reportError(tool === "concat" || tool === "analyze" || tool === 'mix' || tool === "videoSuperResolution" ? "video" : "image", stage, error); throw error; }
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
