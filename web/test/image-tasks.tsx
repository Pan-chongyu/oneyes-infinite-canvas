import React from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import localforage from "localforage";
import "@/i18n";
import "@/styles/globals.css";
import ImagePage from "@/pages/image";
import { requestEdit, requestGeneration } from "@/services/api/image";
import { defaultConfig, useConfigStore } from "@/stores/use-config-store";
import { imageTasks, initializeImageTasks, useImageTaskStore, storedTaskImage } from "@/stores/use-image-task-store";
import { getImageBlob } from "@/services/image-storage";
import { useCanvasStore, flushCanvasStorage } from "@/stores/canvas/use-canvas-store";
import { applyCanvasImageTask, markCanvasImageTask } from "@/lib/canvas/canvas-image-task";
import { CanvasNodeType } from "@/types/canvas";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const bytes = Uint8Array.from(atob(png), char => char.charCodeAt(0));
const original = window.fetch.bind(window);
const config = { ...defaultConfig, model: "default::gpt-image-2", imageModel: "default::gpt-image-2", channels: [{ ...defaultConfig.channels[0], apiKey: "fixture-private-key" }] };
useConfigStore.setState({ config });
window.fetch = async (input, options) => {
    const url = String(input);
    if (url.includes("/v1/images/")) {
        if (options?.method === "POST") {
            sessionStorage.setItem("posts", String(Number(sessionStorage.getItem("posts") || 0) + 1));
            if (url.includes("/edits/")) {
                if (!(options.body instanceof FormData) || options.body.get("stream") !== null || !(options.body.get("image") instanceof Blob)) throw Error("Invalid async edit form");
            }
            return Response.json({ task_id: "imgtask_fixture", status: "processing", expires_at: Math.floor(Date.now() / 1000) + 86400 }, { status: 202, headers: { "Retry-After": "3" } });
        }
        if (sessionStorage.getItem("offline") === "true") throw new TypeError("simulated disconnected task request");
        return Response.json({ task_id: "imgtask_fixture", status: "completed", result: { data: [{ url: "https://images.example.test/generated.png" }] } });
    }
    if (url === "https://images.example.test/generated.png") {
        if (sessionStorage.getItem("downloadOffline") === "true") throw new TypeError("simulated disconnected download");
        return new Response(bytes, { headers: { "Content-Type": "image/png" } });
    }
    return original(input, options);
};
await useCanvasStore.persist.rehydrate();
if (!useCanvasStore.getState().projects.length) {
    const id = useCanvasStore.getState().createProject("断线恢复画布");
    sessionStorage.setItem("project", id);
    useCanvasStore.getState().updateProject(id, { nodes: [{ id: "image-node", type: CanvasNodeType.Image, title: "恢复节点", position: { x: 0, y: 0 }, width: 640, height: 640, metadata: { status: "loading" } }] });
    await flushCanvasStorage();
}
initializeImageTasks();
Object.assign(window, { asyncImageTest: {
    state: () => useImageTaskStore.getState(),
    posts: () => Number(sessionStorage.getItem("posts") || 0),
    start: (edit: boolean) => {
        const target = { projectId: sessionStorage.getItem("project")!, nodeId: "image-node" };
        const options = { taskTarget: target, onTask: async (id: string) => {
            const store = useCanvasStore.getState();
            store.updateProject(target.projectId, { nodes: markCanvasImageTask(store.openProject(target.projectId)!.nodes, target, id) });
            await flushCanvasStorage();
        } };
        sessionStorage.setItem("offline", "true");
        void (edit ? requestEdit(config, "参考图断线恢复", [{ id: "ref", name: "ref.png", type: "image/png", dataUrl: `data:image/png;base64,${png}` }], options) : requestGeneration(config, "生图断线恢复", options)).catch(() => {});
    },
    refresh: () => imageTasks.refresh(useImageTaskStore.getState().tasks[0].id),
    connect: async (downloadOffline = false) => {
        sessionStorage.setItem("offline", "false"); sessionStorage.setItem("downloadOffline", String(downloadOffline));
        window.dispatchEvent(new Event("online"));
        await imageTasks.resumeAll();
    },
    blob: async () => { const image = useImageTaskStore.getState().tasks[0]?.images[0]; const blob = image && await getImageBlob(image.storageKey); return { bytes: blob?.size, type: blob?.type }; },
    apply: async () => {
        const task = useImageTaskStore.getState().tasks[0]; const store = useCanvasStore.getState();
        const project = store.openProject(task.target!.projectId)!; const image = await storedTaskImage(task.images[0]);
        store.updateProject(project.id, { nodes: project.nodes.map(node => applyCanvasImageTask(node, task, image)) }); await flushCanvasStorage();
    },
    node: () => useCanvasStore.getState().projects[0].nodes[0],
    logs: async () => { const values: unknown[] = []; await localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" }).iterate(value => { values.push(value); }); return values; },
    cached: async () => localforage.createInstance({ name: "infinite-canvas", storeName: "image_tasks" }).getItem(useImageTaskStore.getState().tasks[0].id),
} });
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><ConfigProvider><App><ImagePage /></App></ConfigProvider></MemoryRouter></QueryClientProvider>);
