import React from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/i18n";
import "@/styles/globals.css";
import CanvasProject from "@/pages/canvas/project";
import { requestGeneration } from "@/services/api/image";
import { defaultConfig, useConfigStore } from "@/stores/use-config-store";
import { imageTasks, initializeImageTasks, useImageTaskStore } from "@/stores/use-image-task-store";
import { getImageBlob } from "@/services/image-storage";
import { useCanvasStore, flushCanvasStorage } from "@/stores/canvas/use-canvas-store";
import { markCanvasImageTask } from "@/lib/canvas/canvas-image-task";
import { CanvasNodeType } from "@/types/canvas";

// No renderer fetch mocks: the fixture serves the actual native API and image
// download routes, including an image server with no CORS permission.
await useConfigStore.persist.rehydrate();
await useCanvasStore.persist.rehydrate();
const submit = new URLSearchParams(location.search).has("submit");
if (submit) {
    const config = { ...defaultConfig, model: "default::gpt-image-2", imageModel: "default::gpt-image-2", channels: [{ ...defaultConfig.channels[0], apiKey: "fixture-private-key" }] };
    useConfigStore.setState({ config });
    // Wait for the real encrypted IPC storage, as the next process must restore it.
    await window.oneYesDesktop!.storage.setItem("infinite-canvas:ai_config_store", JSON.stringify({ state: { config }, version: 0 }));
    const projectId = useCanvasStore.getState().createProject("重启恢复画布");
    useCanvasStore.getState().updateProject(projectId, { nodes: [{ id: "restart-node", type: CanvasNodeType.Image, title: "重启恢复", position: { x: 100, y: 100 }, width: 320, height: 320, metadata: { status: "loading", images: [{ id: "slot", status: "loading", content: "", naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: "" }] } }] });
    await flushCanvasStorage();
    const target = { projectId, nodeId: "restart-node", imageId: "slot" };
    void requestGeneration(config, "重启恢复", { taskTarget: target, onTask: async id => {
        const store = useCanvasStore.getState();
        store.updateProject(projectId, { nodes: markCanvasImageTask(store.openProject(projectId)!.nodes, target, id) });
        await flushCanvasStorage();
    } }).catch(() => {});
}
initializeImageTasks();
Object.assign(window, { restartTest: {
    state: () => useImageTaskStore.getState(),
    node: () => useCanvasStore.getState().projects[0].nodes[0],
    keyRestored: () => useConfigStore.getState().config.channels[0].apiKey === "fixture-private-key",
    flush: flushCanvasStorage,
    blob: async () => { const image = useImageTaskStore.getState().tasks[0]?.images[0]; return image && (await getImageBlob(image.storageKey))?.size; },
    refresh: () => imageTasks.refresh(useImageTaskStore.getState().tasks[0].id),
} });
const projectId = useCanvasStore.getState().projects[0].id;
createRoot(document.getElementById("root")!).render(<React.StrictMode><QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[`/canvas/${projectId}`]}><ConfigProvider><App><Routes><Route path="/canvas/:id" element={submit ? <main>提交测试任务</main> : <CanvasProject />} /></Routes></App></ConfigProvider></MemoryRouter></QueryClientProvider></React.StrictMode>);
