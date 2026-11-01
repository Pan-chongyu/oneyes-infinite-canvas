import { useEffect, useRef, useState } from "react";
import { nanoid } from "nanoid";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { BatchItem } from "@/types/studio";
import { studioSources, batchPrompts } from "@/lib/canvas/studio";

type Params = {
    projectId: string;
    nodes: CanvasNodeData[];
    readNodes: () => CanvasNodeData[];
    connections: CanvasConnection[];
    applyAgentOps: (ops: CanvasAgentOp[]) => unknown;
    flush: () => Promise<void>;
    runGeneration: (id: string, prompt: string) => Promise<void>;
};
export function useBatchProcessing(params: Params) {
    const current = useRef(params);
    current.current = params;
    const running = useRef(new Map<string, { projectId: string; paused: boolean }>());
    const [, render] = useState(0),
        mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            running.current.forEach((job) => {
                job.paused = true;
            });
        };
    }, []);
    useEffect(() => {
        running.current.forEach((job, id) => {
            if (job.projectId !== params.projectId || !params.nodes.some((node) => node.id === id)) job.paused = true;
        });
    }, [params.projectId, params.nodes]);
    return {
        active: (id: string) => running.current.get(id)?.projectId === params.projectId,
        pause: (id: string) => {
            const job = running.current.get(id);
            if (job) job.paused = true;
        },
        start: async (id: string) => {
            if (running.current.has(id)) return;
            const snapshot = current.current,
                node = snapshot.nodes.find((n) => n.id === id);
            if (!node) throw Error("批量节点已删除");
            if (running.current.size) {
                snapshot.applyAgentOps([{ type: "update_node", id, metadata: { status: "error", errorDetails: "已有批量任务正在执行，请等待本项结束后继续" } }]);
                return;
            }
            const job = { projectId: snapshot.projectId, paused: false };
            running.current.set(id, job);
            render((n) => n + 1);
            const belongs = () => mounted.current && current.current.projectId === snapshot.projectId && current.current.readNodes().some((n) => n.id === id);
            const valid = () => !job.paused && belongs();
            let items: BatchItem[] = structuredClone(node.metadata?.studio?.items || []),
                studio = structuredClone(node.metadata?.studio || {});
            const patch = async (error?: string) => {
                if (!belongs()) throw new DOMException("画布或批量节点已关闭", "AbortError");
                current.current.applyAgentOps([{ type: "update_node", id, metadata: { studio: { ...studio, items: structuredClone(items) }, status: error ? "error" : "idle", errorDetails: error } }]);
                await current.current.flush();
            };
            try {
                if (!items.length) {
                    const inputs = studioSources(node, snapshot.nodes, snapshot.connections);
                    const prompts = batchPrompts(node, inputs);
                    if (!prompts.length) throw Error("请每行填写一条提示词");
                    items = prompts.map((prompt) => ({ id: nanoid(), prompt, state: "pending" }));
                    const sources = inputs.filter(n => n.type !== "text").map((n) => n.id);
                    const ops: CanvasAgentOp[] = items.flatMap((item, index) => [
                        {
                            type: "add_node",
                            id: item.id,
                            nodeType: "image",
                            title: `${node.title} · ${index + 1}`,
                            position: { x: node.position.x + node.width + 100, y: node.position.y + index * 310 },
                            metadata: { prompt: item.prompt, status: "idle", ...(studio.model ? { model: studio.model } : {}), count: 1 },
                        },
                        { type: "connect_nodes", fromNodeId: id, toNodeId: item.id },
                        ...sources.map((source) => ({ type: "connect_nodes" as const, fromNodeId: source, toNodeId: item.id })),
                    ]);
                    current.current.applyAgentOps(ops);
                    await patch();
                }
                for (const item of items) {
                    if (!valid()) break;
                    if (item.state === "done") continue;
                    if (item.state === "started") {
                        const output = current.current.readNodes().find((n) => n.id === item.id);
                        if (output?.metadata?.status === "success" && output.metadata.content) {
                            item.state = "done";
                            await patch();
                            continue;
                        }
                        throw Error("已有任务尚未完成，请在对应图片节点等待取图或检查用量；不会自动重新提交。完成后可继续批量任务");
                    }
                    const existing = current.current.readNodes().find((n) => n.id === item.id);
                    if (!existing) throw Error("批量结果节点被删除，请检查已有任务与用量后新建批量节点");
                    if (existing.metadata?.status === "success" && existing.metadata.content) {
                        item.state = "done";
                        await patch();
                        continue;
                    }
                    if (existing.metadata?.status === "loading" || existing.metadata?.imageTaskId || existing.metadata?.images?.some((image) => image.imageTaskId)) throw Error("对应图片已有生成任务，请先等待结果或检查用量；不会重复提交");
                    if (!valid()) break;
                    item.state = "started";
                    await patch();
                    if (!valid()) {
                        if (belongs()) {
                            item.state = "pending";
                            await patch();
                        }
                        break;
                    }
                    await current.current.runGeneration(item.id, item.prompt);
                    if (!valid()) break;
                    const output = current.current.readNodes().find((n) => n.id === item.id);
                    if (output?.metadata?.status !== "success" || !output.metadata.content) throw Error("本项未完成，批量任务已暂停；请到对应图片节点检查结果与用量");
                    item.state = "done";
                    await patch();
                }
            } catch (error) {
                if (belongs()) await patch(error instanceof Error ? error.message : "批量任务已暂停");
                throw error;
            } finally {
                running.current.delete(id);
                if (mounted.current) render((n) => n + 1);
            }
        },
    };
}
