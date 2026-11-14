import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import CanvasProject from "@/pages/canvas/project";
import { flushCanvasStorage, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { uploadImage } from "@/services/image-storage";
import { createCanvasNode, imageMetadata } from "@/lib/canvas/canvas-node-factory";
import { buildNodeGenerationContext, hydrateNodeGenerationContext } from "@/components/canvas/canvas-node-generation";

let projectId: string;
export async function prepareClipboardCanvas() {
    await useCanvasStore.persist.rehydrate();
    projectId = localStorage.getItem("clipboard-project") || "";
    if (!projectId) {
        const images = await Promise.all(["red", "blue"].map(async (color, index) => {
            const canvas = document.createElement("canvas"); canvas.width = canvas.height = 8;
            const context = canvas.getContext("2d")!; context.fillStyle = color; context.fillRect(0, 0, 8, 8);
            const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!)));
            const image = createCanvasNode(CanvasNodeType.Image, { x: 60 + index * 400, y: 60 }, imageMetadata(await uploadImage(new File([blob], `${color}.png`, { type: "image/png" }))));
            return { ...image, id: color, width: 240, height: 240, metadata: { ...image.metadata, groupId: "images" } };
        }));
        const configs: CanvasNodeData[] = ["first", "second"].map((id, index) => ({ id, type: CanvasNodeType.Config, title: id, position: { x: 60 + index * 650, y: 500 }, width: 600, height: 250,
            metadata: { generationMode: "image", model: "default::gpt-image-2", composerContent: "把 @[node:blue] 与 @[node:red] 融合，再参考 @[node:blue]", quality: "high", size: "16:9" } }));
        const group: CanvasNodeData = { id: "images", type: CanvasNodeType.Group, title: "图片组合", position: { x: 30, y: 30 }, width: 800, height: 350 };
        projectId = useCanvasStore.getState().createProject("批量复制引用回归");
        useCanvasStore.getState().updateProject(projectId, { nodes: [...configs, group, ...images], connections: configs.flatMap(config => images.map(image => ({ id: `${image.id}-${config.id}`, fromNodeId: image.id, toNodeId: config.id }))), viewport: { x: 0, y: 0, k: 0.5 } });
        localStorage.setItem("clipboard-project", projectId);
    }
    const state = () => useCanvasStore.getState().projects.find(project => project.id === projectId)!;
    Object.assign(window, { clipboardTest: {
        state, flush: flushCanvasStorage,
        context: async (id: string) => {
            const project = state(), node = project.nodes.find(node => node.id === id)!;
            // Copied graphs must remain usable without the original nodes or links.
            const nodes = project.nodes.filter(node => node.id.includes("-") || node.id === id);
            const connections = project.connections.filter(link => nodes.some(node => node.id === link.fromNodeId) && nodes.some(node => node.id === link.toNodeId));
            return hydrateNodeGenerationContext(buildNodeGenerationContext(id, nodes, connections, node.metadata!.composerContent!));
        },
    } });
}

export function ClipboardCanvas() {
    return <QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[`/canvas/${projectId}`]}><Routes><Route path="/canvas/:id" element={<CanvasProject />} /></Routes></MemoryRouter></QueryClientProvider>;
}
