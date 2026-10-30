import React from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/i18n";
import "@/styles/globals.css";
import CanvasProject from "@/pages/canvas/project";
import { defaultConfig, useConfigStore } from "@/stores/use-config-store";
import { imageTasks, initializeImageTasks, useImageTaskStore } from "@/stores/use-image-task-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType } from "@/types/canvas";

await useConfigStore.persist.rehydrate();
await useCanvasStore.persist.rehydrate();
useConfigStore.setState({ config: { ...defaultConfig, model: "default::gpt-image-2", imageModel: "default::gpt-image-2", count: "2", canvasImageCount: "2", channels: [{ ...defaultConfig.channels[0], apiKey: "fixture-private-key" }] } });
const projectId = useCanvasStore.getState().createProject("生成等待状态回归");
useCanvasStore.getState().updateProject(projectId, { nodes: [{ id: "generate", type: CanvasNodeType.Config, title: "生图配置", position: { x: 80, y: 80 }, width: 320, height: 320, metadata: { prompt: "测试图片", composerContent: "测试图片", generationMode: "image", count: 2 } }] });

// Hold the exact pre-receipt gap while the real CanvasProject recovery effect runs.
// Release each slot independently to cover a batch with only one bound receipt.
const submit = imageTasks.submit.bind(imageTasks);
const gates: Array<() => void> = [];
imageTasks.submit = async (...args) => {
    await new Promise<void>(resolve => gates.push(resolve));
    return submit(...args);
};
const originalFetch = window.fetch.bind(window);
let posts = 0, complete = false;
window.fetch = async (input, options) => {
    const url = String(input);
    if (url.includes("/images/generations/async")) {
        posts++;
        return Response.json({ task_id: `imgtask_${posts}`, status: "processing" }, { status: 202 });
    }
    if (url.includes("/images/tasks/")) return Response.json({ task_id: url.split("/").pop(), status: complete ? "completed" : "processing", ...(complete ? { result: { data: [{ b64_json: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" }] } } : {}) });
    if (/^https?:/.test(url) && new URL(url).origin !== location.origin) throw Error("External requests disabled in fixture");
    return originalFetch(input, options);
};
let orphanWarning = false;
new MutationObserver(() => { if (/缺少.*任务记录|暂未找到这次生成的记录/.test(document.body.innerText)) orphanWarning = true; }).observe(document.body, { subtree: true, childList: true, characterData: true });
initializeImageTasks();
Object.assign(window, { generationTest: {
    started: () => gates.length,
    release: (index: number) => gates[index](),
    posts: () => posts,
    state: () => useImageTaskStore.getState().tasks,
    orphanWarning: () => orphanWarning,
    complete: async () => { complete = true; await Promise.all([...imageTasks.tasks.keys()].map(id => imageTasks.refresh(id))); },
    theme: (dark: boolean) => { document.documentElement.classList.toggle("dark", dark); useThemeStore.getState().setTheme(dark ? "dark" : "light"); },
} });
createRoot(document.getElementById("root")!).render(<React.StrictMode><QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[`/canvas/${projectId}`]}><ConfigProvider><App><Routes><Route path="/canvas/:id" element={<CanvasProject />} /></Routes></App></ConfigProvider></MemoryRouter></QueryClientProvider></React.StrictMode>);
